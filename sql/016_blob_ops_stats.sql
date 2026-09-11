-- Count Blob operations directly. Run once by hand in Neon's SQL editor,
-- same convention as sql/013_img_shed_stats.sql. Safe to re-run.
--
-- Added after Vercel reported 7.6K of 10K Simple Operations with ten days
-- left in the month, learned from an email rather than any internal
-- signal: operations were being INFERRED from img_cache_stats hits/misses,
-- which undercounts by construction (a cache hit returns a 302 with
-- `immutable`, so repeat views never re-enter the function to be counted,
-- and eviction's del() calls were never counted anywhere). Storage had a
-- tracker and circuit breaker; the meter that actually stops the site had
-- neither.
--
-- Keyed (day, op) rather than (day, op, source, tier): the quota is one
-- monthly number account-wide, so source/tier would only multiply rows for
-- a table whose sole job is "how close are we to 10,000 this month". Three
-- ops caps this at ~93 rows/month. Aggregate on write, never a row per
-- request -- same discipline as img_cache_stats and img_shed_stats.

CREATE TABLE IF NOT EXISTS blob_ops_stats (
  day DATE   NOT NULL DEFAULT CURRENT_DATE,
  op  TEXT   NOT NULL,          -- put | head | del
  n   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, op)
);

-- Verify:
--   SELECT day, op, n FROM blob_ops_stats ORDER BY day DESC, op;
--
-- The question this table exists to answer -- how close are we to the quota?
--   SELECT COALESCE(SUM(n), 0) AS month_to_date
--     FROM blob_ops_stats
--    WHERE day >= date_trunc('month', CURRENT_DATE);
