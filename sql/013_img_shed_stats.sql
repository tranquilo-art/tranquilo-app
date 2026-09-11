-- Why each shed happened, not just how many.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/010_img_fetch_state.sql. Safe to re-run.
--
-- ## Why a separate table rather than a column on img_cache_stats
--
-- The decision is semantic, not about size. img_cache_stats carries six
-- counters and the reason dimension applies to exactly ONE of them:
--
--   hits, misses, origin_ok, origin_429, origin_error   have no reason
--   shed                                                does
--
-- Widening that table's key to (day, source, tier, reason) would force a
-- reason onto all six, fragmenting every hit and miss row across values that
-- mean nothing to them, and muddying every existing SUM(hits) query.
--
-- Row count argues neither way and deliberately did not drive the choice.
-- Production is ~6 rows/day against a ceiling of 10 (5 sources x 2 tiers).
-- This table tops out at 5 x 2 x ~14 reasons = 140 rows/day, realistically far
-- fewer since most reasons never fire.
--
-- ## What this is NOT: a breakdown of img_cache_stats.shed
--
-- Easy to assume, and wrong. `shed` is bumped at three of the four shed paths.
-- The fourth -- an origin fetch that failed -- counts origin_429/origin_error
-- instead. Those are disjoint on purpose: `shed` counts sheds decided BEFORE
-- we tried the origin, the origin_* counters count sheds after a failed
-- attempt. Both end in a shed to the visitor.
--
-- So this table is the COMPLETE shed picture, and the relationship to the old
-- counter is:
--
--   SUM(n) WHERE reason NOT IN ('origin-429','origin-error')  ==  shed
--
-- which is asserted by tests/img-shed-reasons.test.js rather than left to be
-- rediscovered.
--
-- ## Bounded key, by construction
--
-- `reason` is normalised by normalizeShedReason() in lib/img-fetch-guard.js
-- against a fixed vocabulary, and anything unrecognised becomes 'other'. That
-- matters because the proxy emits "not-admitted-" + requests, which is
-- unbounded -- as a raw key it would grow row count with REQUEST COUNTS rather
-- than with distinct reasons.
--
-- Aggregate on write, never a row per request. Same discipline as
-- img_cache_stats and for the same reason: a retained per-request log with
-- timestamps is the one shape here that starts to look like a browsing trail.

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
