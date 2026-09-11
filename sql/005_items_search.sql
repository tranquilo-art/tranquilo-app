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
