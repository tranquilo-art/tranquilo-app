-- Run once against Tranquilo's Neon database before api/track.js is used.
-- Deliberately small: event name, a timestamp, and a JSON blob of whatever
-- props that call site passes. No indexes beyond the primary key -- this
-- table stays tiny relative to Neon's free-tier ceiling, and a one-off
-- SELECT/CSV export doesn't need one.

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  event_name TEXT NOT NULL,
  props JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
