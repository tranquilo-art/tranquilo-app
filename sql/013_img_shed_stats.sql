-- Why each shed happened, not just how many. Run once by hand in Neon's SQL
-- editor, same convention as sql/010_img_fetch_state.sql. Safe to re-run.
--
-- Kept as a separate table rather than a column on img_cache_stats because
-- the reason dimension applies to exactly one of that table's six counters
-- (shed) -- widening its key to include reason would fragment every hit/miss
-- row across values that mean nothing to them.
--
-- NOT a breakdown of img_cache_stats.shed: that counter is bumped at three
-- of the four shed paths, while the fourth (a failed origin fetch) counts
-- origin_429/origin_error instead -- disjoint on purpose, since shed counts
-- decisions made before trying the origin. This table is the complete shed
-- picture; the relationship to the old counter,
-- `SUM(n) WHERE reason NOT IN ('origin-429','origin-error') == shed`,
-- is asserted by tests/img-shed-reasons.test.js.
--
-- `reason` is normalised by normalizeShedReason() in lib/img-fetch-guard.js
-- against a fixed vocabulary (unrecognised -> 'other'), since the proxy's
-- raw "not-admitted-" + requests reason is unbounded and would otherwise
-- grow row count with request counts rather than distinct reasons.
--
-- Aggregate on write, never a row per request -- same discipline as
-- img_cache_stats, since a per-request log with timestamps is the one shape
-- here that starts to look like a browsing trail.

CREATE TABLE IF NOT EXISTS img_shed_stats (
  day     DATE   NOT NULL DEFAULT CURRENT_DATE,
  source  TEXT   NOT NULL,
  tier    TEXT   NOT NULL,
  reason  TEXT   NOT NULL,
  n       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, tier, reason)
);

-- Verify:
--   SELECT day, source, tier, reason, n FROM img_shed_stats
--    ORDER BY day DESC, n DESC;
--
-- The question this table exists to answer -- is anything other than admission
-- control stopping the cache from filling?
--   SELECT source, reason, SUM(n) FROM img_shed_stats
--    WHERE reason <> 'not-admitted' AND day >= CURRENT_DATE - 7
--    GROUP BY 1, 2 ORDER BY 3 DESC;
