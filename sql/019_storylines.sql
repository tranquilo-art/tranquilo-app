-- Run once against Tranquilo's Neon database (Neon's own web SQL editor is
-- the easiest way -- no local psql/client needed), then load
-- 020_storylines_seed.sql once against the same database. See sql/README.md.
--
-- Storylines used to be a hardcoded array in src/data/storylines.ts (bridged
-- to js/storylines.js), the same shape of problem js/data.js was for items
-- before the Postgres migration; this table is where the content actually
-- lives now, and storylines.ts stays as a point-in-time reference until the
-- live cutover is confirmed, same precedent as js/data.js.
--
-- `items` is JSONB, same exception sql/001_items_schema.sql already carves
-- out for `cast`/`cast_context`/`tea_voice_claims`: a variable-length nested
-- structure that doesn't decompose cleanly into flat columns, and nothing
-- needs to query inside it -- every read wants a whole storyline or none.
--
-- No `position`/ordering column: nothing has ever iterated STORYLINES in a
-- fixed sequence (each read is keyed by id), so there's no order to
-- preserve -- confirm this still holds before relying on it if a future
-- feature adds a "browse all storylines" list.
CREATE TABLE IF NOT EXISTS storylines (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('structural', 'narrative')),
  cover_item_id TEXT NOT NULL,
  intro_caption TEXT NOT NULL,
  -- Required when tier = 'narrative' (see src/types/Storyline.ts) -- not a
  -- CHECK constraint, because enforcing it in SQL would duplicate the
  -- integrity checker's own logic in a second place with its own failure
  -- text; that checker is the one source of truth for this rule.
  source_note TEXT,
  items JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
