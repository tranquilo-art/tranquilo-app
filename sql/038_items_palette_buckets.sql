-- A real color filter. palette_buckets holds every distinct hue
-- bucket among an item's *several* extracted colors (palette_hex), derived
-- by the ingestion pipeline's classify_palette_buckets() reusing the same
-- hue-bucket vocabulary/thresholds as the existing single-valued `palette`
-- column (Red/Orange/Gold-Yellow/Green/Teal/Blue/Purple/Pink/Neutral) --
-- see that function's own docstring for why "Neutral" is suppressed
-- whenever a real color is also present, and kept only when every
-- extracted color is that desaturated (including a genuinely monochrome
-- item, whose palette_hex is empty).
--
-- Run once by hand in Neon's web SQL editor, same convention as every
-- other file here. Safe to re-run (ADD COLUMN IF NOT EXISTS).
ALTER TABLE items ADD COLUMN IF NOT EXISTS palette_buckets TEXT[];

-- Matching a value inside a TEXT[] needs GIN -- same reasoning and same
-- partial condition as items_region_alt_idx (sql/006_items_region_alt.sql).
CREATE INDEX IF NOT EXISTS items_palette_buckets_idx
  ON items USING GIN (palette_buckets)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Verify:
--   SELECT unnest(palette_buckets) AS bucket, count(*) FROM items
--    WHERE palette_buckets IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
