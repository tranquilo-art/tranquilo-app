-- Single-row running total of bytes written to Vercel Blob,
-- checked atomically by api/img/[source]/[id]/[tier].js's circuit breaker before
-- every cache-populating write. Not part of the `items` catalogue schema
-- (see items_schema.sql) -- this tracks the cache as a whole, not
-- anything per-item.
--
-- Single row, enforced by the id=1 check constraint, so the circuit
-- breaker's UPDATE ... WHERE total_bytes + $1 <= $2 RETURNING total_bytes
-- is a single atomic statement with no race window between reading the
-- current total and reserving new capacity against it.
--
-- Run once against Tranquilo's Neon database (same manual-step convention as
-- every other schema addition this project has made -- no migrations
-- framework), then seed
-- the single row.

CREATE TABLE IF NOT EXISTS blob_usage_tracker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT blob_usage_tracker_single_row CHECK (id = 1)
);

INSERT INTO blob_usage_tracker (id, total_bytes) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
