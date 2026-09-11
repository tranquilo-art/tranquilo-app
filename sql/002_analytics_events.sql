-- Run once against Tranquilo's Neon database (Neon's own web SQL editor is
-- the easiest way -- no local psql/client needed) before api/track.js is
-- used.
--
-- Deliberately small: event name, a timestamp, and a JSON blob of
-- whatever props that event's call site already passes -- see
-- trackEvent()'s six call sites in js/app.js for the full current set.
-- No indexes beyond the primary key; this table is expected to stay
-- tiny relative to Neon's free-tier ceiling for a long time, and a
-- one-off SELECT/CSV export doesn't need one.

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  props JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
