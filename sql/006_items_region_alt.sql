-- Multi-region support: an item can sit in more than one of our regions.
-- Some places genuinely span our buckets (Cyprus between Europe and West
-- Asia; "Asian" covers three regions), which used to quarantine as
-- region_unresolved -- an honest answer to "which ONE region", but the
-- wrong question.
--
-- region_primary stays one canonical value for display and facet counts;
-- region_alt holds equally-defensible alternates, consulted by search and
-- filter matching only. Keeping them separate means existing single-valued
-- consumers (js/shelves.js's `region_primary: "Europe"` filter, the detail
-- panel's Region label) don't change behaviour. The trade: with alternates
-- matchable, filtered counts across regions can now exceed the catalogue
-- size, same as any item appearing in several shelves.
ALTER TABLE items ADD COLUMN IF NOT EXISTS region_alt TEXT[];

-- Matching a value inside a TEXT[] needs GIN; a btree on region_primary
-- cannot serve `region_alt @> ARRAY['Europe']`.
CREATE INDEX IF NOT EXISTS items_region_alt_idx
  ON items USING GIN (region_alt)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Verify:
--   SELECT region_primary, region_alt, count(*) FROM items
--    WHERE region_alt IS NOT NULL AND array_length(region_alt, 1) > 0
--    GROUP BY 1, 2;
