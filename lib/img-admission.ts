// Decide whether a cache miss is worth STORING. A plain LRU writes everything
// once, including one-off views that are the worst occupants of a fixed
// budget; declining to write them beats writing and evicting them later.

// Both tiers require a second request before admitting. Lightbox was 1 (a
// tap is a strong signal) until raised to 2: lightbox can never shed to
// origin (master is 20-53MB), so every first open of an uncached item is a
// forced server-side fetch straight at the institution -- which produced the
// bvpb.mcu.es 429. The client now shows the display blob immediately and
// upgrades in the background (upgradeLightbox() in js/app.js), which also
// supplies the second request this threshold needs.
//
// Both overridable by env var since the right numbers depend on the
// one-off share of traffic, answerable from img_cache_entries.requests.
const DEFAULT_THRESHOLDS: Record<string, number> = { display: 2, lightbox: 2 };

function thresholdFor(tier: string): number {
  const envKey = `IMG_ADMIT_THRESHOLD_${String(tier).toUpperCase()}`;
  const override = Number(process.env[envKey]);
  if (Number.isFinite(override) && override >= 1) return Math.floor(override);
  return DEFAULT_THRESHOLDS[tier] || 1;
}

// Velocity-based escape hatch: the normal threshold is a lifetime count with
// no decay, so raising it (the lever ops reaches for when Blob operations run
// hot) would also slow caching for something going viral right now. A burst
// of FAST_PATH_MIN_REQUESTS within FAST_PATH_WINDOW_SECONDS admits regardless
// of a raised threshold. Default 3 is deliberately above the default
// threshold (2) so this never fires under normal operation.
const FAST_PATH_MIN_REQUESTS_DEFAULT = 3;
const FAST_PATH_WINDOW_SECONDS_DEFAULT = 60;

function fastPathMinRequests(): number {
  const override = Number(process.env.IMG_ADMIT_FASTPATH_REQUESTS);
  if (Number.isFinite(override) && override >= 1) return Math.floor(override);
  return FAST_PATH_MIN_REQUESTS_DEFAULT;
}

function fastPathWindowSeconds(): number {
  const override = Number(process.env.IMG_ADMIT_FASTPATH_WINDOW_SECONDS);
  if (Number.isFinite(override) && override >= 1) return Math.floor(override);
  return FAST_PATH_WINDOW_SECONDS_DEFAULT;
}

/**
 * Records this request against the key and returns whether it should be
 * stored. One statement: the count and the decision cannot disagree, and two
 * concurrent misses cannot both read "1" and both decide not to admit.
 *
 * Returns { admit, requests }. On any failure it returns admit:false -- the
 * image is still served, it just is not cached this time. Failing toward
 * "serve but do not store" keeps the visitor working while refusing to spend
 * storage on a decision we could not actually make.
 */
// nativeId is passed explicitly rather than parsed back out of cacheKey,
// since Commons ids contain colons and would corrupt a split (see
// lib/img-eviction.ts's CACHE_KEY_ID_SQL).
async function noteRequest(
  sql: any,
  cacheKey: string,
  source: string,
  tier: string,
  nativeId?: any,
): Promise<any> {
  if (!sql) return { admit: false, requests: 0, reason: "no-db" };
  const threshold = thresholdFor(tier);
  try {
    const rows = await sql.query(
      "INSERT INTO img_cache_entries (cache_key, source, tier, native_id, requests, first_seen, last_seen) " +
        "VALUES ($1, $2, $3, $4, 1, now(), now()) " +
        "ON CONFLICT (cache_key) DO UPDATE " +
        "  SET requests = img_cache_entries.requests + 1, last_seen = now(), " +
        // COALESCE, not an unconditional set: the conflict path runs on every
        // repeat view, so a caller that happens to pass no id must not blank an
        // id already recorded. Written this way round it also repairs a row that
        // predates the column, for free, on the next request for it.
        "      native_id = COALESCE(img_cache_entries.native_id, EXCLUDED.native_id) " +
        // first_seen is set once, on INSERT, and never touched by the UPDATE
        // branch -- so this reads the ORIGINAL first-seen time on every call,
        // which is what makes "seconds since first" measure a burst rather than
        // resetting every request.
        "RETURNING requests, bytes, EXTRACT(EPOCH FROM (now() - first_seen))::float8 AS seconds_since_first",
      [cacheKey, source, tier, nativeId == null ? null : String(nativeId)],
    );
    if (!rows.length) return { admit: false, requests: 0, reason: "no-row" };
    const requests = Number(rows[0].requests);
    // Already stored: this is a re-request of something we hold. Nothing to
    // admit, but last_seen has been refreshed above, which is what keeps it
    // out of the eviction scan.
    if (rows[0].bytes != null) {
      return { admit: false, requests: requests, reason: "already-stored" };
    }
    if (requests >= threshold) {
      return {
        admit: true,
        requests: requests,
        threshold: threshold,
        reason: "admitted",
      };
    }
    // See fastPathMinRequests()'s own header for why this exists: a velocity
    // burst can admit even when the lifetime count has not reached threshold.
    const secondsSinceFirst = Number(rows[0].seconds_since_first);
    const fastPathHit =
      requests >= fastPathMinRequests() &&
      Number.isFinite(secondsSinceFirst) &&
      secondsSinceFirst <= fastPathWindowSeconds();
    if (fastPathHit) {
      return {
        admit: true,
        requests: requests,
        threshold: threshold,
        reason: "fast-path",
      };
    }
    return {
      admit: false,
      requests: requests,
      threshold: threshold,
      reason: "below-threshold",
    };
  } catch (_err) {
    return { admit: false, requests: 0, reason: "error" };
  }
}

/**
 * Records that an object was actually stored, and how big it is.
 *
 * The byte count is what makes eviction possible: deleting a blob has to
 * decrement blob_usage_tracker by the same amount that was added, or the
 * running total drifts upward forever and the breaker eventually trips on a
 * cache that is half empty.
 */
async function markStored(
  sql: any,
  cacheKey: string,
  bytes: number,
): Promise<void> {
  if (!sql) return;
  try {
    await sql.query(
      "UPDATE img_cache_entries SET bytes = $2, admitted_at = now(), last_seen = now() " +
        "WHERE cache_key = $1",
      [cacheKey, bytes],
    );
  } catch (_err) {
    // Untracked-but-stored is the one genuinely bad state here: the bytes are
    // in Blob and counted in the tracker, but eviction cannot find them to
    // free them. Rare (it needs the UPDATE to fail after the put succeeded)
    // and self-correcting on the next request for the same key, which will
    // re-run this. Worth knowing about, not worth failing the request over.
  }
}

/** Refreshes recency on a cache HIT, so a popular item does not look cold to
 *  the eviction scan just because it has been in the cache a long time. */
async function touch(sql: any, cacheKey: string): Promise<void> {
  if (!sql) return;
  try {
    await sql.query(
      "UPDATE img_cache_entries SET last_seen = now(), requests = requests + 1 " +
        "WHERE cache_key = $1",
      [cacheKey],
    );
  } catch (_err) {
    // Worst case the entry looks colder than it is and evicts early.
  }
}

export {
  DEFAULT_THRESHOLDS,
  fastPathMinRequests,
  fastPathWindowSeconds,
  markStored,
  noteRequest,
  thresholdFor,
  touch,
};
