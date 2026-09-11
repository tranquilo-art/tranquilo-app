// The guards that sit between a cache miss and an origin fetch.
//
// Extracted so these concurrency primitives are directly callable in
// tests -- concurrency bugs are invisible to a single-threaded test.
//
// Every function takes an `sql` client rather than reaching for one.
// All of them FAIL TOWARD SHEDDING: if the guard is broken or
// unreachable, the answer is "do not fetch, redirect the visitor
// instead" -- the safe direction, since an unguarded fetch is what
// produced the Wikimedia rate-limit hold.

// Lives in config.toml's [img_cache_fetch_guard] -- baked in at build
// time, never read live.
import { TRANQUILO_CONFIG } from "./config.generated.ts";

const CLAIM_TTL_SECONDS =
  TRANQUILO_CONFIG.img_cache_fetch_guard.claim_ttl_seconds;

/**
 * 1b: single-flight. Returns true if THIS caller should fetch, false
 * if someone else already holds a live claim on the same key.
 *
 * The ON CONFLICT clause is the whole mechanism: an insert wins on a
 * free key, and DO UPDATE ... WHERE expires_at < now() lets a caller
 * take over a key whose previous holder died. One statement, no race
 * window.
 */
async function claimFetch(
  sql: any,
  cacheKey: string,
  ttlSeconds?: number | null,
): Promise<boolean> {
  if (!sql) return false;
  const ttl = ttlSeconds || CLAIM_TTL_SECONDS;
  try {
    const rows = await sql(
      "INSERT INTO img_fetch_claims (cache_key, claimed_at, expires_at) " +
        "VALUES ($1, now(), now() + ($2 || ' seconds')::interval) " +
        "ON CONFLICT (cache_key) DO UPDATE " +
        "  SET claimed_at = now(), expires_at = now() + ($2 || ' seconds')::interval " +
        "  WHERE img_fetch_claims.expires_at < now() " +
        "RETURNING cache_key",
      [cacheKey, String(ttl)],
    );
    return rows.length > 0;
  } catch (_err) {
    return false;
  }
}

/** Releases a claim once the fetch finishes, so the next miss doesn't
 *  wait out the full TTL. Best-effort: expiry is the real guarantee. */
async function releaseFetch(sql: any, cacheKey: string): Promise<void> {
  if (!sql) return;
  try {
    await sql("DELETE FROM img_fetch_claims WHERE cache_key = $1", [cacheKey]);
  } catch (_err) {
    // The claim expires on its own.
  }
}

/**
 * 1c + 1d: spend one token for `source`, unless it's in a Retry-After
 * cooldown. Refill is computed lazily from elapsed time, so nothing to
 * schedule or drift; refill, cooldown check and spend are one atomic
 * UPDATE, so concurrent callers can't both spend the last token.
 */
async function acquireFetchToken(sql: any, source: string): Promise<any> {
  if (!sql) return { allowed: false, reason: "no-db", tokens: 0 };
  try {
    const rows = await sql(
      "UPDATE source_fetch_state SET " +
        "  tokens = LEAST(capacity, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) * refill_per_sec) - 1, " +
        "  last_refill = now(), " +
        "  updated_at = now() " +
        "WHERE source = $1 " +
        "  AND hold_reason IS NULL " +
        "  AND (blocked_until IS NULL OR blocked_until <= now()) " +
        "  AND LEAST(capacity, tokens + EXTRACT(EPOCH FROM (now() - last_refill)) * refill_per_sec) >= 1 " +
        "RETURNING tokens",
      [source],
    );
    if (rows.length)
      return { allowed: true, reason: "ok", tokens: Number(rows[0].tokens) };

    // Denied -- distinguish cooldown from exhaustion; an unknown source
    // means a config gap, not a busy one.
    const state = await sql(
      "SELECT blocked_until, tokens, hold_reason FROM source_fetch_state WHERE source = $1",
      [source],
    );
    if (!state.length)
      return { allowed: false, reason: "unknown-source", tokens: 0 };
    // Ordered most-permanent first: a held source is held whatever
    // else is true, so it must not read as merely "no-tokens".
    if (state[0].hold_reason) {
      return {
        allowed: false,
        reason: "held",
        tokens: Number(state[0].tokens),
        hold: state[0].hold_reason,
      };
    }
    const blocked =
      state[0].blocked_until && new Date(state[0].blocked_until) > new Date();
    return {
      allowed: false,
      reason: blocked ? "cooldown" : "no-tokens",
      tokens: Number(state[0].tokens),
    };
  } catch (_err) {
    return { allowed: false, reason: "error", tokens: 0 };
  }
}

/**
 * 1d: park a source after a 429, replacing the old inline 3x retry
 * (which sent more requests to a source that just asked us to stop).
 * `Retry-After` may be seconds or an HTTP date; a conservative default
 * applies if absent or unparseable.
 */
function parseRetryAfter(
  headerValue?: string | null,
  defaultSeconds?: number | null,
): number {
  const fallback = defaultSeconds == null ? 300 : defaultSeconds;
  if (!headerValue) return fallback;
  const asNumber = Number(String(headerValue).trim());
  if (Number.isFinite(asNumber) && asNumber >= 0)
    return Math.min(asNumber, 86400);
  const asDate = Date.parse(String(headerValue));
  if (!Number.isNaN(asDate)) {
    const secs = Math.ceil((asDate - Date.now()) / 1000);
    return Math.min(Math.max(secs, 0), 86400);
  }
  return fallback;
}

/* The host half of the gate: acquireFetchToken() answers "is this
 * SOURCE allowed at all" (policy, the Wikimedia hold); this answers
 * "does this SERVER have budget right now" (behaviour). Both must pass.
 * The split exists because Europeana is 26 institutions behind one
 * source key, so a source-level budget alone could let one small
 * library's 429 pause all 26. Creates the row on first sight rather
 * than needing a hand-maintained institution list. */
async function acquireHostToken(
  sql: any,
  host: string,
  source?: string | null,
): Promise<any> {
  if (!sql) return { allowed: false, reason: "no-db", tokens: 0 };
  if (!host) return { allowed: false, reason: "no-host", tokens: 0 };
  try {
    // Create-if-absent and spend in one statement, so two concurrent
    // misses can't both see a fresh full bucket.
    const rows = await sql(
      "INSERT INTO host_fetch_state (host, source, tokens, last_refill, updated_at) " +
        "VALUES ($1, $2, DEFAULT, now(), now()) " +
        "ON CONFLICT (host) DO UPDATE SET " +
        "  tokens = LEAST(host_fetch_state.capacity, " +
        "    host_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - host_fetch_state.last_refill)) " +
        "      * host_fetch_state.refill_per_sec) - 1, " +
        "  last_refill = now(), " +
        "  source = COALESCE(EXCLUDED.source, host_fetch_state.source), " +
        "  updated_at = now() " +
        "WHERE (host_fetch_state.blocked_until IS NULL OR host_fetch_state.blocked_until <= now()) " +
        "  AND LEAST(host_fetch_state.capacity, " +
        "    host_fetch_state.tokens + EXTRACT(EPOCH FROM (now() - host_fetch_state.last_refill)) " +
        "      * host_fetch_state.refill_per_sec) >= 1 " +
        "RETURNING tokens",
      [host, source || null],
    );
    if (rows.length)
      return { allowed: true, reason: "ok", tokens: Number(rows[0].tokens) };

    const state = await sql(
      "SELECT blocked_until, tokens FROM host_fetch_state WHERE host = $1",
      [host],
    );
    if (!state.length)
      return { allowed: false, reason: "host-unknown", tokens: 0 };
    if (
      state[0].blocked_until &&
      new Date(state[0].blocked_until) > new Date()
    ) {
      return {
        allowed: false,
        reason: "host-cooldown",
        tokens: Number(state[0].tokens),
        until: state[0].blocked_until,
      };
    }
    return {
      allowed: false,
      reason: "host-no-tokens",
      tokens: Number(state[0].tokens),
    };
  } catch (_err) {
    return { allowed: false, reason: "host-error", tokens: 0 };
  }
}

/* Parks ONE host for the window it asked for, replacing blockSource()
 * on the 429 path -- a small library's rate limit is a fact about that
 * library's server, not the aggregator, so pausing all 26 Europeana
 * institutions for one of them was punishing the other 25. */
async function blockHost(
  sql: any,
  host: string,
  seconds: number,
  source?: string | null,
): Promise<void> {
  if (!sql || !host) return;
  try {
    await sql(
      "INSERT INTO host_fetch_state (host, source, blocked_until, consecutive_failures, last_status) " +
        "VALUES ($1, $2, now() + ($3 || ' seconds')::interval, 1, 429) " +
        "ON CONFLICT (host) DO UPDATE SET " +
        "  blocked_until = now() + ($3 || ' seconds')::interval, " +
        "  consecutive_failures = host_fetch_state.consecutive_failures + 1, " +
        "  last_status = 429, updated_at = now()",
      [host, source || null, String(seconds)],
    );
  } catch (_err) {
    // Best effort -- the token bucket still limits the damage.
  }
}

async function recordHostOutcome(
  sql: any,
  host: string,
  status: number,
  ok: boolean,
): Promise<void> {
  if (!sql || !host) return;
  try {
    await sql(
      "UPDATE host_fetch_state SET " +
        "  consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures + 1 END, " +
        "  last_status = $2, " +
        "  last_ok_at = CASE WHEN $3 THEN now() ELSE last_ok_at END, " +
        "  updated_at = now() " +
        "WHERE host = $1",
      [host, status, ok],
    );
  } catch (_err) {
    // Never fail a request over bookkeeping.
  }
}

async function blockSource(
  sql: any,
  source: string,
  seconds: number,
): Promise<void> {
  if (!sql) return;
  try {
    await sql(
      "UPDATE source_fetch_state SET blocked_until = now() + ($2 || ' seconds')::interval, " +
        "  consecutive_failures = consecutive_failures + 1, last_status = 429, updated_at = now() " +
        "WHERE source = $1",
      [source, String(seconds)],
    );
  } catch (_err) {
    // Best effort -- the token bucket still limits the damage.
  }
}

/** 1a: record the outcome of an origin fetch against the source's health. */
async function recordOriginOutcome(
  sql: any,
  source: string,
  status: number,
  ok: boolean,
): Promise<void> {
  if (!sql) return;
  try {
    await sql(
      "UPDATE source_fetch_state SET " +
        "  consecutive_failures = CASE WHEN $3 THEN 0 ELSE consecutive_failures + 1 END, " +
        "  last_status = $2, " +
        "  last_ok_at = CASE WHEN $3 THEN now() ELSE last_ok_at END, " +
        "  updated_at = now() " +
        "WHERE source = $1",
      [source, status, ok],
    );
  } catch (_err) {
    // Health recording must never break the request it describes.
  }
}

/**
 * 1a/A2: bump aggregate counters, one row per (day, source, tier) --
 * never a per-request log, which keeps this anonymous by construction
 * and cheap.
 *
 * `hits` counts FUNCTION-OBSERVED hits, not images served -- the
 * proxy's 302 response is `immutable, max-age=31536000`, so after the
 * first request per CDN edge the redirect is served by Vercel's CDN
 * and this function never runs again. Do not quote hits/(hits+misses)
 * as a cache hit rate; misses/sheds/origin outcomes ARE exact, since
 * every one of those necessarily runs the function.
 */
const STAT_FIELDS: string[] = [
  "hits",
  "misses",
  "origin_ok",
  "origin_429",
  "origin_error",
  "shed",
];

/* An allowlist, not a free-form column: the proxy emits
 * "not-admitted-" + verdict.requests, which is unbounded, and this
 * table's row count must grow with distinct REASONS, not with request
 * counts. Anything unrecognised folds into 'other' -- a visible prompt
 * to add it here, rather than silent schema growth. */
const SHED_REASONS: string[] = [
  "not-admitted", // healthy: admission control
  "in-flight", // healthy: single-flight
  "held",
  "cooldown",
  "no-tokens",
  "unknown-source",
  "host-cooldown",
  "host-no-tokens",
  "host-unknown",
  "no-host",
  "origin-429",
  "origin-error",
  "no-db",
  "error",
  "breaker",
  // Orthogonal to every reason above: a display-tier shed hands the
  // visitor's own browser a 302 straight to the raw origin URL, with
  // none of imageFetchHeaders()'s identifying headers -- a source
  // rejecting that (Europeana's Cloudflare WAF did) is a different
  // failure shape from our own fetch failing. Bumped as a second write
  // alongside the cause reason, so both facts stay visible.
  "origin-handoff",
];

function normalizeShedReason(reason?: string | null): string {
  if (typeof reason !== "string" || !reason) return "other";
  // The N is dropped -- it's a distribution, not an alerting signal,
  // and img_cache_entries.requests already holds it per item. The full
  // string still goes out on the X-Tranquilo-Shed header.
  if (/^not-admitted-\d+$/.test(reason)) return "not-admitted";
  return SHED_REASONS.indexOf(reason) === -1 ? "other" : reason;
}

/* One row per (day, source, tier, reason), counting up -- never a row
 * per request, see sql/013_img_shed_stats.sql. */
async function bumpShedReason(
  sql: any,
  source: string,
  tier: string,
  reason?: string | null,
): Promise<void> {
  if (!sql) return;
  try {
    await sql(
      "INSERT INTO img_shed_stats (day, source, tier, reason, n) " +
        "VALUES (CURRENT_DATE, $1, $2, $3, 1) " +
        "ON CONFLICT (day, source, tier, reason) DO UPDATE " +
        "  SET n = img_shed_stats.n + 1",
      [source, tier, normalizeShedReason(reason)],
    );
  } catch (_err) {
    // Metrics aren't worth failing a request over.
  }
}

async function bumpStat(
  sql: any,
  source: string,
  tier: string,
  field: string,
): Promise<void> {
  if (!sql) return;
  if (STAT_FIELDS.indexOf(field) === -1) return; // never interpolate an unvetted name
  try {
    await sql(
      `INSERT INTO img_cache_stats (day, source, tier, ${field}) ` +
        `VALUES (CURRENT_DATE, $1, $2, 1) ` +
        `ON CONFLICT (day, source, tier) DO UPDATE ` +
        `  SET ${field} = img_cache_stats.${field} + 1`,
      [source, tier],
    );
  } catch (_err) {
    // Metrics aren't worth failing a request over.
  }
}

export {
  acquireFetchToken,
  acquireHostToken,
  blockHost,
  blockSource,
  bumpShedReason,
  bumpStat,
  CLAIM_TTL_SECONDS,
  claimFetch,
  normalizeShedReason,
  parseRetryAfter,
  recordHostOutcome,
  recordOriginOutcome,
  releaseFetch,
  SHED_REASONS,
  STAT_FIELDS,
};
