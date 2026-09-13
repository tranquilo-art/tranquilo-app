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
 * Spends one token for `ip`. Returns { allowed, reason, tokens }.
 *
 * Fails OPEN, not closed -- the opposite of the origin-side guards. Those
 * protect a museum's server from us and treat "we can't tell" as "don't
 * fetch". This protects OUR budget from a visitor, and a database we can't
 * reach is not a reason to 429 every visitor on the site; it just means this
 * particular safety net is unavailable for the moment.
 */
async function acquireVisitorToken(sql: any, ip: string): Promise<any> {
  if (!sql || !ip)
    return { allowed: true, reason: "no-db-or-ip", tokens: null };
  try {
    const rows = await sql.query(ACQUIRE_SQL, [ip]);
    if (rows.length)
      return { allowed: true, reason: "ok", tokens: Number(rows[0].tokens) };
    return { allowed: false, reason: "rate-limited", tokens: 0 };
  } catch (_err) {
    return { allowed: true, reason: "error", tokens: null };
  }
}

/**
 * The visitor's IP, best-effort. x-forwarded-for's first entry is the real
 * client (Vercel appends its own hop); req.socket.remoteAddress would just
 * be Vercel's edge. Returns null on a request we can't identify, since
 * acquireVisitorToken() treats that as "allow", not "deny everyone".
 */
function clientIp(req: any): string | null {
  const xff = req?.headers?.["x-forwarded-for"];
  if (xff) {
    const first = String(Array.isArray(xff) ? xff[0] : xff)
      .split(",")[0]
      .trim();
    if (first) return first;
  }
  const real = req?.headers?.["x-real-ip"];
  if (real) return String(Array.isArray(real) ? real[0] : real).trim();
  return null;
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
  sql: any,
  req: any,
  res: any,
): Promise<boolean> {
  const ip = clientIp(req);
  const verdict = await acquireVisitorToken(sql, ip as any);
  if (verdict.allowed) return false;
  const retryAfter = retryAfterSeconds();
  res.statusCode = 429;
  res.setHeader("Retry-After", String(retryAfter));
  res.setHeader("Cache-Control", "no-store");
  res.json({ error: "Too many requests", retryAfter: retryAfter });
  return true;
}

import { TRANQUILO_CONFIG } from "./config.generated.ts";

export { acquireVisitorToken, clientIp, rateLimitOrRespond, retryAfterSeconds };
