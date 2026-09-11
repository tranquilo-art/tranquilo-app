-- A fetch budget per VISITOR IP on the two routes that do real work per
-- request: the image proxy (origin fetch + resize, billed as Vercel Fluid
-- CPU + Fast Origin Transfer) and the OG card renderer (Satori render).
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/012_host_fetch_state.sql. Safe to re-run.
--
-- Added after a real traffic wave (proxied through Facebook's in-app
-- browser, so thousands of distinct visitors) exhausted a month of
-- Vercel's free-tier Fluid Active CPU and most of its Fast Origin
-- Transfer in under a day. That event wasn't concentrated on any one IP,
-- but nothing stood between a single IP and unlimited requests either --
-- the next spike might be one client, not many.
--
-- A hand-rolled token bucket keyed on IP rather than @vercel/firewall's
-- checkRateLimit, matching this codebase's stated convention (lib/img-s3.ts,
-- lib/cron/db-backup.ts) of hand-rolling a request rather than adding an
-- SDK dependency for one call. checkRateLimit also requires a matching
-- rule configured by hand in the Vercel dashboard, invisible to the
-- codebase -- this table makes the limit itself part of the repo,
-- reviewable and testable the same way source_fetch_state and
-- host_fetch_state already are.
--
-- Deliberately generous: this exists to stop a single runaway client, not
-- to throttle real browsing. See lib/img-visitor-rate-limit.ts for the
-- defaults and the reasoning behind them.

CREATE TABLE IF NOT EXISTS visitor_fetch_state (
  ip              TEXT        PRIMARY KEY,
  tokens          REAL        NOT NULL DEFAULT 60,
  capacity        REAL        NOT NULL DEFAULT 60,
  refill_per_sec  REAL        NOT NULL DEFAULT 1,
  last_refill     TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rows accumulate one per distinct IP seen and are never seeded, same as
-- host_fetch_state. Nothing evicts them yet -- worth revisiting if the table
-- grows large, but a TEXT primary key with no other indexes is cheap, and a
-- lookup-by-key table doesn't share source_fetch_state's per-source scan
-- pattern that would need one.

-- Verify:
--   SELECT ip, round(tokens::numeric, 1) AS tokens, updated_at
--     FROM visitor_fetch_state ORDER BY updated_at DESC LIMIT 20;
