-- A live, per-item view of image cache state.
--
-- Run once by hand in Neon's SQL editor, same convention as every other
-- file here. Safe to re-run (CREATE OR REPLACE).
--
-- ## Why this exists
--
-- "Is this item's image cached" today means knowing to join items to
-- img_cache_entries and check object_key IS NOT NULL -- an implementation
-- detail, not something answerable at a glance. That was fine while every
-- first view was handled identically and eviction wasn't running. It stops
-- being fine the moment eviction resumes and "what's cached, and how hot is
-- it" becomes an actual decision someone has to make, not just a cache-miss
-- outcome.
--
-- ## Why a VIEW, not a column on `items`
--
-- A column would need writing on every ingest, every warming pass, and
-- every visitor-triggered cache write -- three call sites that would have
-- to agree, forever, or drift the way scripts/warm_image_cache.mts's own
-- review_status filter just did. A view reads img_cache_entries live, so
-- there is nothing to keep in sync and nothing that can go stale. It is
-- also free: a plain (non-materialized) view stores only this query
-- definition, no copy of the data.
--
-- ## Both tiers, and BLOB-only called out separately
--
-- object_key IS NULL with bytes IS NOT NULL means "cached, but in Blob" --
-- one of the ~1,221 legacy pre-S3 objects the migration is still moving off. Worth
-- distinguishing from "not cached at all": both currently read as "not
-- servable from S3/CloudFront", but only one of them needs a re-fetch to
-- fix, and knowing which is the difference between a migration script and
-- a warming pass.
CREATE OR REPLACE VIEW item_cache_status AS
SELECT
  i.source,
  i.native_id,
  i.title,
  i.review_status,
  d.object_key IS NOT NULL                       AS display_cached,
  d.object_key IS NULL AND d.bytes IS NOT NULL    AS display_blob_only,
  d.requests                                      AS display_requests,
  d.last_seen                                     AS display_last_seen,
  l.object_key IS NOT NULL                        AS lightbox_cached,
  l.object_key IS NULL AND l.bytes IS NOT NULL    AS lightbox_blob_only,
  l.requests                                      AS lightbox_requests,
  l.last_seen                                     AS lightbox_last_seen
FROM items i
LEFT JOIN img_cache_entries d
  ON d.cache_key = i.source || ':' || i.native_id || ':display'
LEFT JOIN img_cache_entries l
  ON l.cache_key = i.source || ':' || i.native_id || ':lightbox';

-- Verify:
--   -- overall warm/cold split for the live catalogue:
--   SELECT count(*) FILTER (WHERE display_cached)                    AS display_warm,
--          count(*) FILTER (WHERE display_blob_only)                 AS display_blob_only,
--          count(*) FILTER (WHERE NOT display_cached AND NOT display_blob_only) AS display_cold,
--          count(*)                                                  AS total
--     FROM item_cache_status
--    WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');
--
--   -- coldest still-uncached items, for a manual warming pass:
--   SELECT source, native_id, title FROM item_cache_status
--    WHERE NOT display_cached AND NOT display_blob_only
--    ORDER BY source, native_id LIMIT 20;
