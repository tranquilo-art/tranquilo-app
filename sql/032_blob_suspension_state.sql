-- Track whether Vercel Blob's store is currently suspended (Hobby-tier
-- Simple Operations quota hit), so the health check can alert on the
-- TRANSITION rather than paging daily about a known, unactionable state.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/016_blob_ops_stats.sql. Safe to re-run.
--
-- Temporary: the S3 migration is only paused because Simple
-- Operations are locked until the monthly reset. Once that migration
-- finishes and Blob is retired, this column (and
-- lib/img-cache-alerts.ts's checkBlobSuspended) can both go.

ALTER TABLE blob_usage_tracker
  ADD COLUMN IF NOT EXISTS simple_ops_suspended_since TIMESTAMPTZ;

-- Verify:
--   SELECT simple_ops_suspended_since FROM blob_usage_tracker WHERE id = 1;
