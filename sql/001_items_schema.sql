-- Run once against Tranquilo's Neon database before running the one-time
-- catalogue ingestion migration.
--
-- One flat table rather than normalized, since this is a POC-to-early-growth
-- catalogue where over-normalizing adds join complexity with no benefit yet.
-- `cast`/`cast_context`/`tea_voice_claims` are JSONB, the deliberate
-- exceptions for nested structures that don't decompose into flat columns.
--
-- id is a composite `{source}:{native_id}` key (the ingestion pipeline's
-- dedupe_key() convention), which is what actually prevents two sources
-- handing out the same native id from colliding. native_id stays its own
-- text column since not all sources use numeric ids (Smithsonian's are
-- alphanumeric composites), and api/items.ts serializes it back out as
-- the item's bare `id` field, byte-shape-identical to the old CURIO_ITEMS.
--
-- "cast" is double-quoted below since it's a SQL reserved word; any query
-- referencing it needs the same quoting or Postgres parses it as CAST(expr
-- AS type). Kept as `cast`, not renamed, since that's the field name already
-- in use across the Cast feature.

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
  -- ingestion from the same small image already fetched for accent_color.
  -- Not a Blob-cached object, just inline row data -- paints instantly with
  -- zero network round-trip while the real img/lightbox_img tier loads,
  -- so the feed never shows a blank frame. NULL is the normal state for
  -- anything ingested before this existed, until backfilled.
  blur_placeholder TEXT,

  -- Nudity tap-to-reveal gate flag: manually set, never auto-detected (no
  -- image classifier involved, and by design, shouldn't be). Gate logic
  -- (slideBuilder.ts's applyNudityGate()) also checks category === 'Photography'
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
-- suspenders with the ingestion pipeline's own in-application check, not
-- a substitute for it (validate_batch() still runs first and blocks on
-- failure).
CREATE UNIQUE INDEX IF NOT EXISTS items_source_native_id_idx ON items (source, native_id);
