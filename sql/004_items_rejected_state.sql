-- Add a protected 'rejected' review state.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/003_items_harmonization.sql. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- Why this needs to exist
-- ---------------------------------------------------------------------------
-- Reviewing the queue produced the catalogue's first human REJECTIONS -- items
-- a reviewer judged unfit to show: a natural-history specimen that is not
-- art, a record too thin to identify, and one whose image quality was too
-- poor.
--
-- There was nowhere to record that. The existing states cannot express it:
--
--   ok / flagged   recomputed from the rules on every backfill, so any value
--                  written here is overwritten the next time the gate runs
--   quarantined    means "the gate held this", not "a person decided against
--                  it" -- and is likewise recomputed
--   reviewed       protected from recomputation, but means the opposite:
--                  "I looked, it is fine"
--
-- Writing a rejection into any of those would have it silently reverted by the
-- next `harmonize_backfill.py --commit`. The decision has to outrank the rules,
-- because it is a judgement the rules cannot make.
--
-- 'rejected' is therefore protected exactly like 'reviewed' (see
-- POSTGRES_UPSERT_OVERRIDES in core.py and the recompute guard in
-- harmonize_backfill.py): the gate may not move an item out of it, and a
-- re-ingestion cannot revive it.
--
-- Deliberately NOT a deletion. Deleting the row -- what
-- audit_shared_source_images.py does -- loses the decision itself,
-- so the same item returns on the next ingest of that source with nothing
-- recording that it was already considered and declined. Keeping the row makes
-- the rejection durable, auditable, and reversible.

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_review_status_check;

ALTER TABLE items ADD CONSTRAINT items_review_status_check
  CHECK (review_status IN ('ok', 'flagged', 'quarantined', 'reviewed', 'rejected'));

-- Rejected rows must not be served. items_live_idx already excludes only
-- 'quarantined', so it is replaced with one covering both withheld states --
-- this index backs api/items.js's ORDER BY as well as its filter.
DROP INDEX IF EXISTS items_live_idx;
CREATE INDEX IF NOT EXISTS items_live_idx
  ON items (created_at, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- The review queue is everything still awaiting a decision -- rejected items
-- have had theirs, so they drop out of it.
DROP INDEX IF EXISTS items_review_queue_idx;
CREATE INDEX IF NOT EXISTS items_review_queue_idx
  ON items (review_status)
  WHERE review_status IN ('flagged', 'quarantined');

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT review_status, count(*) FROM items GROUP BY 1 ORDER BY 2 DESC;
-- Expect no 'rejected' rows yet -- the application writes them, not this file.
