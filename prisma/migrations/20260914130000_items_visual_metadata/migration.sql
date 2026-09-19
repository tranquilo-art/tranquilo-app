-- Deterministic, ingestion-time visual metadata. Run once
-- by hand in Neon's web SQL editor, same convention as every other file
-- here. Safe to re-run (ADD COLUMN IF NOT EXISTS).
--
-- All four are computed from the same decoded image ingestion already
-- fetches for accent_color/blur_placeholder -- no new fetch, no new
-- dependency (see python/ingest/core.py's enrich_item() in the ingestion
-- repo). Additive only: none of these replace an existing column.
--
-- palette_hex: 3-5 real extracted dominant colors, most vivid first.
-- Distinct from the existing categorical `palette` column, which is a
-- coarse hue-bucket classification (Red/Orange/Gold-Yellow/Green/Teal/
-- Blue/Purple/Pink/Neutral) used by the live palette facet today -- this
-- is the actual color data a swatch-based filter UI needs. A Postgres
-- TEXT[], same array-of-strings shape as region_alt/storyline_ids.
--
-- phash: a difference hash (dHash) for near-duplicate detection. Fixed
-- 16-hex-digit TEXT so two hashes compare with a plain Hamming distance
-- (`bit_count(('x' || a)::bit(64) # ('x' || b)::bit(64))` or equivalent
-- application-side XOR+popcount) -- no pgvector/similarity-search
-- extension needed for this.
--
-- img_width / img_height: the source image's real pixel dimensions, so
-- the feed can lay out a slide by aspect ratio before the image itself
-- has loaded, instead of a fixed box.
ALTER TABLE items ADD COLUMN IF NOT EXISTS palette_hex TEXT[];
ALTER TABLE items ADD COLUMN IF NOT EXISTS phash TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS img_width INT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS img_height INT;

-- No index yet: nothing queries these columns until Phase 2 (aspect-ratio
-- layout, palette filter UI) actually reads them. Add one once a real
-- query against production needs it, per this repo's own "EXPLAIN is the
-- acceptance criterion" standard -- not speculatively here.

-- Verify:
--   SELECT count(*) FILTER (WHERE palette_hex IS NOT NULL) AS with_palette,
--          count(*) FILTER (WHERE phash IS NOT NULL)        AS with_phash,
--          count(*) FILTER (WHERE img_width IS NOT NULL)    AS with_dimensions,
--          count(*)                                          AS total
--     FROM items;
