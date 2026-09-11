-- Baseline migration: consolidates every schema change already applied by
-- hand against Neon before Prisma Migrate existed in this project. This is
-- sql/001..018_*.sql concatenated verbatim, in the exact order established
-- by this project's own reconstruction of history (see sql/README.md for
-- the confidence level behind each file's position).
--
-- DO NOT run this migration for real against the existing Neon database --
-- every statement in it has already been applied there by hand. It must be
-- marked as already-applied instead:
--
--   prisma migrate resolve --applied 20260819000000_baseline
--
-- (requires a real DATABASE_URL; nobody has run this yet). Only a FRESH,
-- empty database (a new dev/staging Neon branch, for instance) should ever
-- actually execute this SQL for real, via `prisma migrate deploy`.

-- =============================================================================
-- sql/001_items_schema.sql
-- =============================================================================
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

-- =============================================================================
-- sql/002_analytics_events.sql
-- =============================================================================
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

-- =============================================================================
-- sql/003_items_harmonization.sql
-- =============================================================================
-- Harmonization / validation columns on `items`.
--
-- Run once by hand in Neon's web SQL editor, same manual-step convention as
-- every other schema addition in this project (no migrations framework -- see
-- sql/001_items_schema.sql).
--
-- Safe to run BEFORE any application code ships, and safe to re-run: every
-- statement is IF NOT EXISTS. See the note on review_status's default below --
-- that ordering property is deliberate, not incidental.

-- ---------------------------------------------------------------------------
-- Review state
-- ---------------------------------------------------------------------------

-- NOT NULL DEFAULT 'ok' is load-bearing, not cosmetic. The API's live-items
-- filter is `WHERE review_status <> 'quarantined'`; against a NULLable column
-- that predicate evaluates to NULL (not TRUE) for every pre-existing row, and
-- the ENTIRE CATALOGUE would vanish from /api/items. The default means the API
-- change can deploy before the backfill has run, decoupling the two.
--
-- On Postgres 11+ this is a metadata-only change -- no table rewrite, so it
-- stays instant at any catalogue size.
--
--   ok           nothing flagged
--   flagged      stays live, but is in the review queue
--   quarantined  persisted but NOT served -- held back, not deleted
--   reviewed     terminal, human-set: "I looked, it's fine, stop showing me"
ALTER TABLE items ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'ok';

-- The findings/changes payload: {v, rules_version, checked_at, verdict,
-- verdict_shadow, findings[], changes[]}. An object rather than a bare array so
-- it stays self-describing. `changes` is the audit trail for auto-applied
-- normalizations -- the entire justification for applying any of them
-- unattended. INFO-severity findings are deliberately never written here
-- (553 items share one palette bucket; per-row that is pure bloat).
ALTER TABLE items ADD COLUMN IF NOT EXISTS review_flags JSONB;

-- Which rule version last checked this row. The recheck predicate is one line:
-- re-flag only if RULES_VERSION > items.rules_version, or the verdict differs.
-- That is what lets a 'reviewed' item stay reviewed across re-ingests without
-- silently going stale when a rule actually does change.
ALTER TABLE items ADD COLUMN IF NOT EXISTS rules_version INTEGER;

ALTER TABLE items ADD COLUMN IF NOT EXISTS harmonized_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- source_type -- the source's own raw type/classification string, verbatim
-- ---------------------------------------------------------------------------
-- e.g. met.classification, cleveland.type, europeana's dcType,
-- aic.classification_titles. Every adapter already computes this string for
-- _category_hint or tags, so populating it is cheap.
--
-- Persisted (rather than left as a transient like _category_hint) for one
-- concrete reason: it makes category-vs-source-type re-checks, and every
-- future recompute-and-diff of that shape, a SQL scan instead of a network
-- crawl. scripts/backfill_cur88_europeana_photography_category.py re-fetches
-- every row at ~0.5s each; at 200k items that shape of script is ~28 hours.
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_type TEXT;

-- ---------------------------------------------------------------------------
-- Attribution split
-- ---------------------------------------------------------------------------
-- `bio` currently conflates two different things: a person's nationality +
-- lifespan ("French, 1819-1889") and a culture/dynasty attribution ("China,
-- Tang dynasty (618-907)"). A dynasty is not a lifespan, and rendering both
-- through an "Artist lifespan" label misrepresents the second.
--
-- Included in this same migration on purpose: each manual Neon step is a real
-- cost and a real chance for the live schema and the checked-in file to drift.
--
-- attribution_type: 'person' | 'culture'
ALTER TABLE items ADD COLUMN IF NOT EXISTS attribution_type TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS artist_nationality TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS artist_lifespan TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS culture TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS culture_period TEXT;

-- ---------------------------------------------------------------------------
-- Constraint + indexes
-- ---------------------------------------------------------------------------

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so this is guarded to stay
-- re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'items_review_status_check'
  ) THEN
    ALTER TABLE items ADD CONSTRAINT items_review_status_check
      CHECK (review_status IN ('ok', 'flagged', 'quarantined', 'reviewed'));
  END IF;
END $$;

-- Serves api/items.js's ORDER BY and the quarantine filter in one index.
-- Partial, because the overwhelming majority of rows are 'ok' and the index
-- only needs to support the served set.
CREATE INDEX IF NOT EXISTS items_live_idx
  ON items (created_at, native_id)
  WHERE review_status <> 'quarantined';

-- Supports the review-queue query: everything needing human attention.
CREATE INDEX IF NOT EXISTS items_review_queue_idx
  ON items (review_status)
  WHERE review_status IN ('flagged', 'quarantined');

-- ---------------------------------------------------------------------------
-- Verify (optional -- expect 950 rows all 'ok', every new column NULL)
-- ---------------------------------------------------------------------------
-- SELECT review_status, count(*) FROM items GROUP BY 1;
-- SELECT count(*) AS not_yet_harmonized FROM items WHERE rules_version IS NULL;

-- =============================================================================
-- sql/004_items_rejected_state.sql
-- =============================================================================
-- Add a protected 'rejected' review state.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/003_items_harmonization.sql. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- Why this needs to exist
-- ---------------------------------------------------------------------------
-- Reviewing the queue produced the catalogue's first human REJECTIONS -- items
-- a reviewer judged unfit to show: a natural-history specimen that is not
-- art, a record too thin to identify, and one whose image quality was too
-- poor.
--
-- There was nowhere to record that. The existing states cannot express it:
--
--   ok / flagged   recomputed from the rules on every backfill, so any value
--                  written here is overwritten the next time the gate runs
--   quarantined    means "the gate held this", not "a person decided against
--                  it" -- and is likewise recomputed
--   reviewed       protected from recomputation, but means the opposite:
--                  "I looked, it is fine"
--
-- Writing a rejection into any of those would have it silently reverted by the
-- next `harmonize_backfill.py --commit`. The decision has to outrank the rules,
-- because it is a judgement the rules cannot make.
--
-- 'rejected' is therefore protected exactly like 'reviewed' (see
-- POSTGRES_UPSERT_OVERRIDES in core.py and the recompute guard in
-- harmonize_backfill.py): the gate may not move an item out of it, and a
-- re-ingestion cannot revive it.
--
-- Deliberately NOT a deletion. Deleting the row -- what
-- audit_shared_source_images.py does -- loses the decision itself,
-- so the same item returns on the next ingest of that source with nothing
-- recording that it was already considered and declined. Keeping the row makes
-- the rejection durable, auditable, and reversible.

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_review_status_check;

ALTER TABLE items ADD CONSTRAINT items_review_status_check
  CHECK (review_status IN ('ok', 'flagged', 'quarantined', 'reviewed', 'rejected'));

-- Rejected rows must not be served. items_live_idx already excludes only
-- 'quarantined', so it is replaced with one covering both withheld states --
-- this index backs api/items.js's ORDER BY as well as its filter.
DROP INDEX IF EXISTS items_live_idx;
CREATE INDEX IF NOT EXISTS items_live_idx
  ON items (created_at, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- The review queue is everything still awaiting a decision -- rejected items
-- have had theirs, so they drop out of it.
DROP INDEX IF EXISTS items_review_queue_idx;
CREATE INDEX IF NOT EXISTS items_review_queue_idx
  ON items (review_status)
  WHERE review_status IN ('flagged', 'quarantined');

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT review_status, count(*) FROM items GROUP BY 1 ORDER BY 2 DESC;
-- Expect no 'rejected' rows yet -- the application writes them, not this file.

-- =============================================================================
-- sql/005_items_search.sql
-- =============================================================================
-- What server-side search needs.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/003_items_harmonization.sql and sql/004_items_rejected_state.sql. Safe to re-run.
--
-- Nothing here changes what the site does. It adds the columns, extensions and
-- indexes the query endpoint will use; the endpoint ships behind a flag after
-- this runs, with the current unpaginated path untouched.
--
-- ===========================================================================
-- 1. Extensions
-- ===========================================================================
-- Both are available on Neon but not yet installed (checked). unaccent gives
-- diacritic folding; pg_trgm makes substring matching indexable.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ===========================================================================
-- 2. An IMMUTABLE unaccent wrapper
-- ===========================================================================
-- unaccent() is STABLE, not IMMUTABLE, because it depends on a dictionary that
-- could in principle be changed. Postgres therefore refuses to use it in an
-- index or a generated column -- which is exactly where we need it.
--
-- The standard workaround is a wrapper that names the dictionary explicitly,
-- making the result genuinely deterministic for a fixed dictionary. The
-- schema-qualified 'public.unaccent' argument is not decoration: without it the
-- function resolves through search_path at call time, which is the thing that
-- makes the original non-immutable.
--
-- If the dictionary is ever changed, indexes built on this must be REINDEXed.
-- That is the trade being made, and it is the same one every Postgres project
-- doing accent-insensitive search makes.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;


-- ===========================================================================
-- 3. century -- the field the client computes today and Postgres cannot
-- ===========================================================================
-- js/app.js computes item._century in JavaScript for every item on load, and
-- search uses it for era queries ("17th century", "ancient"). A server-side
-- query cannot call JavaScript, so the value has to be stored.
--
-- Deliberately NOT a generated column. The derivation is
-- core.compute_century() -- BCE bail-outs, "Nth century" phrases, a plausible-
-- range clamp, and an ASCII-word-boundary year match that had to be written
-- character-class-by-character to agree with JavaScript's \b (see that
-- function's own comments). That is not expressible in SQL without
-- reimplementing it a third time, and a third implementation is exactly how
-- the Python/JS divergence happened in the first place. One derivation, in
-- Python, written to this column by scripts/backfill_century.py and by
-- classify_item() at ingestion.
ALTER TABLE items ADD COLUMN IF NOT EXISTS century INTEGER;


-- ===========================================================================
-- 4. search_text -- one normalized blob matching matchesQuery()'s fields
-- ===========================================================================
-- js/logic.js's matchesQuery() does a case-insensitive, diacritic-folded
-- SUBSTRING test against eleven fields, returning true if ANY matches. Not a
-- word match and not a prefix match: "art" legitimately matches "Bharat".
--
-- Concatenating those eleven fields into one normalized column reproduces that
-- exactly -- a substring present in any field is a substring of the blob --
-- and makes it one indexable expression instead of eleven ORs.
--
-- The field list mirrors matchesQuery() line for line. If a field is added
-- there, add it here; tests/fixtures/feed-modes.json is what will catch the
-- omission, since 18 real search terms are pinned against live results.
--
-- STORED rather than a plain index expression so the endpoint can read it back
-- for debugging, and so a mismatch is visible in a row rather than only inside
-- a query plan.
ALTER TABLE items ADD COLUMN IF NOT EXISTS search_text TEXT
  GENERATED ALWAYS AS (
    immutable_unaccent(lower(
      coalesce(title, '') || ' ' ||
      coalesce(artist, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(medium, '') || ' ' ||
      coalesce(tags, '') || ' ' ||
      coalesce(region_primary, '') || ' ' ||
      coalesce(timeframe, '') || ' ' ||
      coalesce(media_type, '') || ' ' ||
      coalesce(palette, '') || ' ' ||
      coalesce(date, '') || ' ' ||
      coalesce(bio, '')
    ))
  ) STORED;


-- ===========================================================================
-- 5. Indexes
-- ===========================================================================
-- GIN + trigram is what makes LIKE '%needle%' fast. A btree cannot help an
-- unanchored substring match, and unanchored is what matchesQuery() does.
CREATE INDEX IF NOT EXISTS items_search_text_trgm_idx
  ON items USING GIN (search_text gin_trgm_ops);

-- Facet filters, all equality, all covered by the live-items predicate the
-- three API handlers already share (lib/items-sql.js).
CREATE INDEX IF NOT EXISTS items_facets_idx
  ON items (category, timeframe, palette, media_type, region_primary)
  WHERE review_status NOT IN ('quarantined', 'rejected');

CREATE INDEX IF NOT EXISTS items_artist_idx
  ON items (artist)
  WHERE review_status NOT IN ('quarantined', 'rejected');

CREATE INDEX IF NOT EXISTS items_century_idx
  ON items (century)
  WHERE review_status NOT IN ('quarantined', 'rejected');


-- ===========================================================================
-- Verify (optional)
-- ===========================================================================
-- Diacritic folding works:
--   SELECT immutable_unaccent(lower('Cézanne'));            -- expect: cezanne
--
-- The blob is populated and folded:
--   SELECT title, left(search_text, 60) FROM items LIMIT 3;
--
-- A real query, the shape the endpoint will run:
--   SELECT count(*) FROM items
--    WHERE search_text LIKE '%' || immutable_unaccent(lower('cezanne')) || '%'
--      AND review_status NOT IN ('quarantined', 'rejected');
--
-- century is NULL until the backfill runs -- that is expected:
--   SELECT count(*) FILTER (WHERE century IS NULL), count(*) FROM items;
--
-- Then, from the repo:
--   python scripts/backfill_century.py            # dry run
--   python scripts/backfill_century.py --commit
--   node scripts/verify_feed_fixtures.mts         # must stay clean

-- =============================================================================
-- sql/006_items_region_alt.sql
-- =============================================================================
-- Multi-region support: an item can sit in more than one of our regions.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/005_items_search.sql and sql/003_items_harmonization.sql. Safe to re-run.
--
-- ## Why
--
-- Some places genuinely span our buckets. Cyprus sits between Europe and West
-- Asia; "Asian" covers three of our regions; we have no Central Asia at all.
-- Until now classify_region() answered None for these and the
-- schema.region_unresolved rule quarantined the item -- an honest answer to
-- "which ONE region is this?", but the wrong question. A visitor browsing
-- either region should find the piece, whichever way they think about it.
--
-- ## The split, and why it is not just an array
--
-- region_primary stays exactly as it is: one canonical value, used for display
-- and for facet COUNTS. region_alt holds the equally-defensible alternates and
-- is consulted by search and filter MATCHING only.
--
-- Keeping them separate means the existing consumers do not change behaviour --
-- js/shelves.js's `region_primary: "Europe"` filter, the detail panel's Region
-- label, and every count stay single-valued. Converting to one array column
-- would have forced all of them to change and made regional counts sum to more
-- than the catalogue.
--
-- The trade, accepted deliberately: with alternates matchable, an item can
-- appear under two regions when filtering, so the filtered counts across
-- regions now exceed the catalogue size. That is normal for a browse facet (an
-- item already appears in several shelves) but it is a real change to what
-- those numbers mean.
ALTER TABLE items ADD COLUMN IF NOT EXISTS region_alt TEXT[];

-- Matching a value inside a TEXT[] needs GIN; the existing btree on
-- region_primary cannot serve `region_alt @> ARRAY['Europe']`.
CREATE INDEX IF NOT EXISTS items_region_alt_idx
  ON items USING GIN (region_alt)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Verify:
--   SELECT region_primary, region_alt, count(*) FROM items
--    WHERE region_alt IS NOT NULL AND array_length(region_alt, 1) > 0
--    GROUP BY 1, 2;

-- =============================================================================
-- sql/007_items_series.sql
-- =============================================================================
-- Capture the source's own set/portfolio name.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/006_items_region_alt.sql and sql/003_items_harmonization.sql. Safe to re-run.
--
-- ## Why
--
-- Museums already tell us when an object belongs to a published set, and we
-- were dropping it. Finding that Redon's Apocalypse of Saint John was sitting
-- in the catalogue as 6 of 12 plates took eyeballing titles and a manual API
-- call; Cleveland's record says `series: "The Apocalypse of Saint John"` in
-- plain text. Two more half-ingested Redon portfolios turned up in the same
-- query once we thought to ask.
--
-- ## Sparse on purpose -- most rows will be NULL, and that is correct
--
-- Measured against Cleveland's live CC0 pool before building this:
--
--     1,000 records, all types   ->   2 carry `series`  (0.2%)
--     1,000 records, type=Print  -> 203 carry `series`  (20%)
--
-- So this is not a field that gets populated; it is a field that fires on
-- prints and portfolios, which is exactly where sets live. In that print
-- sample: 64 distinct series, 26 of them with multiple plates present,
-- including Dürer's Life of the Virgin (22), Vuillard's Landscapes and
-- Interiors (13) and Denis's Love (13).
--
-- ## Which sources actually have it -- checked live, not assumed
--
--   cleveland    `series`                  -> mapped
--   met          `portfolio`               -> mapped
--   smithsonian  `setName`                 -> NOT mapped. Looks right, is not:
--                                            its values are department names
--                                            ("Drawings, Prints, and Graphic
--                                            Design Department", "Cooper
--                                            Hewitt ... Collection"), one per
--                                            museum division, not per set.
--   europeana    `edmDatasetName`,         -> NOT mapped. Same problem: these
--                `europeanaCollectionName`    name the contributing dataset,
--                                            not a published portfolio.
--   commons      not checked               -> blocked on the Wikimedia NOC
--                                            hold; extmetadata exposes no
--                                            portfolio concept in the fields
--                                            the adapter already reads.
--
-- Mapping the two rejected ones would have looked like a win and quietly
-- filled the column with museum org charts.
ALTER TABLE items ADD COLUMN IF NOT EXISTS series TEXT;

-- Partial index: the column is NULL for ~99% of rows, and every query worth
-- running ("which sets do we hold, and which are incomplete?") is grouped by
-- series over the rows that have one.
CREATE INDEX IF NOT EXISTS items_series_idx
  ON items (series)
  WHERE series IS NOT NULL AND series <> '';

-- Verify:
--   SELECT source, series, count(*) FROM items
--    WHERE series IS NOT NULL AND series <> ''
--    GROUP BY 1, 2 ORDER BY 3 DESC;

-- =============================================================================
-- sql/008_items_place_of_origin.sql
-- =============================================================================
-- The object's own place, kept as its own fact.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/003_items_harmonization.sql. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- Why a separate column rather than reusing `bio`
-- ---------------------------------------------------------------------------
-- `bio` already means different things per source: the artist's nationality
-- and dates for Met/Cleveland/Smithsonian, a place for Europeana/Commons.
-- classify_region() reads it for every source, so `region_primary` is built
-- from two different facts wearing one name, with nothing recording which.
--
-- Writing a third meaning into `bio` would deepen exactly that. The product
-- rule: "I don't want to have consistent labels everywhere, I want to show
-- what we know to be true when we know it." A row cannot say what it knows
-- unless the field says which fact it holds.
--
-- So: `place_of_origin` is where the OBJECT came from, set only where a source
-- genuinely records it, and never inferred from an artist's nationality --
-- which is a different claim about a different subject. A French designer's
-- work made in England originates in England.
--
-- Populated today by smithsonian.py from indexedStructured.place /
-- geoLocation. Cooper Hewitt is largely anonymous design objects, so artist
-- nationality resolved a region for 1 record in 6 while place resolved 6 in 6;
-- before this, 68% of a pull quarantined on schema.region_unresolved and the
-- run-level guard aborted it.

ALTER TABLE items ADD COLUMN IF NOT EXISTS place_of_origin TEXT;

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT source, count(*) FILTER (WHERE place_of_origin IS NOT NULL) AS with_place,
--        count(*) AS total
-- FROM items GROUP BY 1 ORDER BY 2 DESC;

-- =============================================================================
-- sql/009_blob_usage_tracker_schema.sql
-- =============================================================================
-- Single-row running total of bytes written to Vercel Blob,
-- checked atomically by api/img/[source]/[id]/[tier].js's circuit breaker before
-- every cache-populating write. Not part of the `items` catalogue schema
-- (see items_schema.sql) -- this tracks the cache as a whole, not
-- anything per-item.
--
-- Single row, enforced by the id=1 check constraint, so the circuit
-- breaker's UPDATE ... WHERE total_bytes + $1 <= $2 RETURNING total_bytes
-- is a single atomic statement with no race window between reading the
-- current total and reserving new capacity against it.
--
-- Run once against Tranquilo's Neon database (same manual-step convention as
-- every other schema addition this project has made -- no migrations
-- framework), then seed
-- the single row.

CREATE TABLE IF NOT EXISTS blob_usage_tracker (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_bytes BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT blob_usage_tracker_single_row CHECK (id = 1)
);

INSERT INTO blob_usage_tracker (id, total_bytes) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- sql/010_img_fetch_state.sql
-- =============================================================================
-- Make the image proxy's origin-fetch path safe.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/009_blob_usage_tracker_schema.sql and sql/007_items_series.sql. Safe to re-run.
--
-- ## Why these are Postgres tables and not an in-process cache
--
-- The proxy is a serverless function: N concurrent invocations, no shared
-- memory, no sticky routing. Anything that has to be true ACROSS requests --
-- "is someone already fetching this?", "have we spent our budget for this
-- source?" -- needs shared storage. blob_usage_tracker set that precedent and
-- these follow it.
--
-- Note on advisory locks: `pg_advisory_lock` is the textbook answer for
-- single-flight and is UNUSABLE here. Neon's HTTP driver is stateless -- each
-- query is its own connection with no session -- and session-scoped advisory
-- locks are released the moment that connection ends. A claim ROW with an
-- expiry is the stateless equivalent, and survives a function that dies
-- mid-fetch, which a lock held by a dead session would not.

-- ---------------------------------------------------------------------------
-- 1c/1d: per-source fetch budget and cooldown
-- ---------------------------------------------------------------------------
-- One row per source. Holds the token bucket (1c), the Retry-After cooldown
-- (1d), and the health counters (1a) that Phase 2's source_health reads.
CREATE TABLE IF NOT EXISTS source_fetch_state (
  source               TEXT PRIMARY KEY,
  -- Token bucket. Fractional, so a slow refill rate still accumulates
  -- correctly between requests instead of truncating to zero every time.
  tokens               REAL        NOT NULL DEFAULT 0,
  capacity             REAL        NOT NULL DEFAULT 30,
  refill_per_sec       REAL        NOT NULL DEFAULT 0.5,
  last_refill          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set from a 429's Retry-After. While in the future, we do not fetch this
  -- source server-side at all -- every request sheds to the visitor instead.
  -- TRANSIENT: it exists to expire.
  blocked_until        TIMESTAMPTZ,
  -- A standing policy hold (e.g. the Wikimedia NOC hold on commons). When
  -- non-null the source is never fetched server-side, whatever the tokens or
  -- the cooldown say.
  --
  -- Deliberately NOT expressed as blocked_until = '2099-01-01', and not as
  -- tokens = 0 either. The first conflates a permanent policy decision with a
  -- transient rate-limit backoff -- the same overloading mistake as putting
  -- availability into review_status. The second does not even work: zero
  -- tokens with a non-zero refill is a two-second delay, not a hold, which
  -- scripts/verify_fetch_guard.mts caught the first time it ran.
  hold_reason          TEXT,
  -- 1a: outcome recording. Aggregates, never a per-request log.
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  last_status          INTEGER,
  last_ok_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added separately from the CREATE above: CREATE TABLE IF NOT EXISTS is a
-- no-op on an existing table, so a column added later never lands on a
-- database that already ran an earlier version of this file. Caught by
-- re-running this against Neon after adding hold_reason.
ALTER TABLE source_fetch_state ADD COLUMN IF NOT EXISTS hold_reason TEXT;

-- Defaults chosen deliberately conservative: 0.5 tokens/sec is one origin
-- fetch every two seconds per source, bursting to 30. That is roughly the
-- pace backfill_blur_placeholder.py settled on after the Wikimedia incident,
-- and the whole point is that traffic cannot push it higher.
INSERT INTO source_fetch_state (source, tokens, capacity, refill_per_sec, hold_reason)
VALUES ('met', 30, 30, 0.5, NULL), ('cleveland', 30, 30, 0.5, NULL),
       ('smithsonian', 30, 30, 0.5, NULL), ('europeana', 30, 30, 0.5, NULL),
       ('commons', 30, 30, 0.5,
        'Wikimedia NOC hold -- no server-side fetches until they reply')
ON CONFLICT (source) DO NOTHING;

-- Applied separately so re-running this file re-asserts the hold even if the
-- rows already exist. A hold that silently fails to apply is worse than none.
UPDATE source_fetch_state
   SET hold_reason = 'Wikimedia NOC hold -- no server-side fetches until they reply'
 WHERE source = 'commons' AND hold_reason IS NULL;

-- ---------------------------------------------------------------------------
-- 1b: single-flight claims
-- ---------------------------------------------------------------------------
-- Without this, 200 concurrent viewers of one uncached image produce 200
-- origin fetches. Eviction would make that routine rather than exceptional.
CREATE TABLE IF NOT EXISTS img_fetch_claims (
  cache_key  TEXT PRIMARY KEY,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Every claim expires. A function that dies mid-fetch must not be able to
  -- block that key forever, and there is no cleanup process to rely on.
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS img_fetch_claims_expiry_idx
  ON img_fetch_claims (expires_at);

-- ---------------------------------------------------------------------------
-- 1a/A2: cache and origin outcome counters
-- ---------------------------------------------------------------------------
-- The fundamental cache metric, which we have never had. Aggregated on write
-- into one row per (day, source, tier) -- deliberately NOT a per-request log.
-- Counts are anonymous by construction: no session, no IP, no user, nothing
-- that could reconstruct one person's browsing.
CREATE TABLE IF NOT EXISTS img_cache_stats (
  day           DATE   NOT NULL,
  source        TEXT   NOT NULL,
  tier          TEXT   NOT NULL,
  hits          BIGINT NOT NULL DEFAULT 0,
  misses        BIGINT NOT NULL DEFAULT 0,
  origin_ok     BIGINT NOT NULL DEFAULT 0,
  origin_429    BIGINT NOT NULL DEFAULT 0,
  origin_error  BIGINT NOT NULL DEFAULT 0,
  shed          BIGINT NOT NULL DEFAULT 0,  -- redirected rather than fetched
  PRIMARY KEY (day, source, tier)
);

-- Verify:
--   SELECT * FROM source_fetch_state;
--   SELECT day, source, tier, hits, misses,
--          round(100.0 * hits / NULLIF(hits + misses, 0), 1) AS hit_pct
--     FROM img_cache_stats ORDER BY day DESC, source;

-- =============================================================================
-- sql/011_img_cache_entries.sql
-- =============================================================================
-- Admission control and eviction bookkeeping.
--
-- Run once by hand in Neon's SQL editor. Safe to re-run.
--
-- ## One table, two jobs, on purpose
--
-- Admission control needs a request count per cache key. Eviction needs to
-- know what is stored, how big it is, and when it was last wanted. Those are
-- the same rows, and splitting them would mean two writes on every miss and a
-- join to evict anything.
--
-- ## Why admission control is the biggest storage lever
--
-- A plain LRU writes EVERYTHING once, including the long tail of images seen
-- by exactly one person and never again. Those are pure cost: they occupy the
-- budget, they push something useful out, and they are the least likely thing
-- to be asked for again. Refusing to write them at all is strictly better than
-- writing them and evicting them later, because it also avoids the write.
--
-- Measured projection: on the existing 1GB, admission control roughly
-- doubles to triples what stays warm, depending on how much of the traffic
-- is one-offs. Which we do not know yet -- see the threshold comment below.
CREATE TABLE IF NOT EXISTS img_cache_entries (
  -- source:id:tier, the same key the Blob pathname is built from.
  cache_key   TEXT PRIMARY KEY,
  source      TEXT   NOT NULL,
  tier        TEXT   NOT NULL,
  -- Admission: how many times this key has been asked for.
  requests    BIGINT NOT NULL DEFAULT 1,
  -- Eviction: NULL until the object is actually stored in Blob. Set to the
  -- stored byte count so eviction can decrement blob_usage_tracker by the
  -- right amount -- without this, deleting an object would free space in Blob
  -- that the tracker never learns about, and the running total would drift
  -- upward forever until the breaker tripped on a cache that was half empty.
  bytes       BIGINT,
  admitted_at TIMESTAMPTZ,
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Eviction scans stored entries by coldest-first. Partial, because only rows
-- with bytes IS NOT NULL are candidates -- the un-admitted ones occupy no
-- storage and are not worth indexing.
CREATE INDEX IF NOT EXISTS img_cache_entries_lru_idx
  ON img_cache_entries (last_seen)
  WHERE bytes IS NOT NULL;

-- Verify:
--   SELECT count(*) FILTER (WHERE bytes IS NOT NULL) AS stored,
--          count(*) FILTER (WHERE bytes IS NULL)     AS seen_not_stored,
--          pg_size_pretty(coalesce(sum(bytes), 0))   AS tracked_bytes
--     FROM img_cache_entries;
--
--   -- the one-off share, which is what admission control is worth:
--   SELECT requests, count(*) FROM img_cache_entries GROUP BY 1 ORDER BY 1;

-- =============================================================================
-- sql/012_host_fetch_state.sql
-- =============================================================================
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
--                        the Wikimedia NOC hold. It is keyed on source because
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

-- =============================================================================
-- sql/013_img_shed_stats.sql
-- =============================================================================
-- Why each shed happened, not just how many.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/010_img_fetch_state.sql. Safe to re-run.
--
-- ## Why a separate table rather than a column on img_cache_stats
--
-- The decision is semantic, not about size. img_cache_stats carries six
-- counters and the reason dimension applies to exactly ONE of them:
--
--   hits, misses, origin_ok, origin_429, origin_error   have no reason
--   shed                                                does
--
-- Widening that table's key to (day, source, tier, reason) would force a
-- reason onto all six, fragmenting every hit and miss row across values that
-- mean nothing to them, and muddying every existing SUM(hits) query.
--
-- Row count argues neither way and deliberately did not drive the choice.
-- Production is ~6 rows/day against a ceiling of 10 (5 sources x 2 tiers).
-- This table tops out at 5 x 2 x ~14 reasons = 140 rows/day, realistically far
-- fewer since most reasons never fire.
--
-- ## What this is NOT: a breakdown of img_cache_stats.shed
--
-- Easy to assume, and wrong. `shed` is bumped at three of the four shed paths.
-- The fourth -- an origin fetch that failed -- counts origin_429/origin_error
-- instead. Those are disjoint on purpose: `shed` counts sheds decided BEFORE
-- we tried the origin, the origin_* counters count sheds after a failed
-- attempt. Both end in a shed to the visitor.
--
-- So this table is the COMPLETE shed picture, and the relationship to the old
-- counter is:
--
--   SUM(n) WHERE reason NOT IN ('origin-429','origin-error')  ==  shed
--
-- which is asserted by tests/img-shed-reasons.test.js rather than left to be
-- rediscovered.
--
-- ## Bounded key, by construction
--
-- `reason` is normalised by normalizeShedReason() in lib/img-fetch-guard.js
-- against a fixed vocabulary, and anything unrecognised becomes 'other'. That
-- matters because the proxy emits "not-admitted-" + requests, which is
-- unbounded -- as a raw key it would grow row count with REQUEST COUNTS rather
-- than with distinct reasons.
--
-- Aggregate on write, never a row per request. Same discipline as
-- img_cache_stats and for the same reason: a retained per-request log with
-- timestamps is the one shape here that starts to look like a browsing trail.

CREATE TABLE IF NOT EXISTS img_shed_stats (
  day     DATE   NOT NULL DEFAULT CURRENT_DATE,
  source  TEXT   NOT NULL,
  tier    TEXT   NOT NULL,
  reason  TEXT   NOT NULL,
  n       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, tier, reason)
);

-- Verify:
--   SELECT day, source, tier, reason, n FROM img_shed_stats
--    ORDER BY day DESC, n DESC;
--
-- The question this table exists to answer -- is anything other than admission
-- control stopping the cache from filling?
--   SELECT source, reason, SUM(n) FROM img_shed_stats
--    WHERE reason <> 'not-admitted' AND day >= CURRENT_DATE - 7
--    GROUP BY 1, 2 ORDER BY 3 DESC;

-- =============================================================================
-- sql/014_items_department.sql
-- =============================================================================
-- The holding department, kept as its own fact.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/008_items_place_of_origin.sql. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- What went wrong without it
-- ---------------------------------------------------------------------------
-- A Met pull of European Sculpture and Decorative Arts quarantined 58
-- of 75 items (77%) on schema.region_unresolved, and the run-level guard
-- aborted the batch. The records look like:
--
--     met:102519  title='Apron'  medium='Linen'
--                 date='16th century-17th century'  artist='Unknown'
--
-- No culture, no place_of_origin, no nationality in bio. classify_region()
-- had nothing to work from and was right to resolve nothing.
--
-- The evidence was in the record and we discarded it. The department is called
-- *European* Sculpture and Decorative Arts; the Met returns `department` on
-- every object; met.py read it for the Arms and Armor category hint and threw
-- it away. Whole departments of unattributed decorative objects were therefore
-- un-ingestible.
--
-- ---------------------------------------------------------------------------
-- Why a stored column rather than a transient key
-- ---------------------------------------------------------------------------
-- `_category_hint` is transient, so a recheck classifies WORSE than
-- the original ingestion -- the evidence is gone by the time the rules run
-- again. Department would reproduce that exactly: an item passes on ingestion
-- and quarantines on its next recheck, which reads as the rules having got
-- stricter rather than as data having been dropped.
--
-- ---------------------------------------------------------------------------
-- What it is allowed to conclude
-- ---------------------------------------------------------------------------
-- classify_region() consults it LAST, only once place_of_origin and the
-- artist's nationality have both failed, and only for departments whose name
-- asserts exactly one of our regions (core.MET_DEPARTMENT_REGION_MAP):
--
--     European Sculpture and Decorative Arts -> Europe
--     European Paintings                     -> Europe
--     American Decorative Arts               -> Americas
--     Egyptian Art                           -> Africa
--     Ancient West Asian Art                 -> West Asia & Middle East
--
-- Asian Art (four buckets), Islamic Art (three), Greek and Roman Art (the
-- classical Mediterranean spans Europe, Africa and West Asia) and every
-- medium-organised department stay unresolved on purpose. A wrong region is
-- worse than an empty one: it is a claim we cannot support and it is invisible
-- once written.
--
-- The derivation trace records how="department", so a region reached this way
-- is distinguishable from one reached via the object's own place -- which is
-- needed to label the UI honestly.
--
-- ---------------------------------------------------------------------------
-- Existing rows
-- ---------------------------------------------------------------------------
-- Left NULL. Department is only known at fetch time, so back-populating means
-- re-fetching, and no backfill runs without a process that avoids rate
-- limiting first. Nothing already live changes as a result of this column.

ALTER TABLE items ADD COLUMN IF NOT EXISTS department TEXT;

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT department, count(*) FILTER (WHERE region_primary IS NOT NULL) AS with_region,
--        count(*) AS total
-- FROM items WHERE source = 'met' AND department <> '' GROUP BY 1 ORDER BY 3 DESC;

-- =============================================================================
-- sql/015_items_contributor_nationality.sql
-- =============================================================================
-- The nationalities a source records for an object's named
-- contributors, kept as their own fact.
--
-- Run once by hand in Neon's web SQL editor, same convention as
-- sql/008_items_place_of_origin.sql and sql/014_items_department.sql. Safe to re-run.
--
-- ---------------------------------------------------------------------------
-- What the API withholds
-- ---------------------------------------------------------------------------
-- met:412660 is an anonymous 1664 etching. The Open Access API returns 57 keys
-- and not one carries a nationality: artistDisplayName is "Anonymous",
-- artistNationality is "", and `constituents` lists names and IDs with no bio.
-- So it quarantined on region_unresolved with nothing to look up.
--
-- The Met's own page shows three named collaborators -- two Italian, one
-- French -- and MetObjects.csv carries them as
-- `Artist Nationality = "|Italian|Italian|French"`.
--
-- Measured across the whole CSV: 239,580 of 248,472 public-domain
-- objects (96.4%) carry at least one region signal. Only 8,892 have none.
--
-- ---------------------------------------------------------------------------
-- Why this is not `bio`, and not `artist_nationality`
-- ---------------------------------------------------------------------------
-- The shortcut -- fill empty `bio` from the CSV's Artist Display Bio -- writes
-- a falsehood. The first non-empty bio for 412660 belongs to Giulio Parigi, so
-- the row would read "Anonymous, Italian, 1571-1635 Florence" and assert a
-- lifespan for an anonymous maker who has none. attribution.py would then
-- derive artist_nationality and artist_lifespan from it in good faith.
--
-- `artist_nationality` is also unavailable: attribution.py initialises it to ""
-- on every normalise pass and derives it from `bio`, so anything written there
-- by an adapter is wiped.
--
-- What the record actually supports is narrower and true: the named
-- contributors were Italian and French. That places the OBJECT in Europe while
-- claiming nothing about the anonymous artist. Only a separate column can say
-- the narrower thing.
--
-- ---------------------------------------------------------------------------
-- How it is read
-- ---------------------------------------------------------------------------
-- classify_region() consults it after the artist's own bio and before the
-- department fallback -- weaker than a statement about this object's maker,
-- stronger than one about an entire department.
--
-- Every named contributor must agree on a region. "Italian|French" is two
-- countries and one region; "Italian|Japanese" resolves nothing rather than
-- taking whichever came first. Empty segments are skipped, since the leading
-- "|" is the anonymous primary artist.
--
-- Stored rather than looked up per classification: a transient signal makes
-- a later recheck classify worse than the original run, so the item passes
-- once and quarantines the next time.

ALTER TABLE items ADD COLUMN IF NOT EXISTS contributor_nationality TEXT;

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT count(*) FILTER (WHERE coalesce(contributor_nationality,'') <> '') AS with_value,
--        count(*) AS total
-- FROM items WHERE source = 'met';

-- =============================================================================
-- sql/016_blob_ops_stats.sql
-- =============================================================================
-- Count Blob operations directly.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/013_img_shed_stats.sql. Safe to re-run.
--
-- ## Why this exists
--
-- Vercel reported 7.6K of 10K Simple Operations with ten days left in the
-- month, and we learned it from an email. Operations were being
-- INFERRED from img_cache_stats hits and misses, which undercounts by
-- construction:
--
--   * a cache hit returns a 302 with `immutable`, so repeat views never
--     re-enter the function to be counted -- lib/img-cache-alerts.js says
--     exactly this and calls a hit-rate alert unbuildable as a result
--   * eviction's del() calls were never counted anywhere
--
-- Storage had a tracker (blob_usage_tracker) and a circuit breaker. The meter
-- that actually stops the site had neither.
--
-- ## Why (day, op) and not (day, op, source, tier)
--
-- The quota is a single monthly number across the whole account. Source and
-- tier would be interesting, but they are not what the limit is measured
-- against, and every extra dimension multiplies rows for a table whose only
-- job is to answer "how close are we to 10,000 this month".
--
-- Three ops, so at most ~93 rows/month.
--
-- Aggregate on write, never a row per request -- same discipline as
-- img_cache_stats and img_shed_stats.

CREATE TABLE IF NOT EXISTS blob_ops_stats (
  day DATE   NOT NULL DEFAULT CURRENT_DATE,
  op  TEXT   NOT NULL,          -- put | head | del
  n   BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, op)
);

-- Verify:
--   SELECT day, op, n FROM blob_ops_stats ORDER BY day DESC, op;
--
-- The question this table exists to answer -- how close are we to the quota?
--   SELECT COALESCE(SUM(n), 0) AS month_to_date
--     FROM blob_ops_stats
--    WHERE day >= date_trunc('month', CURRENT_DATE);

-- =============================================================================
-- sql/017_items_shuffle_key.sql
-- =============================================================================
-- Feed ordering moves server-side, on a PRECOMPUTED shuffle key.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/005_items_search.sql and sql/006_items_region_alt.sql. Safe to re-run.
--
-- ## Why a stored column instead of a seeded hash
--
-- The obvious server-side shuffle is `ORDER BY hash(native_id || seed)` with
-- the cursor keyed on the hash. It cannot be indexed, because the seed varies
-- per session -- so every distinct page position pays a full sort of the
-- filtered set, and the cost is per PAGE, not per session. The first visitor
-- to reach page 50 sorts the whole catalogue to return 60 rows.
--
-- A stored key inverts that: the order is materialised once, the index is
-- ordinary, and paging is `WHERE shuffle_key > $cursor ORDER BY shuffle_key
-- LIMIT n` -- an index range scan, O(log N + n) at any depth and any
-- catalogue size. This closes a gap in a $45/month Postgres budget that
-- did not account for a per-request sort at all.
--
-- Variety comes from two places instead of the seed: a per-session START
-- OFFSET into the order (a random point in the key space, paging forward and
-- wrapping), and periodic re-randomisation of the column itself. That yields
-- more distinct experiences than a fixed set of precomputed orders would, for
-- one column rather than K.
--
-- ## Why double precision, and why native_id rides along in the index
--
-- random() returns a double in [0,1). Collisions are vanishingly unlikely at
-- 2^53 distinct values, but "vanishingly unlikely" is exactly the class of
-- assumption that produced the cursor bug documented at length in
-- api/items.js -- where created_at looked distinguishing and turned out to
-- have 44 distinct values across 950 rows, so a `>` comparison on it silently
-- returned the same page forever.
--
-- So the cursor is the row-value tuple (shuffle_key, native_id), never
-- shuffle_key alone, and the index carries native_id as its second column so
-- that comparison stays an index range scan rather than a filter. A tie then
-- costs nothing; without the tiebreak a tie would skip a row or repeat one.
--
-- Worth knowing about that second column: native_id is NOT unique on its own.
-- The primary key is the composite `{source}:{native_id}`, and four live items
-- currently share a native_id across two sources -- met:107208 and
-- cleveland:107208, plus 112835, 122338 and 437876. Checked:
-- 4,502 live rows, 4,498 distinct native_ids, 4,502 distinct primary keys.
--
-- The pair is still unique in practice because shuffle_key itself is (4,663
-- distinct values over 4,663 rows), and a collision needs two identical
-- doubles -- around 2e-6 at the 200k target -- AND for that specific pair to
-- be one of the native_id twins. Measured rather than assumed: zero
-- (shuffle_key, native_id) tuples match more than one live row.
--
-- Using the primary key as the tiebreak instead would make that structural
-- rather than probabilistic. It was considered and not done: it buys nothing
-- against a risk this size, and (created_at, native_id) -- which the existing
-- pagination already uses, and which was ALSO verified unique here -- would
-- have to change with it to be worth anything.
-- ONE statement, not ADD COLUMN + UPDATE. This is load-bearing, and it was
-- measured rather than reasoned about.
--
-- random() is VOLATILE, so Postgres cannot treat this as a metadata-only
-- default: it rewrites the table, evaluating the default once per row. A
-- rewrite produces a fresh, compact heap. The obvious three-step version
-- (ADD COLUMN, then UPDATE ... SET shuffle_key = random(), then SET NOT NULL)
-- instead leaves one dead tuple per row -- measured on this catalogue at
-- 9,064 kB -> 16 MB, near-100% bloat, reclaimable only by a later VACUUM.
--
-- That is not merely untidy. Until it is vacuumed, the planner costs the
-- sequential scan against a table twice its real size and picks it over the
-- index -- which is exactly the outcome the acceptance criterion below calls a
-- failure, arrived at through the migration rather than the design. The
-- rewrite finishes at 8,656 kB, SMALLER than the 9,064 kB it started at, and
-- the planner picks the index immediately.
--
-- Also gets NOT NULL and the DEFAULT in the same statement, so ingestion never
-- has to know this column exists and no batch can introduce rows the feed
-- silently skips. IF NOT EXISTS keeps the file re-runnable; a second run is a
-- no-op and does NOT reshuffle a catalogue that is already ordered. The
-- periodic job is the only thing allowed to do that, deliberately.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS shuffle_key DOUBLE PRECISION NOT NULL DEFAULT random();

-- ===========================================================================
-- Indexes
-- ===========================================================================
-- Every index here is partial on the same live-items predicate the three API
-- handlers share (lib/items-sql.js). That is not an optimisation -- a
-- non-partial index would not be usable by a query carrying the predicate
-- without a recheck, and the whole acceptance criterion is that paging is an
-- index range scan.

-- The "All" feed tail.
CREATE INDEX IF NOT EXISTS items_shuffle_idx
  ON items (shuffle_key, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- The chip modes. category leads because it is an equality filter and
-- shuffle_key is the range -- the reverse order cannot serve the seek.
CREATE INDEX IF NOT EXISTS items_category_shuffle_idx
  ON items (category, shuffle_key, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- Statistics, immediately. The planner has just been handed a column it has
-- never seen on a table it has just rewritten; until it is analysed, its
-- estimates for shuffle_key are defaults and the plan below is not meaningful.
ANALYZE items;

-- ===========================================================================
-- Verify
-- ===========================================================================
-- Measured on the live catalogue (4,502 live / 4,663 total, avg row 1,792
-- bytes) inside a rolled-back transaction:
--
--   this design, page 1        Index Scan, no Sort    62 buffers    0.148 ms
--   this design, deep page     Index Scan, no Sort    63 buffers    0.160 ms
--   rejected hash sort @ 200k  Seq Scan + Sort     1,856 buffers  299-308 ms
--
-- Buffer count is flat in catalogue size, which is the property being bought:
-- verified holding at 4,502 / 10,000 / 20,000 / 27,600 / 50,000 rows against a
-- table padded to the same row width, always Index Scan and never a Sort.
--
-- The acceptance criterion is EXPLAIN, not assumption. Expect an
-- "Index Scan using items_shuffle_idx" and NO Sort node -- a Seq Scan here
-- means the index is not being used and the entire point of the column is
-- lost:
--
--   EXPLAIN ANALYZE
--   SELECT * FROM items
--    WHERE review_status NOT IN ('quarantined', 'rejected')
--      AND (shuffle_key, native_id) > (0.5, '')
--    ORDER BY shuffle_key, native_id
--    LIMIT 60;
--
-- Same for a chip, which must pick items_category_shuffle_idx:
--
--   EXPLAIN ANALYZE
--   SELECT * FROM items
--    WHERE review_status NOT IN ('quarantined', 'rejected')
--      AND category = 'Photography'
--      AND (shuffle_key, native_id) > (0.5, '')
--    ORDER BY shuffle_key, native_id
--    LIMIT 60;
--
-- Distribution is uniform and every live row has a key:
--   SELECT count(*) FILTER (WHERE shuffle_key IS NULL) AS unkeyed,
--          round(avg(shuffle_key)::numeric, 3) AS mean,   -- expect ~0.500
--          count(*) - count(DISTINCT shuffle_key) AS collisions
--     FROM items;

-- =============================================================================
-- sql/018_items_vocab.sql
-- =============================================================================
-- The search vocabulary, materialised.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/005_items_search.sql and sql/017_items_shuffle_key.sql. Safe to re-run.
--
-- ## Why this table exists
--
-- Autocomplete and did-you-mean were the last two things holding the whole
-- catalogue in the browser. Moving them server-side went through two designs
-- before this one, and both were rejected on measurement rather than taste:
--
--   1. Ship the whole index, as the client builds it today.
--      657 KB at 4,502 items. Titles (3,704) and mediums (1,627) are
--      effectively unique per item, so this scales with the CATALOGUE and not
--      with distinct values -- ~29 MB at the 200k target, worse than the
--      manifest it was meant to replace.
--
--   2. Query the items table per keystroke.
--      Bounded response (8 rows, ~0.5 KB) but ~300 ms at 4,502 items, because
--      an unanchored LIKE across ten column branches cannot use an index. It
--      degrades linearly, so it is a 200k problem wearing a 4.5k disguise.
--
-- So the vocabulary is computed once a night and stored. A keystroke becomes a
-- trigram-indexed lookup against a table whose row count is bounded by
-- DISTINCT VALUES -- which is the property design 1 wrongly assumed it already
-- had, and design 2 paid for on every request.
--
-- ## Refresh, and why it is never empty
--
-- api/cron/db-backup.js refreshes both tables nightly, alongside the shuffle
-- re-key. It upserts and then deletes what it did not touch, rather than
-- TRUNCATE-then-INSERT: the truncate version leaves a window where the table
-- is empty, and a visitor typing during that window gets no suggestions and no
-- error to explain why. refreshed_at is what makes the sweep possible.
--
-- The row counts here are small and stay small. Measured on the live
-- catalogue: 7,916 vocabulary entries and 9,404 words at 4,502 items.

-- ---------------------------------------------------------------------------
-- Suggestions: one row per normalised value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items_vocab (
  -- immutable_unaccent(lower(value)) -- the same folding the search path uses,
  -- so "Cézanne" and "cezanne" collapse to one entry exactly as they do in
  -- js/app.js's byValue[normalizeForSearch(value)].
  key         TEXT PRIMARY KEY,
  -- The display form to show, and the type that won. Where one string appears
  -- under several fields the best-ranked type wins, matching the client's
  -- SEARCH_TYPE_RANK tie-break rather than showing a near-duplicate twice.
  value       TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  -- SEARCH_TYPE_RANK as a number, stored so ordering is an index read rather
  -- than a CASE evaluated per row per keystroke.
  rank        SMALLINT    NOT NULL,
  item_count  INTEGER     NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unanchored substring matching is what getSearchSuggestions() does --
-- indexOf(q) !== -1, not startsWith -- so a btree is useless here and trigram
-- is the whole reason this is fast. pg_trgm is already installed for
-- items_search_text_trgm_idx.
CREATE INDEX IF NOT EXISTS items_vocab_key_trgm_idx
  ON items_vocab USING GIN (key gin_trgm_ops);

-- The result ordering: type rank first, then item count descending, matching
-- getSearchSuggestions()'s sort exactly.
CREATE INDEX IF NOT EXISTS items_vocab_rank_idx
  ON items_vocab (rank ASC, item_count DESC);

-- ---------------------------------------------------------------------------
-- Did-you-mean: the word list.
-- ---------------------------------------------------------------------------
-- Individual words rather than whole phrases, so a typo in one word of a
-- longer query still finds a correction -- the client's own rule, including
-- its three-character minimum.
CREATE TABLE IF NOT EXISTS items_vocab_words (
  word         TEXT PRIMARY KEY,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_vocab_words_trgm_idx
  ON items_vocab_words USING GIN (word gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Populated, and the counts are in the expected range:
--   SELECT count(*) FROM items_vocab;         -- ~7,900 at 4,502 items
--   SELECT count(*) FROM items_vocab_words;   -- ~9,400 at 4,502 items
--   SELECT type, count(*) FROM items_vocab GROUP BY 1 ORDER BY 2 DESC;
--
-- A keystroke is an index read, not a scan -- expect a Bitmap Index Scan on
-- items_vocab_key_trgm_idx:
--   EXPLAIN ANALYZE
--   SELECT value, type, item_count FROM items_vocab
--    WHERE key LIKE '%oil%' ORDER BY rank, item_count DESC LIMIT 8;
--
-- Nothing has gone stale (the nightly sweep is working):
--   SELECT max(now() - refreshed_at) FROM items_vocab;   -- expect < 25 hours
