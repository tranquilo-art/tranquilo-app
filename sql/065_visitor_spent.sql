-- visitor_fetch_state.spent and .flagged_at, for real-time alerts on heavy readers.
--
-- The visitor key rotates daily (lib/visitor-hash.ts), so each bucket row
-- covers one visitor-day. `spent` is the items served to that visitor, summed
-- over the day; it rises only when a request is allowed. `flagged_at` is set
-- once, in the statement that finds the visitor past an alert threshold, so
-- exactly one request raises the alert.
--
-- Run by hand in Neon's SQL editor BEFORE deploying the code that writes them.
-- Safe to re-run.

ALTER TABLE visitor_fetch_state
  ADD COLUMN IF NOT EXISTS spent BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ;

-- Verify:
--   SELECT ip, spent, flagged_at, first_seen, updated_at FROM visitor_fetch_state
--     WHERE ip LIKE 'items:%' ORDER BY spent DESC LIMIT 10;
