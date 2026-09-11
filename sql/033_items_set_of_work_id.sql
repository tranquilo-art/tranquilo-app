-- The items-side half of "Set of works" -- badge same-title/same-artist
-- items that are genuinely distinct real objects, not duplicates. The
-- table itself is sql/034_set_of_works.sql (split out so this file stays
-- an items-column migration like every other NNN_items_*.sql -- see
-- tests/backup-restore-fidelity.test.ts, which discovers items-schema
-- migrations by that exact naming convention).
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/007_items_series.sql. Safe to re-run. See sql/README.md.
--
-- Not `items.series` (sql/007): that column captures a SOURCE's own
-- declared portfolio/set name, read verbatim from the museum's own
-- metadata. "Set of works" is a different, curator-identified fact: two
-- items that LOOK like duplicates (same artist, same title) but are, on
-- review, confirmed to be different physical objects -- e.g.
-- cleveland:97797 and cleveland:149563, two separately-accessioned bronze
-- castings of Rodin's "The Thinker" (different donors, dimensions, gallery
-- locations). No source declares this relationship, so overloading
-- `series` for it would conflate "the museum says these belong together"
-- with "we decided these are different objects that happen to share a
-- subject" -- different provenance, different confidence.
--
-- Single-membership, unlike `storyline_ids` (a TEXT[]): an item can recur
-- across multiple narrative storylines but belongs to at most one Set of
-- works. Curator-set, same as storyline_ids -- not in the ingestion
-- pipeline's own set of adapter-writable columns (no adapter can supply
-- this; a human decides it) and listed alongside storyline_ids in the
-- backup restore's column list so a restore doesn't silently un-badge
-- every member.
ALTER TABLE items ADD COLUMN IF NOT EXISTS set_of_work_id TEXT;

-- Partial index, same reasoning as items_series_idx (sql/007): this column
-- is NULL for nearly every row, and the only query worth running ("which
-- items carry a Set of works badge?") is scoped to the rows that have one.
CREATE INDEX IF NOT EXISTS items_set_of_work_id_idx
  ON items (set_of_work_id)
  WHERE set_of_work_id IS NOT NULL;

-- Verify:
--   SELECT id, title, set_of_work_id FROM items WHERE set_of_work_id IS NOT NULL;
