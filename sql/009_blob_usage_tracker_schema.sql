-- Single-row running total of bytes written to Vercel Blob, checked
-- atomically by api/img/[source]/[id]/[tier].js's circuit breaker before
-- every cache-populating write. Tracks the cache as a whole, not anything
-- per-item. Single row, enforced by the id=1 check constraint, so the
-- circuit breaker's UPDATE ... WHERE total_bytes + $1 <= $2 RETURNING
-- total_bytes is one atomic statement with no race window between reading
-- the current total and reserving capacity against it.

CREATE TABLE IF NOT EXISTS blob_usage_tracker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT blob_usage_tracker_single_row CHECK (id = 1)
);

INSERT INTO blob_usage_tracker (id, total_bytes) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
