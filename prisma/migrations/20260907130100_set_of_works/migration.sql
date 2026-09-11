-- "Set of works" table. The items-side column
-- (`items.set_of_work_id`) is sql/033_items_set_of_work_id.sql, run first.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/019_storylines.sql. Safe to re-run. See sql/README.md.
--
-- ## Candidates come from python/ingest/find_storyline_candidates.py
--
-- find_set_of_works_clusters() surfaces same-source,
-- same-(artist, normalized title) pairs/small clusters into the same
-- candidate_clusters_<date>.json + storyline_review_log.json workflow
-- already used for storyline candidates. A human decides which candidates
-- actually become a set_of_works row -- nothing here is auto-populated.
--
-- ## Shape
--
-- Deliberately lighter than storylines (sql/019): no `tier`/`intro_caption`/
-- `source_note` -- a Set of works is a badge plus a per-member distinguishing
-- trait, not a narrative with chapters. `items` is JSONB for the same reason
-- storylines' is: a small, variable-length list ([{id, distinguishing_trait},
-- ...]) that nothing needs to query INSIDE -- every read wants the whole row
-- or none of it.
--
-- ## items[].id is the bare native_id, NOT the Postgres composite `items.id`
--
-- `items.id` in this table (the Postgres primary key) is the composite
-- "source:native_id" form ("cleveland:97797"), but the CLIENT-side Item.id
-- (what src/app.ts's itemsById is keyed by, and what resolveItemsByIds()
-- queries via `WHERE native_id = ANY(...)`) is the bare native_id alone
-- ("97797") -- see api/items.ts's `id: row.native_id`. Writing the composite
-- form into a member's `id` here means the badge chip renders (set_of_work_id
-- is a plain column, unaffected) but the position label always reads "0 of N"
-- and clicking the chip loops forever trying to resolve ids that can never
-- match. Same bare-id convention storylines' own chapter ids already use --
-- python/ingest/find_storyline_candidates.py's candidate item_ids are in the
-- OTHER (composite) form, so strip the "source:" prefix when turning a
-- reviewed candidate into a row here.
CREATE TABLE IF NOT EXISTS set_of_works (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,        -- the shared subject, e.g. "The Thinker"
  items JSONB NOT NULL,        -- [{id: <bare native_id>, distinguishing_trait}, ...]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Verify:
--   SELECT * FROM set_of_works;
