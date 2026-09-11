-- Multi-region support: an item can sit in more than one of our regions.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/005_items_search.sql and sql/003_items_harmonization.sql. Safe to re-run.
--
-- ## Why
--
-- Some places genuinely span our buckets. Cyprus sits between Europe and West
-- Asia; "Asian" covers three of our regions; we have no Central Asia at all.
-- Until now classify_region() answered None for these and the
-- schema.region_unresolved rule quarantined the item -- an honest answer to
-- "which ONE region is this?", but the wrong question. A visitor browsing
-- either region should find the piece, whichever way they think about it.
--
-- ## The split, and why it is not just an array
--
-- region_primary stays exactly as it is: one canonical value, used for display
-- and for facet COUNTS. region_alt holds the equally-defensible alternates and
-- is consulted by search and filter MATCHING only.
--
-- Keeping them separate means the existing consumers do not change behaviour --
-- js/shelves.js's `region_primary: "Europe"` filter, the detail panel's Region
-- label, and every count stay single-valued. Converting to one array column
-- would have forced all of them to change and made regional counts sum to more
-- than the catalogue.
--
-- The trade, accepted deliberately: with alternates matchable, an item can
-- appear under two regions when filtering, so the filtered counts across
-- regions now exceed the catalogue size. That is normal for a browse facet (an
-- item already appears in several shelves) but it is a real change to what
-- those numbers mean.
ALTER TABLE items ADD COLUMN IF NOT EXISTS region_alt TEXT[];

-- Matching a value inside a TEXT[] needs GIN; the existing btree on
-- region_primary cannot serve `region_alt @> ARRAY['Europe']`.
CREATE INDEX IF NOT EXISTS items_region_alt_idx
  ON items USING GIN (region_alt)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Verify:
--   SELECT region_primary, region_alt, count(*) FROM items
--    WHERE region_alt IS NOT NULL AND array_length(region_alt, 1) > 0
--    GROUP BY 1, 2;
