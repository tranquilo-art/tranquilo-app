-- A fetch budget per ORIGIN HOST, alongside the per-source policy in
-- sql/010_img_fetch_state.sql. Run once by hand in Neon's SQL editor; safe
-- to re-run.
--
-- Kept as a second table rather than a `host` column on source_fetch_state
-- because the two answer different questions: source_fetch_state's
-- hold_reason is a POLICY decision a person made (the Wikimedia hold),
-- keyed on source since that's the unit the decision was about. This
-- table is BEHAVIOUR -- a token bucket and Retry-After cooldown measuring
-- how one server responds -- keyed on host, the unit the rate limit
-- belongs to. Folding them together would make the permanent hold a
-- property of a row that also expires.
--
-- Needed because Europeana aggregates 26 institutions behind one
-- `europeana` source key, so a source-level budget cut both ways: a
-- lightbox could aim the whole budget at one small institution
-- (bvpb.mcu.es, three items), and that institution's 429 would then pause
-- fetches for all 163 Europeana items across all 26 hosts -- including the
-- healthy api.europeana.eu that serves every display image.

CREATE TABLE IF NOT EXISTS host_fetch_state (
  host                 TEXT PRIMARY KEY,
  -- The source this host was last seen serving. Informational only -- a host
  -- could in principle serve two sources, and the budget belongs to the host
  -- either way. Kept so the table can be read by a human without a join.
  source               TEXT,
  -- Same fractional token bucket as the source table, and the same defaults.
  -- Per HOST these are meaningfully stricter than they look: a source with 26
  -- institutions behind it previously shared one of these between all of them.
  tokens               REAL        NOT NULL DEFAULT 6,
  capacity             REAL        NOT NULL DEFAULT 6,
  refill_per_sec       REAL        NOT NULL DEFAULT 0.2,
  last_refill          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set from a 429's Retry-After. Transient by design; it exists to expire.
  -- There is deliberately NO hold_reason here: a standing policy hold is a
  -- decision about a source, and lives in source_fetch_state.
  blocked_until        TIMESTAMPTZ,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_status          INTEGER,
  last_ok_at           TIMESTAMPTZ,
  first_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_fetch_state_source_idx
  ON host_fetch_state (source);

-- Rows are created on first sight rather than seeded. Seeding would mean
-- maintaining a list of 26 Europeana institutions by hand, and getting it
-- wrong in the direction that matters -- an unlisted host would either be
-- unlimited or unfetchable, and both are worse than a default.
--
-- The defaults above are the conservative end deliberately: 0.2 tokens/sec is
-- one origin fetch every five seconds per institution, bursting to six. A
-- museum's own CDN will never notice that; a small library's server will not
-- fall over because of it.

-- Verify:
--   SELECT host, source, round(tokens::numeric, 1) AS tokens, blocked_until,
--          consecutive_failures, last_status
--     FROM host_fetch_state ORDER BY consecutive_failures DESC, host;
