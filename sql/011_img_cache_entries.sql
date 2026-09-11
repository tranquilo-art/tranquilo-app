-- NOT THE WHOLE TABLE. sql/025_img_cache_native_id.sql adds native_id and
-- has been applied to production. Anything building this schema from files
-- -- the PGlite suites via tests/helpers/pg.ts, or a restore -- must apply
-- that file too, or lib/img-admission.ts's INSERT hits a missing column. It
-- fails SILENTLY: noteRequest() catches and returns admit:false, so the
-- symptom is "nothing is ever cached" with no error anywhere.
--
-- Admission control and eviction bookkeeping.
--
-- Run once by hand in Neon's SQL editor. Safe to re-run.
--
-- ## One table, two jobs, on purpose
--
-- Admission control needs a request count per cache key. Eviction needs to
-- know what is stored, how big it is, and when it was last wanted. Those are
-- the same rows, and splitting them would mean two writes on every miss and a
-- join to evict anything.
--
-- ## Why admission control is the biggest storage lever
--
-- A plain LRU writes EVERYTHING once, including the long tail of images seen
-- by exactly one person and never again. Those are pure cost: they occupy the
-- budget, they push something useful out, and they are the least likely thing
-- to be asked for again. Refusing to write them at all is strictly better than
-- writing them and evicting them later, because it also avoids the write.
--
-- Measured projection: on the existing 1GB, admission control roughly
-- doubles to triples what stays warm, depending on how much of the traffic
-- is one-offs. Which we do not know yet -- see the threshold comment below.
CREATE TABLE IF NOT EXISTS img_cache_entries (
  -- source:id:tier, the same key the Blob pathname is built from.
  cache_key   TEXT PRIMARY KEY,
  source      TEXT   NOT NULL,
  tier        TEXT   NOT NULL,
  -- Admission: how many times this key has been asked for.
  requests    BIGINT NOT NULL DEFAULT 1,
  -- Eviction: NULL until the object is actually stored in Blob. Set to the
  -- stored byte count so eviction can decrement blob_usage_tracker by the
  -- right amount -- without this, deleting an object would free space in Blob
  -- that the tracker never learns about, and the running total would drift
  -- upward forever until the breaker tripped on a cache that was half empty.
  bytes       BIGINT,
  admitted_at TIMESTAMPTZ,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eviction scans stored entries by coldest-first. Partial, because only rows
-- with bytes IS NOT NULL are candidates -- the un-admitted ones occupy no
-- storage and are not worth indexing.
CREATE INDEX IF NOT EXISTS img_cache_entries_lru_idx
  ON img_cache_entries (last_seen)
  WHERE bytes IS NOT NULL;

-- Verify:
--   SELECT count(*) FILTER (WHERE bytes IS NOT NULL) AS stored,
--          count(*) FILTER (WHERE bytes IS NULL)     AS seen_not_stored,
--          pg_size_pretty(coalesce(sum(bytes), 0))   AS tracked_bytes
--     FROM img_cache_entries;
--
--   -- the one-off share, which is what admission control is worth:
--   SELECT requests, count(*) FROM img_cache_entries GROUP BY 1 ORDER BY 1;
