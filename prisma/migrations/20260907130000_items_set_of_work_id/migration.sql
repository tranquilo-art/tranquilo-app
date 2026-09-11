-- The items-side half of "Set of works" -- badge
-- same-title/same-artist items that are genuinely distinct real objects,
-- not duplicates. The table itself is sql/034_set_of_works.sql (split out
-- so this file stays an items-column migration like every other
-- NNN_items_*.sql -- see tests/backup-restore-fidelity.test.ts, which
-- discovers items-schema migrations by that exact naming convention).
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/007_items_series.sql. Safe to re-run. See sql/README.md.
--
-- ## Why this is not `items.series`
--
-- sql/007_items_series.sql already added `items.series` -- but that column
-- captures a SOURCE's own declared portfolio/set name (Cleveland's `series`
-- field, Met's `portfolio`: Redon's "Apocalypse of Saint John" plates), read
-- verbatim from the museum's own metadata. It is not read anywhere in the
-- frontend today.
--
-- "Set of works" is a different, curator-identified fact: two items that
-- LOOK like they might be duplicates (same artist, same title) but are, on
-- review, confirmed to be different physical objects -- e.g. cleveland:97797
-- and cleveland:149563, two separately-accessioned bronze castings of
-- Rodin's "The Thinker" (different donors, dimensions, gallery locations).
-- No source declares this relationship; nothing to read
-- verbatim. Overloading `series` for it would conflate "the museum says
-- these belong together" with "we looked at these and decided they are
-- different objects that happen to share a subject" -- two claims with
-- different provenance and different confidence.
--
-- Single-membership, unlike `storyline_ids` (a TEXT[]): an item can
-- plausibly recur across multiple narrative storylines, but belongs to at
-- most one Set of works -- it is either confirmed-distinct from one other
-- object or it is not. Curator-set, same as storyline_ids -- not in
-- core.py's POSTGRES_INGEST_COLUMNS (no adapter can supply this; a human
-- decides it) and listed in python/scripts/restore_from_backup.py's
-- COLUMNS alongside storyline_ids so a backup restore doesn't silently
-- un-badge every member.
ALTER TABLE items ADD COLUMN IF NOT EXISTS set_of_work_id TEXT;

-- Partial index, same reasoning as items_series_idx (sql/007): this column
-- is NULL for nearly every row, and the only query worth running ("which
-- items carry a Set of works badge?") is scoped to the rows that have one.
CREATE INDEX IF NOT EXISTS items_set_of_work_id_idx
  ON items (set_of_work_id)
  WHERE set_of_work_id IS NOT NULL;

-- Verify:
--   SELECT id, title, set_of_work_id FROM items WHERE set_of_work_id IS NOT NULL;
