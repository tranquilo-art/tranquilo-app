-- NOT THE WHOLE TABLE: sql/025_img_cache_native_id.sql adds native_id and is
-- applied in production. Building this schema from files (PGlite suites via
-- tests/helpers/pg.ts, or a restore) must apply that file too, or
-- lib/img-admission.ts's INSERT hits a missing column and fails silently
-- (noteRequest() catches it and returns admit:false -- symptom: nothing
-- ever caches, no error anywhere). Run once by hand in Neon's SQL editor;
-- safe to re-run.
--
-- One table serves both admission control (a request count per key) and
-- eviction (what's stored, how big, last wanted) since they're the same
-- rows -- splitting them would mean two writes per miss and a join to evict.
-- Admission control is the biggest storage lever: refusing to ever write
-- one-off images (seen once, never again) beats writing then evicting them,
-- since it also avoids the write. Measured projection: roughly doubles to
-- triples what stays warm on the existing 1GB, depending on the one-off share.
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
