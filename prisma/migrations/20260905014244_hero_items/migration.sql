-- The hand-curated pool of first-impression hero items, shown to a
-- first-time visitor before the regular shuffled feed. See
-- src/app.ts's own header comment on hero rotation for the UI behavior.
--
-- Run once by hand in Neon's SQL editor, same convention as every other
-- file here. Safe to re-run.
--
-- References `items` by (source, native_id) rather than duplicating any of
-- its data -- title, artist, image, and especially media_type (used by
-- pickHeroes() to avoid two consecutive items of the same medium) are all
-- read live via a join in lib/hero-items.ts. A curated pool that copied
-- media_type instead would drift the moment a reclassification pass
-- changed the item's own value, silently going stale exactly the way a
-- second implementation of any one derivation always does in this
-- codebase (see CONVENTIONS.md).
--
-- No foreign key: `items` has no natural key Postgres can reference (its
-- own primary key is a generated `id`, not the (source, native_id) pair
-- adapters and this table both use), and a hero row surviving its item's
-- deletion is harmless -- lib/hero-items.ts's join against
-- LIVE_ITEMS_PREDICATE silently drops it from the served pool rather than
-- erroring, the same fail-soft posture shelves/music already have for a
-- stale item_id.
CREATE TABLE IF NOT EXISTS hero_items (
  source      TEXT NOT NULL,
  native_id   TEXT NOT NULL,
  -- The pool's own curated order (rotation-neutral -- pickHeroes() picks a
  -- random subset each session, this just needs to be stable so re-running
  -- this seed is a no-op).
  position    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, native_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hero_items_position_idx
  ON hero_items (position);

-- Verify:
--   SELECT h.source, h.native_id, i.title, i.media_type
--     FROM hero_items h JOIN items i
--       ON i.source = h.source AND i.native_id = h.native_id
--    ORDER BY h.position;
