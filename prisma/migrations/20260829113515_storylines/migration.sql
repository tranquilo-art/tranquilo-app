-- Run once against Tranquilo's Neon database (Neon's own web SQL editor is
-- the easiest way -- no local psql/client needed), then load 020_storylines_seed.sql
-- once against the same database. See sql/README.md.
--
-- Storylines used to be a hardcoded array in src/data/storylines.ts (bridged
-- to js/storylines.js) -- the same shape of problem js/data.js was for items
-- before the Postgres migration.
-- This table is where the content actually lives now; storylines.ts stays in
-- the repo as a point-in-time reference until the live cutover is confirmed,
-- same precedent as js/data.js.
--
-- `items` is JSONB, same exception sql/001_items_schema.sql already carves
-- out for `cast`/`cast_context`/`tea_voice_claims`: a variable-length nested
-- structure (each chapter's id/position/chapter_caption) that doesn't
-- decompose cleanly into flat columns, and nothing needs to query INSIDE it --
-- every read either wants a whole storyline or wants none of it.
--
-- No `position`/ordering column: nothing has ever iterated STORYLINES in a
-- fixed sequence (each read is keyed by id, e.g. getStoryline(id)), so there
-- is no order to preserve. Confirm this still holds before relying on it if a
-- future feature adds a "browse all storylines" list.
CREATE TABLE IF NOT EXISTS storylines (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('structural', 'narrative')),
  cover_item_id TEXT NOT NULL,
  intro_caption TEXT NOT NULL,
  -- Required when tier = 'narrative' (see src/types/Storyline.ts and
  -- scripts/check_storyline_integrity.py's check_source_notes()) -- not a
  -- CHECK constraint, because enforcing it in SQL would duplicate that
  -- script's own logic in a second place with its own failure text; the
  -- script is the one source of truth for this rule.
  source_note TEXT,
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
