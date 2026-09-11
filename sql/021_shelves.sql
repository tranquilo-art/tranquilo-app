-- Run once against Tranquilo's Neon database (Neon's own web SQL editor is
-- the easiest way -- no local psql/client needed), then load
-- 022_shelves_seed.sql once against the same database. See sql/README.md.
--
-- Shelves used to be a hardcoded array in src/data/shelves.ts (bridged to
-- js/shelves.js), same shape of problem js/data.js/js/storylines.js were
-- before their own Postgres migrations (sql/019_storylines.sql);
-- src/data/shelves.ts stays as a frozen reference/test fixture
-- (tests/data-schema.test.ts), no longer bridged into js/ or loaded by any
-- page.
--
-- Two shelf types, matching Shelf.ts's discriminated union: "hero" (a
-- fixed, hand-curated item_ids list) and "rule" (a generic filter object
-- matched against item[key] = value for every key present, gated by
-- min_items). Exactly one of (item_ids, filter/min_items) is meaningful
-- per row depending on type, enforced by application code rather than a
-- SQL CHECK constraint, since a column-level constraint can't express
-- "this JSONB column's keys depend on that other column's value" any more
-- cleanly than the TypeScript type already does.
--
-- item_ids is JSONB, not TEXT[]: a shelf's ids mix numeric native ids and
-- Wikimedia Commons filename strings (e.g. "File:...jpg", see the
-- "birdwatching" shelf in the seed file), and every id is read as a string
-- at the item-lookup boundary anyway (api/items.ts's native_id column is
-- TEXT), so JSONB's looser typing avoids a TEXT[] cast dance for free.
--
-- `position` orders shelves in Discover as real UI content (the
-- "Storylines" hero shelf is placed first deliberately), unlike
-- storylines which have no fixed render order -- needs preserving since
-- SQL never guarantees insertion order on SELECT without it.
CREATE TABLE IF NOT EXISTS shelves (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('hero', 'rule')),
  position INTEGER NOT NULL,
  item_ids JSONB,
  filter JSONB,
  min_items INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shelves_position_idx ON shelves (position);
