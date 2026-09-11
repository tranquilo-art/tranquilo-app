/* The ways the image cache stops working without saying so.
 *
 * Read by the daily health-check cron. Every function returns an array
 * of human-readable lines, empty when there's nothing to say, and every
 * one fails SAFE: a check that throws reports nothing, which is worse
 * than reporting nothing on purpose.
 *
 * Two conditions are deliberately NOT here, since alerting on them
 * would mislead:
 *
 *   cache hit-rate collapse   the proxy's hit response is an immutable
 *                             302, so after the first request per CDN
 *                             edge the function never runs and never
 *                             counts -- hits/(hits+misses) is not a
 *                             real hit rate (see bumpStat's own note).
 *
 *   sustained shed rate       shedding is NORMAL (~20% of requests,
 *                             nearly all one-offs correctly declined),
 *                             and `shed` alone carries no reason, so a
 *                             threshold on it can't distinguish
 *                             admission control working from a real
 *                             problem. checkShedReasons() below is the
 *                             version of this that IS buildable, using
 *                             reason granularity.
 */

/* A source whose token bucket is empty WHILE it's being requested --
 * its cache can never fill, silently.
 *
 * Excludes: held sources (no budget by design, alerting would page
 * about a decision we made), a Retry-After cooldown (the guard
 * working, self-clearing), and an empty bucket nobody is requesting
 * (not a problem, just quiet). */
async function checkTokenBuckets(sql: any): Promise<string[]> {
  if (!sql) return [];
  try {
    const rows = await sql(
      "SELECT s.source, s.tokens, s.refill_per_sec, " +
        "       COALESCE(a.attempts, 0) AS attempts " +
        "  FROM source_fetch_state s " +
        "  LEFT JOIN (SELECT source, SUM(misses + shed) AS attempts " +
        "               FROM img_cache_stats WHERE day >= CURRENT_DATE - 1 " +
        "              GROUP BY source) a ON a.source = s.source " +
        " WHERE s.hold_reason IS NULL " +
        "   AND (s.blocked_until IS NULL OR s.blocked_until <= now()) " +
        "   AND s.tokens < 1 " +
        "   AND COALESCE(a.attempts, 0) >= $1",
      [TOKEN_STARVATION_MIN_ATTEMPTS],
    );
    return rows.map(
      (r: any) =>
        `Image source '${r.source}' has an empty fetch budget (${Number(
          r.tokens,
        ).toFixed(1)} tokens, refilling at ${
          r.refill_per_sec
        }/sec) while still being requested ${r.attempts} times in the last ` +
        `24h. Its cache cannot fill: every request is being served by ` +
        `redirecting the visitor to the source instead.`,
    );
  } catch (_err) {
    return [];
  }
}

/* Keys we keep requesting and keep not holding -- either evicted and
 * re-requested in a loop, or admitted and failing to store. Either
 * way, the origin cost is paid repeatedly for nothing. The `requests`
 * floor excludes ordinary one-off traffic, which is the common case. */
async function checkEvictionThrash(sql: any): Promise<string[]> {
  if (!sql) return [];
  try {
    const rows = await sql(
      "SELECT count(*)::int AS n FROM img_cache_entries " +
        " WHERE bytes IS NULL AND requests >= $1",
      [THRASH_MIN_REQUESTS],
    );
    const n = rows.length ? Number(rows[0].n) : 0;
    if (n < THRASH_MIN_KEYS) return [];
    return [
      `${n} cached images have been requested at least ${
        THRASH_MIN_REQUESTS
      } times each and are still not stored. That is ` +
        `eviction thrash or a failing store: we are paying the origin cost ` +
        `repeatedly and keeping nothing. Usually means the storage budget is ` +
        `too small or the pin set too large.`,
    ];
  } catch (_err) {
    return [];
  }
}

/* Safety net for anything the real-time 429 alert missed (a function
 * that died before Sentry flushed, or its own once-per-window guard
 * suppressing a repeat). */
async function checkRateLimits(sql: any): Promise<string[]> {
  if (!sql) return [];
  try {
    // The last COMPLETE day, not a rolling window -- img_cache_stats
    // is day-granular, so a rolling window would report each 429 twice.
    const rows = await sql(
      "SELECT source, SUM(origin_429)::int AS n FROM img_cache_stats " +
        " WHERE day = CURRENT_DATE - 1 GROUP BY source HAVING SUM(origin_429) > 0",
    );
    return rows.map(
      (r: any) =>
        `Image source '${r.source}' returned ${r.n} rate-limit ` +
        `(429) response(s) yesterday. This is the failure mode that ` +
        `produced the Wikimedia rate-limit hold -- check the per-host budgets before ` +
        `it becomes a block.`,
    );
  } catch (_err) {
    return [];
  }
}

/* Shedding for a reason that is NOT admission control -- 'not-admitted'
 * and 'in-flight' are excluded since both mean the system is working
 * (a one-off correctly declined, or single-flight coalescing a
 * stampede). Everything else means a budget, cooldown, failing origin
 * or tripped breaker. Same last-complete-day reasoning as
 * checkRateLimits(). */
async function checkShedReasons(sql: any): Promise<string[]> {
  if (!sql) return [];
  try {
    const rows = await sql(
      "SELECT source, reason, SUM(n)::int AS n FROM img_shed_stats " +
        " WHERE day = CURRENT_DATE - 1 " +
        "   AND reason NOT IN ('not-admitted', 'in-flight') " +
        " GROUP BY source, reason HAVING SUM(n) >= $1 " +
        " ORDER BY SUM(n) DESC",
      [SHED_REASON_MIN],
    );
    return rows.map(
      (r: any) =>
        `Image source '${r.source}' shed ${r.n} request(s) ` +
        `yesterday for reason '${r.reason}' -- not admission control. ` +
        `Its cache is not filling for a reason worth understanding: every one ` +
        `of those was served by redirecting the visitor to the source.`,
    );
  } catch (_err) {
    return [];
  }
}

/* Vercel Blob suspends the whole store when Hobby-tier Simple
 * Operations run out for the month, with no API flag to check --
 * put() is what actually fails ("This store has been suspended"), so
 * this spends one disposable probe object and reads what comes back.
 *
 * Temporary: only needed while the S3 migration stays paused on the
 * Simple Operations lockout. Delete this check (and sql/032's column)
 * once that migration finishes.
 *
 * Alerts on a state CHANGE only -- daily confirmation of a known,
 * unactionable fact trains a reader to stop opening the alert. The
 * flip back to available is deliberately probed for rather than
 * assumed at the calendar reset, since some suspensions need manual
 * Vercel reactivation. */
const BLOB_PROBE_PATHNAME = "health-check/blob-suspension-probe";

async function checkBlobSuspended(
  sql: any,
  putFn: any,
  delFn: any,
): Promise<string[]> {
  if (!sql) return [];
  let rows: any[];
  try {
    rows = await sql(
      "SELECT simple_ops_suspended_since FROM blob_usage_tracker WHERE id = 1",
    );
  } catch (_err) {
    return []; // tracker not provisioned
  }
  if (!rows.length) return [];
  const wasSuspended = rows[0].simple_ops_suspended_since !== null;

  let isSuspended: boolean;
  try {
    const written = await putFn(BLOB_PROBE_PATHNAME, "ok", {
      access: "public",
      addRandomSuffix: false,
      contentType: "text/plain",
    });
    isSuspended = false;
    try {
      await delFn(written.url);
    } catch (_err) {
      // Best-effort -- a stray probe object is harmless either way.
    }
  } catch (err) {
    const msg = String((err && (err as any).message) || err);
    if (!/suspend/i.test(msg)) {
      // A real, different failure -- always worth seeing.
      return [
        `Vercel Blob write probe failed with an unexpected error (not the ` +
          `known suspension): ${msg}`,
      ];
    }
    isSuspended = true;
  }

  if (isSuspended === wasSuspended) return []; // no change; stay quiet

  try {
    await sql(
      "UPDATE blob_usage_tracker SET simple_ops_suspended_since = $1 WHERE id = 1",
      [isSuspended ? new Date().toISOString() : null],
    );
  } catch (_err) {
    return []; // couldn't record the transition; don't alert on a flip we can't remember tomorrow
  }

  return [
    isSuspended
      ? "Vercel Blob store is now SUSPENDED (Simple Operations quota hit). " +
        "This is the known Hobby-tier lockout -- S3 migration " +
        "stays paused until it clears. No action needed unless it persists " +
        "past the monthly reset, since some suspensions need Vercel " +
        "support to reactivate rather than clearing on their own."
      : "Vercel Blob Simple Operations are AVAILABLE again -- the " +
        "suspension has cleared. This is the signal to resume the S3 " +
        "migration.",
  ];
}

// Thresholds live in config.toml's [img_cache_alerts] -- baked in at
// build time, never read live.
import { TRANQUILO_CONFIG } from "./config.generated.ts";

const SHED_REASON_MIN = TRANQUILO_CONFIG.img_cache_alerts.shed_reason_min;
const TOKEN_STARVATION_MIN_ATTEMPTS =
  TRANQUILO_CONFIG.img_cache_alerts.token_starvation_min_attempts;
const THRASH_MIN_REQUESTS =
  TRANQUILO_CONFIG.img_cache_alerts.thrash_min_requests;
const THRASH_MIN_KEYS = TRANQUILO_CONFIG.img_cache_alerts.thrash_min_keys;

export {
  checkBlobSuspended,
  checkEvictionThrash,
  checkRateLimits,
  checkShedReasons,
  checkTokenBuckets,
  SHED_REASON_MIN,
  THRASH_MIN_KEYS,
  THRASH_MIN_REQUESTS,
  TOKEN_STARVATION_MIN_ATTEMPTS,
};
