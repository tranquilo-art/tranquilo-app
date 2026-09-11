-- Run once against Tranquilo's Neon database (Neon's own web SQL editor is
-- the easiest way -- no local psql/client needed) before running
-- python/ingest/migrate_to_postgres.py.
--
-- One flat table, not a normalized multi-table design -- this is a
-- POC-to-early-growth catalogue, not a mature relational system, and
-- over-normalizing now just adds join complexity with no real benefit
-- yet. `cast`/`cast_context`/`tea_voice_claims` are the deliberate
-- exceptions (JSONB): variable-length nested structures that don't
-- decompose cleanly into flat columns.
--
-- id is a composite `{source}:{native_id}` key, reusing core.py's own
-- existing dedupe_key() convention rather than inventing a new one --
-- this is what actually solves the cross-source id-collision risk two
-- different sources handing out the same native id would otherwise
-- create (e.g. Met object 12345 and a future Rijksmuseum object 12345
-- are not the same row). native_id is kept as its own column, as text
-- (not all sources use pure numeric ids -- Smithsonian's are already
-- alphanumeric composites like "ld1-1643399887910-1643399894916-0"),
-- since the JSON API layer (api/items.js) serializes it back out as
-- the item's `id` field -- the bare native id, byte-shape-identical to
-- today's CURIO_ITEMS, not the composite PK. The composite key is a
-- Postgres-internal uniqueness mechanism, invisible to app.js.
--
-- "cast" is double-quoted below -- it's a SQL reserved word (CAST(expr
-- AS type)), not just a stylistic choice. Any query referencing this
-- column (the migration script's INSERT, api/items.js's SELECT) needs
-- the same double-quoting or Postgres will parse it as the CAST
-- keyword and fail. Kept as `cast`, not renamed, since that's the
-- field name already in use across the Cast feature (js/app.js,
-- data.js) -- one exception to flat-column-naming convenience, not
-- worth a rename+serialization-layer mapping for.

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  native_id TEXT NOT NULL,

  title TEXT,
  artist TEXT,
  bio TEXT,
  date TEXT,
  medium TEXT,
  credit TEXT,
  tags TEXT,

  -- Captured at ingestion for Cleveland items, following the established
  -- early-capture convention for multilingual fields (same logic as
  -- license/source) -- cheap to store now, expensive to backfill later.
  -- Null for every other source; no code currently reads this, it's
  -- intentionally ahead of any real i18n work using it.
  title_in_original_language TEXT,

  img TEXT,
  full_img TEXT,
  url TEXT,

  license TEXT,

  category TEXT,
  region_primary TEXT,
  timeframe TEXT,
  media_type TEXT,
  palette TEXT,
  subject_type TEXT,

  accent_color TEXT,

  -- A tiny base64 JPEG data URI (~20px, heavily compressed), computed at
  -- ingestion from the same small image already fetched for
  -- accent_color -- see python/precompute_colors.py's
  -- blur_placeholder_data_uri() and ingest/core.py's enrich_item(). Not
  -- a Blob-cached object, just inline row data -- paints instantly with
  -- zero network round-trip while the real img/lightbox_img tier loads,
  -- so the feed never shows a blank frame. NULL is the normal state for
  -- anything ingested before this existed, until backfilled.
  blur_placeholder TEXT,

  -- Nudity tap-to-reveal gate flag: manually set, never auto-detected (no
  -- image classifier involved, and by design, shouldn't be). Gate logic
  -- (app.js's applyNudityGate()) also checks category === 'Photography'
  -- before honoring this flag, so a mis-set value on a non-photography
  -- item is a no-op, not a silent gap -- but the intent is that this is
  -- only ever set on Photography items in the first place.
  contains_nudity BOOLEAN,

  caption_tea TEXT,
  caption_basic TEXT,
  tea_voice_status TEXT,
  tea_voice_eligible BOOLEAN,
  tea_voice_claims JSONB,

  -- Set when a per-batch human review of that item's drafted caption
  -- happens (see the "Spec (living): Tea Voice Batch Workflow" doc,
  -- Stage 5) -- deliberately separate from any future
  -- locked_at field, which will track Stage 5's own formal,
  -- traffic-triggered freeze once that mechanism is built. An item can
  -- be human-reviewed without being locked, and per the current
  -- workflow every live Tea-tier caption already is. NULL is the normal
  -- state for anything not yet through a batch -- no default, same
  -- posture as tea_voice_status's own "not_started" starting point.
  human_reviewed_at TIMESTAMPTZ,

  "cast" JSONB,
  cast_context JSONB,
  cast_tier TEXT,

  storyline_ids TEXT[],

  twist_category TEXT,
  twist_hook TEXT,
  twist_story TEXT,
  twist_confidence TEXT,
  twist_source_url TEXT,

  music_mood TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Matches dedupe_key()'s own uniqueness guarantee (source + native_id
-- together, not native_id alone) at the database level too -- belt and
-- suspenders with core.py's own in-application check, not a substitute
-- for it (validate_batch() still runs first and blocks on failure).
CREATE UNIQUE INDEX IF NOT EXISTS items_source_native_id_idx ON items (source, native_id);
