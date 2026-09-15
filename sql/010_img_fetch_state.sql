-- Make the image proxy's origin-fetch path safe. These are Postgres tables
-- rather than an in-process cache because the proxy is a serverless
-- function -- N concurrent invocations, no shared memory, no sticky
-- routing -- so anything true across requests needs shared storage.
--
-- `pg_advisory_lock` is the textbook single-flight answer and is unusable
-- here: Neon's HTTP driver is stateless (each query its own connection,
-- no session), so a session-scoped advisory lock releases the moment that
-- connection ends. A claim row with an expiry is the stateless equivalent,
-- and survives a function that dies mid-fetch, which a lock held by a dead
-- session would not.

-- ---------------------------------------------------------------------------
-- 1c/1d: per-source fetch budget and cooldown
-- ---------------------------------------------------------------------------
-- One row per source. Holds the token bucket (1c), the Retry-After cooldown
-- (1d), and the health counters (1a) that Phase 2's source_health reads.
CREATE TABLE IF NOT EXISTS source_fetch_state (
  source               TEXT PRIMARY KEY,
  -- Token bucket. Fractional, so a slow refill rate still accumulates
  -- correctly between requests instead of truncating to zero every time.
  tokens               REAL        NOT NULL DEFAULT 0,
  capacity             REAL        NOT NULL DEFAULT 30,
  refill_per_sec       REAL        NOT NULL DEFAULT 0.5,
  last_refill          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set from a 429's Retry-After. While in the future, we do not fetch this
  -- source server-side at all -- every request sheds to the visitor instead.
  -- TRANSIENT: it exists to expire.
  blocked_until        TIMESTAMPTZ,
  -- A standing policy hold (e.g. the Wikimedia hold on commons); when
  -- non-null the source is never fetched server-side, whatever the tokens
  -- or cooldown say. Not expressed as blocked_until = '2099-01-01' (conflates
  -- a permanent decision with a transient backoff) or tokens = 0 (zero
  -- tokens with a non-zero refill is a two-second delay, not a hold --
  -- scripts/verify_fetch_guard.mts caught this the first time it ran).
  hold_reason          TEXT,
  -- 1a: outcome recording. Aggregates, never a per-request log.
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_status          INTEGER,
  last_ok_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added separately since CREATE TABLE IF NOT EXISTS is a no-op on an
-- existing table -- a column added later never lands on a database that
-- already ran an earlier version of this file.
ALTER TABLE source_fetch_state ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- 0.5 tokens/sec is one origin fetch every two seconds per source,
-- bursting to 30 -- roughly the pace the blur-placeholder backfill settled
-- on after the Wikimedia incident; traffic cannot push it higher.
INSERT INTO source_fetch_state (source, tokens, capacity, refill_per_sec, hold_reason)
VALUES ('met', 30, 30, 0.5, NULL), ('cleveland', 30, 30, 0.5, NULL),
       ('smithsonian', 30, 30, 0.5, NULL), ('europeana', 30, 30, 0.5, NULL),
       ('commons', 30, 30, 0.5,
        'Wikimedia rate-limit hold -- no server-side fetches until the hold is lifted')
ON CONFLICT (source) DO NOTHING;

-- Applied separately so re-running this file re-asserts the hold even if
-- the rows already exist.
UPDATE source_fetch_state
   SET hold_reason = 'Wikimedia rate-limit hold -- no server-side fetches until the hold is lifted'
 WHERE source = 'commons' AND hold_reason IS NULL;

-- Added separately: a new source's adapter shipping is not the same event
-- as this file being re-run, so a source added after the INSERT above has
-- no row until it's added here too -- the img proxy fails closed
-- (ImgProxyDegraded) on any source with no row, shedding every request to
-- the visitor instead of fetching server-side.
INSERT INTO source_fetch_state (source, tokens, capacity, refill_per_sec, hold_reason)
VALUES ('npm', 30, 30, 0.5, NULL)
ON CONFLICT (source) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1b: single-flight claims
-- ---------------------------------------------------------------------------
-- Without this, 200 concurrent viewers of one uncached image produce 200
-- origin fetches. Eviction would make that routine rather than exceptional.
CREATE TABLE IF NOT EXISTS img_fetch_claims (
  cache_key  TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Every claim expires, so a function that dies mid-fetch can't block
  -- that key forever -- there's no cleanup process to rely on.
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS img_fetch_claims_expiry_idx
  ON img_fetch_claims (expires_at);

-- ---------------------------------------------------------------------------
-- 1a/A2: cache and origin outcome counters
-- ---------------------------------------------------------------------------
-- Aggregated on write into one row per (day, source, tier), deliberately
-- not a per-request log -- anonymous by construction, nothing that could
-- reconstruct one person's browsing.
CREATE TABLE IF NOT EXISTS img_cache_stats (
  day           DATE   NOT NULL,
  source        TEXT   NOT NULL,
  tier          TEXT   NOT NULL,
  hits          BIGINT NOT NULL DEFAULT 0,
  misses        BIGINT NOT NULL DEFAULT 0,
  origin_ok     BIGINT NOT NULL DEFAULT 0,
  origin_429    BIGINT NOT NULL DEFAULT 0,
  origin_error  BIGINT NOT NULL DEFAULT 0,
  shed          BIGINT NOT NULL DEFAULT 0,  -- redirected rather than fetched
  PRIMARY KEY (day, source, tier)
);

-- Verify:
--   SELECT * FROM source_fetch_state;
--   SELECT day, source, tier, hits, misses,
--          round(100.0 * hits / NULLIF(hits + misses, 0), 1) AS hit_pct
--     FROM img_cache_stats ORDER BY day DESC, source;
