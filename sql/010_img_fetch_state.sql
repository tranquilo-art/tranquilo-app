-- Make the image proxy's origin-fetch path safe.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/009_blob_usage_tracker_schema.sql and sql/007_items_series.sql. Safe to re-run.
--
-- ## Why these are Postgres tables and not an in-process cache
--
-- The proxy is a serverless function: N concurrent invocations, no shared
-- memory, no sticky routing. Anything that has to be true ACROSS requests --
-- "is someone already fetching this?", "have we spent our budget for this
-- source?" -- needs shared storage. blob_usage_tracker set that precedent and
-- these follow it.
--
-- Note on advisory locks: `pg_advisory_lock` is the textbook answer for
-- single-flight and is UNUSABLE here. Neon's HTTP driver is stateless -- each
-- query is its own connection with no session -- and session-scoped advisory
-- locks are released the moment that connection ends. A claim ROW with an
-- expiry is the stateless equivalent, and survives a function that dies
-- mid-fetch, which a lock held by a dead session would not.

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
  -- A standing policy hold (e.g. the Wikimedia rate-limit hold on commons). When
  -- non-null the source is never fetched server-side, whatever the tokens or
  -- the cooldown say.
  --
  -- Deliberately NOT expressed as blocked_until = '2099-01-01', and not as
  -- tokens = 0 either. The first conflates a permanent policy decision with a
  -- transient rate-limit backoff -- the same overloading mistake as putting
  -- availability into review_status. The second does not even work: zero
  -- tokens with a non-zero refill is a two-second delay, not a hold, which
  -- scripts/verify_fetch_guard.mts caught the first time it ran.
  hold_reason          TEXT,
  -- 1a: outcome recording. Aggregates, never a per-request log.
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_status          INTEGER,
  last_ok_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added separately from the CREATE above: CREATE TABLE IF NOT EXISTS is a
-- no-op on an existing table, so a column added later never lands on a
-- database that already ran an earlier version of this file. Caught by
-- re-running this against Neon after adding hold_reason.
ALTER TABLE source_fetch_state ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- Defaults chosen deliberately conservative: 0.5 tokens/sec is one origin
-- fetch every two seconds per source, bursting to 30. That is roughly the
-- pace backfill_blur_placeholder.py settled on after the Wikimedia incident,
-- and the whole point is that traffic cannot push it higher.
INSERT INTO source_fetch_state (source, tokens, capacity, refill_per_sec, hold_reason)
VALUES ('met', 30, 30, 0.5, NULL), ('cleveland', 30, 30, 0.5, NULL),
       ('smithsonian', 30, 30, 0.5, NULL), ('europeana', 30, 30, 0.5, NULL),
       ('commons', 30, 30, 0.5,
        'Wikimedia rate-limit hold -- no server-side fetches until the hold is lifted')
ON CONFLICT (source) DO NOTHING;

-- Applied separately so re-running this file re-asserts the hold even if the
-- rows already exist. A hold that silently fails to apply is worse than none.
UPDATE source_fetch_state
   SET hold_reason = 'Wikimedia rate-limit hold -- no server-side fetches until the hold is lifted'
 WHERE source = 'commons' AND hold_reason IS NULL;

-- ---------------------------------------------------------------------------
-- 1b: single-flight claims
-- ---------------------------------------------------------------------------
-- Without this, 200 concurrent viewers of one uncached image produce 200
-- origin fetches. Eviction would make that routine rather than exceptional.
CREATE TABLE IF NOT EXISTS img_fetch_claims (
  cache_key  TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Every claim expires. A function that dies mid-fetch must not be able to
  -- block that key forever, and there is no cleanup process to rely on.
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS img_fetch_claims_expiry_idx
  ON img_fetch_claims (expires_at);

-- ---------------------------------------------------------------------------
-- 1a/A2: cache and origin outcome counters
-- ---------------------------------------------------------------------------
-- The fundamental cache metric, which we have never had. Aggregated on write
-- into one row per (day, source, tier) -- deliberately NOT a per-request log.
-- Counts are anonymous by construction: no session, no IP, no user, nothing
-- that could reconstruct one person's browsing.
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
