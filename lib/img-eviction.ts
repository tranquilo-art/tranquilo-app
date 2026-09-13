// Frees space by deleting the coldest cached objects.
//
// Ships disabled -- IMG_EVICTION_ENABLED must be "1" to arm it. Usage
// doesn't ramp gently with catalogue size; it steps with traffic
// (storage is catalogue x coverage, and a launch can fill the
// near-empty lightbox tier quickly), and the breaker fails CLOSED and
// silently once the cap is hit. A destructive operation like this can
// only be verified safely while there's slack, which is why arming it
// deliberately (via a lowered cap in a dry run) matters more than
// waiting for the wall to arrive.
//
// Runs inline rather than as a cron: Vercel Hobby's minimum cron
// interval is daily, which can't hold a cache under a cap. Bounded to
// a few deletions per call, only once usage is over the high-water
// mark -- below that it costs one cheap read. Self-regulating: more
// traffic means more eviction pressure and more chances to evict.

// Values live in config.toml's [img_cache_eviction] -- baked in at
// build time, never read live.
import { TRANQUILO_CONFIG } from "./config.generated.ts";

const HIGH_WATER = TRANQUILO_CONFIG.img_cache_eviction.high_water;
const LOW_WATER = TRANQUILO_CONFIG.img_cache_eviction.low_water;
const MAX_EVICTIONS_PER_CALL =
  TRANQUILO_CONFIG.img_cache_eviction.max_evictions_per_call;

// The five hero items are the one genuinely fixed part of the feed --
// every session opens on them before shuffling. A live dry run once
// picked a hero as an eviction candidate, since reconcile stamps
// last_seen from an object's UPLOAD time, so until traffic refreshes it
// the ordering is "cached earliest", and heroes were cached earliest of
// all. Kept as ids (not cache keys) so both tiers of a hero are covered.
const PINNED_IDS: string[] = (
  process.env.IMG_PINNED_IDS || "191811,436528,261941,438821,437397"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

/* The item id inside a cache key (source:id:tier). NOT
 * split_part(cache_key, ':', 2) -- Commons native ids contain colons
 * (e.g. "commons:File:Some Painting.jpg:display"), so split_part
 * returns "File" for all of them, which either protects nothing (a
 * pinned Commons id never matches) or protects every Commons object at
 * once (pinning "File" itself), tripping the breaker on a cache that's
 * mostly Commons. The greedy `(.*)` takes everything between the FIRST
 * and LAST colon instead. One definition, shared by both queries below
 * so a dry run previews the same victims the real pass would take. */
const CACHE_KEY_ID_SQL =
  "regexp_replace(e.cache_key, '^[^:]*:(.*):[^:]*$', '\\1')";

function isEnabled(): boolean {
  return process.env.IMG_EVICTION_ENABLED === "1";
}

/**
 * The N coldest evictable candidates, without touching anything.
 *
 * Separate from the eviction loop since the loop re-queries "the
 * coldest" each pass -- without a real deletion it would return the
 * same row every time. Selecting a batch up front is the only honest
 * preview.
 */
async function previewEvictions(sql: any, count: number): Promise<any[]> {
  if (!sql) return [];
  try {
    return await sql.query(
      `SELECT e.cache_key, e.bytes, e.last_seen, e.requests FROM img_cache_entries e ` +
        `LEFT JOIN img_fetch_claims c ` +
        `  ON c.cache_key = e.cache_key AND c.expires_at > now() ` +
        `WHERE e.bytes IS NOT NULL AND c.cache_key IS NULL ` +
        `  AND NOT (${CACHE_KEY_ID_SQL} = ANY($2)) ` +
        `ORDER BY e.last_seen ASC LIMIT $1`,
      [count, PINNED_IDS],
    );
  } catch (_err) {
    return [];
  }
}

/**
 * Frees space if over the high-water mark. Returns a summary.
 *
 * `del` is injected so tests can drive it without Blob, and so a
 * caller can pass a no-op to dry-run against production data.
 */
async function evictIfNeeded(
  sql: any,
  del: (cacheKey: string) => any,
  options?: { cap?: number; force?: boolean; dryRun?: boolean } | null,
): Promise<any> {
  const opts = options || {};
  const cap = Number(opts.cap);
  if (!sql || !del || !Number.isFinite(cap) || cap <= 0) {
    return { ran: false, reason: "not-configured", freed: 0, evicted: 0 };
  }
  if (!opts.force && !isEnabled()) {
    return { ran: false, reason: "disabled", freed: 0, evicted: 0 };
  }

  let used: number;
  try {
    const rows = await sql.query(
      "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
    );
    if (!rows.length)
      return { ran: false, reason: "no-tracker", freed: 0, evicted: 0 };
    used = Number(rows[0].total_bytes);
  } catch (_err) {
    return { ran: false, reason: "error", freed: 0, evicted: 0 };
  }

  if (used < cap * HIGH_WATER) {
    return {
      ran: false,
      reason: "below-high-water",
      used: used,
      freed: 0,
      evicted: 0,
    };
  }

  const target = cap * LOW_WATER;

  // Dry run: work out what WOULD go and report it, delete nothing --
  // how this destructive operation gets verified against real Blob
  // while there's still slack, by forcing the condition with a
  // deliberately low `cap`.
  if (opts.dryRun) {
    const need = used - target;
    const preview = await previewEvictions(sql, MAX_EVICTIONS_PER_CALL);
    let running = 0;
    const wouldEvict = [];
    for (let k = 0; k < preview.length && running < need; k++) {
      running += Number(preview[k].bytes) || 0;
      wouldEvict.push(preview[k]);
    }
    return {
      ran: true,
      reason: "dry-run",
      used: used,
      target: target,
      would_free: running,
      would_evict: wouldEvict,
      evicted: 0,
      freed: 0,
    };
  }
  let freed = 0,
    evicted = 0,
    failed = 0;

  for (let i = 0; i < MAX_EVICTIONS_PER_CALL && used - freed > target; i++) {
    let victim: any;
    try {
      // Coldest first, and never something mid-flight: a live claim
      // means someone is fetching that key now, and deleting it
      // underneath them would leave the tracker crediting bytes that
      // are no longer there.
      const picked = await sql.query(
        `SELECT e.cache_key, e.bytes FROM img_cache_entries e ` +
          `LEFT JOIN img_fetch_claims c ` +
          `  ON c.cache_key = e.cache_key AND c.expires_at > now() ` +
          `WHERE e.bytes IS NOT NULL AND c.cache_key IS NULL ` +
          `  AND NOT (${CACHE_KEY_ID_SQL} = ANY($1)) ` +
          `ORDER BY e.last_seen ASC LIMIT 1`,
        [PINNED_IDS],
      );
      if (!picked.length) break;
      victim = picked[0];
    } catch (_err) {
      break;
    }

    const bytes = Number(victim.bytes) || 0;
    try {
      await del(victim.cache_key);
    } catch (_err) {
      // Do NOT drop the row or credit the bytes -- claiming space we
      // didn't free drifts the tracker toward tripping the breaker on
      // a cache that's mostly empty.
      failed++;
      // Push to the back of the queue so one undeletable object can't
      // block eviction forever by always being coldest.
      try {
        await sql.query(
          "UPDATE img_cache_entries SET last_seen = now() WHERE cache_key = $1",
          [victim.cache_key],
        );
      } catch (_e2) {
        /* nothing further to try */
      }
      continue;
    }

    // Clearing `bytes` rather than deleting the row keeps the request
    // history, so a re-popular image is re-admitted on its history
    // rather than starting over.
    try {
      await sql.query(
        "UPDATE blob_usage_tracker SET total_bytes = GREATEST(0, total_bytes - $1) " +
          "WHERE id = 1",
        [bytes],
      );
      await sql.query(
        "UPDATE img_cache_entries SET bytes = NULL, admitted_at = NULL " +
          "WHERE cache_key = $1",
        [victim.cache_key],
      );
    } catch (_err) {
      // Deleted but not fully recorded -- the tracker over-counts,
      // which is the safe direction: it evicts more, not overruns the cap.
    }
    freed += bytes;
    evicted++;
  }

  return {
    ran: true,
    reason: "evicted",
    used: used,
    freed: freed,
    evicted: evicted,
    failed: failed,
    target: target,
  };
}

export {
  CACHE_KEY_ID_SQL,
  evictIfNeeded,
  HIGH_WATER,
  isEnabled,
  LOW_WATER,
  MAX_EVICTIONS_PER_CALL,
  PINNED_IDS,
  previewEvictions,
};
