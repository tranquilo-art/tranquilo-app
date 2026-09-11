-- Add a protected 'rejected' review state. Existing states can't express a
-- human rejection: ok/flagged and quarantined are all recomputed by the
-- next harmonization backfill run, and reviewed means the opposite ("I
-- looked, it's fine"). 'rejected' is protected exactly like 'reviewed'
-- (in the ingestion pipeline's upsert overrides) -- the gate can't move
-- an item out of it, and a re-ingestion can't revive it. Deliberately not
-- a deletion: removing the row would let the same item return on the
-- next ingest with no record it was already declined.

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_review_status_check;

ALTER TABLE items ADD CONSTRAINT items_review_status_check
  CHECK (review_status IN ('ok', 'flagged', 'quarantined', 'reviewed', 'rejected'));

-- Rejected rows must not be served; replaces the 'quarantined'-only index
-- with one covering both withheld states.
DROP INDEX IF EXISTS items_live_idx;
CREATE INDEX IF NOT EXISTS items_live_idx
  ON items (created_at, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Rejected items have had their decision, so they drop out of the queue.
DROP INDEX IF EXISTS items_review_queue_idx;
CREATE INDEX IF NOT EXISTS items_review_queue_idx
  ON items (review_status)
  WHERE review_status IN ('flagged', 'quarantined');

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT review_status, count(*) FROM items GROUP BY 1 ORDER BY 2 DESC;
-- Expect no 'rejected' rows yet -- the application writes them, not this file.
