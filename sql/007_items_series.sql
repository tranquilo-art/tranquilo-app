-- Capture the source's own set/portfolio name.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/006_items_region_alt.sql and sql/003_items_harmonization.sql. Safe to re-run.
--
-- ## Why
--
-- Museums already tell us when an object belongs to a published set, and we
-- were dropping it. Finding that Redon's Apocalypse of Saint John was sitting
-- in the catalogue as 6 of 12 plates took eyeballing titles and a manual API
-- call; Cleveland's record says `series: "The Apocalypse of Saint John"` in
-- plain text. Two more half-ingested Redon portfolios turned up in the same
-- query once we thought to ask.
--
-- ## Sparse on purpose -- most rows will be NULL, and that is correct
--
-- Measured against Cleveland's live CC0 pool before building this:
--
--     1,000 records, all types   ->   2 carry `series`  (0.2%)
--     1,000 records, type=Print  -> 203 carry `series`  (20%)
--
-- So this is not a field that gets populated; it is a field that fires on
-- prints and portfolios, which is exactly where sets live. In that print
-- sample: 64 distinct series, 26 of them with multiple plates present,
-- including Dürer's Life of the Virgin (22), Vuillard's Landscapes and
-- Interiors (13) and Denis's Love (13).
--
-- ## Which sources actually have it -- checked live, not assumed
--
--   cleveland    `series`                  -> mapped
--   met          `portfolio`               -> mapped
--   smithsonian  `setName`                 -> NOT mapped. Looks right, is not:
--                                            its values are department names
--                                            ("Drawings, Prints, and Graphic
--                                            Design Department", "Cooper
--                                            Hewitt ... Collection"), one per
--                                            museum division, not per set.
--   europeana    `edmDatasetName`,         -> NOT mapped. Same problem: these
--                `europeanaCollectionName`    name the contributing dataset,
--                                            not a published portfolio.
--   commons      not checked               -> blocked on the Wikimedia
--                                            rate-limit hold; extmetadata exposes no
--                                            portfolio concept in the fields
--                                            the adapter already reads.
--
-- Mapping the two rejected ones would have looked like a win and quietly
-- filled the column with museum org charts.
ALTER TABLE items ADD COLUMN IF NOT EXISTS series TEXT;

-- Partial index: the column is NULL for ~99% of rows, and every query worth
-- running ("which sets do we hold, and which are incomplete?") is grouped by
-- series over the rows that have one.
CREATE INDEX IF NOT EXISTS items_series_idx
  ON items (series)
  WHERE series IS NOT NULL AND series <> '';

-- Verify:
--   SELECT source, series, count(*) FROM items
--    WHERE series IS NOT NULL AND series <> ''
--    GROUP BY 1, 2 ORDER BY 3 DESC;
