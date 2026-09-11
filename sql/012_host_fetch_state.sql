-- A fetch budget per ORIGIN HOST, alongside the per-source policy.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/010_img_fetch_state.sql. Safe to re-run.
--
-- ## Why a second table rather than a `host` column on source_fetch_state
--
-- Because the two tables answer different questions, and only one of them is
-- ours to decide.
--
--   source_fetch_state   POLICY. `hold_reason` is a decision a person made --
--                        the Wikimedia rate-limit hold. It is keyed on source because
--                        that is the unit the decision was about: every
--                        Commons host, forever, until they reply. Four blocked
--                        tickets depend on it and it must not become per-host.
--
--   host_fetch_state     BEHAVIOUR. A token bucket and a Retry-After cooldown
--                        are measurements of how one server is responding.
--                        They are keyed on host because that is the unit the
--                        rate limit belongs to -- the server enforcing it.
--
-- Folding them into one table would have made the hold a property of a row
-- that also expires, which is the same overloading mistake the hold_reason
-- comment in img_fetch_state.sql already refuses. The cost is two tables to
-- reason about; the benefit is that the permanent thing cannot be affected by
-- a change to the transient one.
--
-- ## What went wrong without it
--
-- Every other source serves images from exactly one host. Europeana AGGREGATES
-- -- 26 institutions behind one `europeana` key -- so the budget cut both ways:
--
--   under-protection  the whole source budget could be aimed at whichever
--                     institution a lightbox happened to want. bvpb.mcu.es is
--                     a Spanish national heritage library with three items in
--                     the catalogue.
--   over-blocking     that library's 429 paused fetches for all 163 Europeana
--                     items across all 26 hosts, including api.europeana.eu,
--                     which was healthy and serves every display image.

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
