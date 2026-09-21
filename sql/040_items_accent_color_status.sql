-- Distinguishes "color computation never ran or failed" from "computation
-- ran and correctly found the artwork is grayscale/monochrome" -- both
-- previously collapsed into the same NULL accent_color, so the harmonize
-- review queue (completeness.accent_color_missing) couldn't tell a real gap
-- apart from correct output. See the ingestion repo's
-- python/ingest/core.py enrich_item() and
-- python/ingest/harmonize/validators.py's accent_color_missing rule.
--
-- Only one value is ever written today ("monochrome"); left as free TEXT
-- rather than a CHECK-constrained enum since a "failed" outcome may want
-- its own value later and this column's only reader is application code
-- (the harmonize rule), not a query that depends on an exhaustive set.
--
-- Run once by hand in Neon's web SQL editor, same convention as every other
-- file here. Safe to re-run (ADD COLUMN IF NOT EXISTS).
ALTER TABLE items ADD COLUMN IF NOT EXISTS accent_color_status TEXT;

-- No index: nothing queries this column directly today -- it's read
-- alongside accent_color as part of a normal row fetch, not filtered on.

-- Verify:
--   SELECT accent_color_status, count(*)
--     FROM items
--    WHERE accent_color IS NULL
--    GROUP BY accent_color_status;
