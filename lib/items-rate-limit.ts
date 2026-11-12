// Per-visitor-IP budget on /api/items, charged by how many items a request
// asks for, so a deep scrape drains it long before a person scrolling does.
// Shares visitor_fetch_state with the image budget under an "items:" key
// prefix; see sql/035_visitor_rate_state.sql. Buckets and denial counters are
// keyed by lib/visitor-hash.ts, never a raw IP.
//
// Fails open like the image budget: an unreachable database is not a reason
// to refuse every visitor. Responses served from the edge cache never reach
// this check.

import { TRANQUILO_CONFIG } from "./config.generated.ts";
import type { QuerySql } from "./img-store.ts";
import { clientIp } from "./img-visitor-rate-limit.ts";
import {
  ALERT_EMAILS_PER_HOUR,
  flagHeavyReader,
  heavyReaderMessage,
  repeatedlyRefusedMessage,
  sendOpsEmail,
  VISITOR_DENIED_COST_MIN,
  VOLUME_CHECK_FLOOR,
} from "./items-abuse-alert.ts";
import { visitorKey } from "./visitor-hash.ts";

interface Limits {
  capacity: number;
  refill_per_sec: number;
  enforce: boolean;
}

interface CostedQuery {
  limit?: number;
  facets?: boolean;
  suggest?: boolean;
  counting?: boolean;
  correction?: boolean;
  lookup?: boolean;
  requestedIds?: string[];
}

interface RequestWithHeaders {
  headers?: Record<string, string | string[] | undefined>;
}

interface RateLimitResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

interface Verdict {
  allowed: boolean;
  reason: string;
  tokens: number | null;
  spent?: number;
  flagged?: boolean;
}

export const ACQUIRE_SQL =
  "INSERT INTO visitor_fetch_state (ip, tokens, capacity, refill_per_sec, last_refill, updated_at, spent) " +
  "VALUES ($1, $3::real - $2::real, $3::real, $4::real, now(), now(), $2::bigint) " +
  "ON CONFLICT (ip) DO UPDATE SET " +
  "  tokens = LEAST(visitor_fetch_state.capacity, " +
  "    visitor_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - visitor_fetch_state.last_refill)) " +
  "      * visitor_fetch_state.refill_per_sec) - $2::real, " +
  "  last_refill = now(), " +
  "  updated_at = now(), " +
  "  spent = visitor_fetch_state.spent + $2::bigint " +
  "WHERE LEAST(visitor_fetch_state.capacity, " +
  "    visitor_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - visitor_fetch_state.last_refill)) " +
  "      * visitor_fetch_state.refill_per_sec) >= $2::real " +
  "RETURNING tokens, spent, flagged_at";

type BudgetKind = "items" | "detail" | "quote" | "alert";

const configured = (): Limits => TRANQUILO_CONFIG.items_visitor_rate_limit;
const configuredDetail = (): Limits =>
  TRANQUILO_CONFIG.detail_visitor_rate_limit;
const configuredQuote = (): Limits => TRANQUILO_CONFIG.quote_visitor_rate_limit;

// One token for an aggregate answer, one per row for anything that returns
// items.
export function itemsCost(query: CostedQuery): number {
  if (query.lookup) return Math.max(1, query.requestedIds?.length ?? 1);
  return Math.max(1, query.limit ?? 1);
}

export async function acquireItemsBudget(
  sql: QuerySql | null | undefined,
  visitor: string | null,
  cost: number,
  limits: Limits = configured(),
): Promise<Verdict> {
  return acquireBudget(sql, visitor, cost, limits, "items");
}

async function acquireBudget(
  sql: QuerySql | null | undefined,
  visitor: string | null,
  cost: number,
  limits: Limits,
  kind: BudgetKind,
): Promise<Verdict> {
  if (!sql || !visitor)
    return { allowed: true, reason: "no-db-or-ip", tokens: null };
  const charge = Math.min(cost, limits.capacity);
  try {
    const rows = (await sql.query(ACQUIRE_SQL, [
      `${kind}:${visitor}`,
      charge,
      limits.capacity,
      limits.refill_per_sec,
    ])) as {
      tokens: string | number;
      spent?: string | number;
      flagged_at?: unknown;
    }[];
    if (rows.length)
      return {
        allowed: true,
        reason: "ok",
        tokens: Number(rows[0].tokens),
        spent: rows[0].spent === undefined ? undefined : Number(rows[0].spent),
        flagged: Boolean(rows[0].flagged_at),
      };
    return { allowed: false, reason: "rate-limited", tokens: 0 };
  } catch (_err) {
    return { allowed: true, reason: "error", tokens: null };
  }
}

const RECORD_DENIAL_SQL =
  "INSERT INTO items_budget_events (day, visitor, kind, denied_requests, denied_cost, enforced) " +
  "VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, 1, $3, $4) " +
  "ON CONFLICT (day, visitor, kind) DO UPDATE SET " +
  "  denied_requests = items_budget_events.denied_requests + 1, " +
  "  denied_cost = items_budget_events.denied_cost + $3, " +
  "  enforced = $4, " +
  "  last_seen = now() " +
  "RETURNING denied_cost";

// The day's refused total after this denial, so the caller can tell when it
// crosses an alert line.
export async function recordBudgetDenial(
  sql: QuerySql,
  visitor: string,
  kind: string,
  cost: number,
  enforced: boolean,
): Promise<number | null> {
  try {
    const rows = (await sql.query(RECORD_DENIAL_SQL, [
      visitor,
      kind,
      cost,
      enforced,
    ])) as { denied_cost: string | number }[] | undefined;
    return rows?.length ? Number(rows[0].denied_cost) : null;
  } catch (_err) {
    return null;
  }
}

const ALERT_LIMITS: Limits = {
  capacity: ALERT_EMAILS_PER_HOUR,
  refill_per_sec: ALERT_EMAILS_PER_HOUR / 3600,
  enforce: true,
};

async function raiseAlert(
  sql: QuerySql,
  message: { subject: string; text: string },
): Promise<void> {
  const budget = await acquireBudget(sql, "all", 1, ALERT_LIMITS, "alert");
  if (!budget.allowed) return;
  await sendOpsEmail(message.subject, message.text);
}

async function watchVolume(
  sql: QuerySql,
  visitor: string,
  verdict: Verdict,
): Promise<void> {
  if (verdict.flagged || (verdict.spent ?? 0) < VOLUME_CHECK_FLOOR) return;
  const reader = await flagHeavyReader(sql, visitor);
  if (reader) await raiseAlert(sql, heavyReaderMessage(reader));
}

// True when the 429 has been sent and the caller must return. While
// `enforce` is off a denial is only logged, so the limits can be tuned
// against real traffic first.
export async function itemsRateLimitOrRespond(
  sql: QuerySql | null | undefined,
  req: RequestWithHeaders,
  res: RateLimitResponse,
  cost: number,
  limits: Limits = configured(),
): Promise<boolean> {
  return rateLimitOrRespond(sql, req, res, cost, limits, "items");
}

// One item's curated text costs one token from a bucket of its own, far
// smaller than the page budget: a person opens a handful of details a
// minute, a scraper wants thousands.
export async function detailRateLimitOrRespond(
  sql: QuerySql | null | undefined,
  req: RequestWithHeaders,
  res: RateLimitResponse,
  limits: Limits = configuredDetail(),
): Promise<boolean> {
  return rateLimitOrRespond(sql, req, res, 1, limits, "detail");
}

// One Gelato quote costs one token from a bucket of its own.
export async function quoteRateLimitOrRespond(
  sql: QuerySql | null | undefined,
  req: RequestWithHeaders,
  res: RateLimitResponse,
  limits: Limits = configuredQuote(),
): Promise<boolean> {
  return rateLimitOrRespond(sql, req, res, 1, limits, "quote");
}

async function rateLimitOrRespond(
  sql: QuerySql | null | undefined,
  req: RequestWithHeaders,
  res: RateLimitResponse,
  cost: number,
  limits: Limits,
  kind: BudgetKind,
): Promise<boolean> {
  const visitor = visitorKey(clientIp(req));
  const verdict = await acquireBudget(sql, visitor, cost, limits, kind);
  if (verdict.allowed) {
    if (kind === "items" && sql && visitor) {
      await watchVolume(sql, visitor, verdict);
    }
    return false;
  }
  if (!sql || !visitor) return false;
  const deniedToday = await recordBudgetDenial(
    sql,
    visitor,
    kind,
    cost,
    limits.enforce,
  );
  if (
    kind === "items" &&
    deniedToday !== null &&
    deniedToday >= VISITOR_DENIED_COST_MIN &&
    deniedToday - cost < VISITOR_DENIED_COST_MIN
  ) {
    await raiseAlert(sql, repeatedlyRefusedMessage(deniedToday));
  }
  if (!limits.enforce) return false;
  const retryAfter = Math.max(
    1,
    Math.ceil(Math.min(cost, limits.capacity) / limits.refill_per_sec),
  );
  res.statusCode = 429;
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("Cache-Control", "no-store");
  res.json({ error: "Too many requests", retryAfter });
  return true;
}
