-- Capture the source's own set/portfolio name. Museums already tell us
-- when an object belongs to a published set, and we were dropping it:
-- Cleveland's record says `series: "The Apocalypse of Saint John"` in
-- plain text, which is how a 6-of-12-plates gap in Redon's Apocalypse
-- surfaced, along with two more half-ingested Redon portfolios.
--
-- Sparse on purpose -- most rows will be NULL, and that's correct.
-- Measured against Cleveland's live CC0 pool: 1,000 records of all types
-- carry `series` at 0.2%, but 1,000 type=Print records carry it at 20%
-- (64 distinct series, 26 with multiple plates present, including Dürer's
-- Life of the Virgin at 22). So this fires on prints and portfolios,
-- exactly where sets live, rather than being a field that gets populated
-- generally.
--
-- Checked live per source rather than assumed: cleveland's `series` and
-- met's `portfolio` map cleanly. smithsonian's `setName` looks right but
-- isn't -- its values are department names ("Drawings, Prints, and
-- Graphic Design Department"), one per museum division, not per set.
-- europeana's `edmDatasetName`/`europeanaCollectionName` name the
-- contributing dataset, not a published portfolio. commons wasn't
-- checked, blocked on the Wikimedia rate-limit hold. Mapping the two
-- rejected fields would have looked like a win and quietly filled the
-- column with museum org charts.
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
