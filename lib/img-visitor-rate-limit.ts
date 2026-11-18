// Per-visitor-IP budget on /api/img and /api/og -- see
// sql/035_visitor_rate_state.sql for why this is a hand-rolled token bucket
// rather than @vercel/firewall's checkRateLimit.
//
// Same shape as lib/img-fetch-guard.ts's acquireHostToken: one atomic
// INSERT ... ON CONFLICT DO UPDATE, so concurrent requests from the same IP
// can't both spend one token. Capacity/refill live on the row (defaults from
// config.toml), so a single IP can be tuned in Neon without a deploy.
//
// Deliberately generous -- stops a single runaway client from spending
// Vercel's Fluid CPU / Fast Origin Transfer budget alone, not meant to
// throttle a real visitor scrolling the feed.
//
// Rows are keyed "img:<daily visitor hash>" (lib/visitor-hash.ts), never a
// raw IP address.

import { clientIp } from "./client-ip.ts";
import { TRANQUILO_CONFIG } from "./config.generated.ts";
import type { QuerySql } from "./img-store.ts";
import { visitorKey } from "./visitor-hash.ts";

interface VisitorVerdict {
  allowed: boolean;
  reason: string;
  tokens: number | null;
}

interface RequestWithHeaders {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null } | null;
}

interface RateLimitResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

const ACQUIRE_SQL =
  "INSERT INTO visitor_fetch_state (ip, last_refill, updated_at) " +
  "VALUES ($1, now(), now()) " +
  "ON CONFLICT (ip) DO UPDATE SET " +
  "  tokens = LEAST(visitor_fetch_state.capacity, " +
  "    visitor_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - visitor_fetch_state.last_refill)) " +
  "      * visitor_fetch_state.refill_per_sec) - 1, " +
  "  last_refill = now(), " +
  "  updated_at = now() " +
  "WHERE LEAST(visitor_fetch_state.capacity, " +
  "    visitor_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - visitor_fetch_state.last_refill)) " +
  "      * visitor_fetch_state.refill_per_sec) >= 1 " +
  "RETURNING tokens";

/**
 * Spends one token for the visitor `key`. Returns { allowed, reason, tokens }.
 *
 * Fails OPEN, not closed -- the opposite of the origin-side guards. Those
 * protect a museum's server from us and treat "we can't tell" as "don't
 * fetch". This protects OUR budget from a visitor, and a database we can't
 * reach is not a reason to 429 every visitor on the site; it just means this
 * particular safety net is unavailable for the moment.
 */
async function acquireVisitorToken(
  sql: QuerySql | null | undefined,
  key: string | null,
): Promise<VisitorVerdict> {
  if (!sql || !key)
    return { allowed: true, reason: "no-db-or-ip", tokens: null };
  try {
    const rows = (await sql.query(ACQUIRE_SQL, [key])) as {
      tokens: string | number;
    }[];
    if (rows.length)
      return { allowed: true, reason: "ok", tokens: Number(rows[0].tokens) };
    return { allowed: false, reason: "rate-limited", tokens: 0 };
  } catch (_err) {
    return { allowed: true, reason: "error", tokens: null };
  }
}

// How long to ask a denied client to wait: not read back from the row, since
// the next token lands in roughly 1/refill_per_sec seconds regardless of the
// exact deficit, and a follow-up query would spend a round trip on the one
// path that most wants to stay cheap.
function retryAfterSeconds(): number {
  const refillPerSec = TRANQUILO_CONFIG.img_visitor_rate_limit.refill_per_sec;
  return Math.max(1, Math.ceil(1 / (refillPerSec || 1)));
}

/**
 * The whole check, for a handler to call in one line: spend a token for this
 * request's visitor and, if the bucket is empty, send the 429 itself.
 * Returns true if the response has already been sent (the caller must
 * return immediately) and false if the request may proceed.
 */
async function rateLimitOrRespond(
  sql: QuerySql | null | undefined,
  req: RequestWithHeaders,
  res: RateLimitResponse,
): Promise<boolean> {
  const visitor = visitorKey(clientIp(req));
  const verdict = await acquireVisitorToken(
    sql,
    visitor ? `img:${visitor}` : null,
  );
  if (verdict.allowed) return false;
  const retryAfter = retryAfterSeconds();
  res.statusCode = 429;
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("Cache-Control", "no-store");
  res.json({ error: "Too many requests", retryAfter: retryAfter });
  return true;
}

export { acquireVisitorToken, rateLimitOrRespond, retryAfterSeconds };
