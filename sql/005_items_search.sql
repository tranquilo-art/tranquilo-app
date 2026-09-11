-- What server-side search needs. Nothing here changes what the site does --
-- it adds the columns, extensions and indexes the query endpoint will use;
-- the endpoint ships behind a flag after this runs, with the current
-- unpaginated path untouched.
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
-- unaccent() is STABLE, not IMMUTABLE, since it depends on a dictionary
-- that could in principle change, so Postgres refuses to use it in an
-- index or generated column -- exactly where we need it. The standard
-- workaround is a wrapper naming the dictionary explicitly (the
-- schema-qualified 'public.unaccent' argument matters: without it the
-- function resolves through search_path at call time, which is what makes
-- the original non-immutable), genuinely deterministic for a fixed
-- dictionary. Trade-off: if the dictionary ever changes, indexes built on
-- this must be REINDEXed -- the same one every Postgres project doing
-- accent-insensitive search makes.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;


-- ===========================================================================
-- 3. century -- the field the client computes today and Postgres cannot
-- ===========================================================================
-- js/app.js computes item._century in JavaScript for every item on load,
-- and search uses it for era queries ("17th century", "ancient"); a
-- server-side query can't call JavaScript, so the value has to be stored.
--
-- Deliberately NOT a generated column: the derivation (BCE bail-outs,
-- "Nth century" phrases, a plausible-range clamp, and an
-- ASCII-word-boundary year match written character-class-by-character to
-- agree with the client's own \b) is not expressible in SQL without
-- reimplementing it a second time, which is exactly how the two sides
-- diverged before. One derivation, written to this column by a one-time
-- backfill and by classify_item() at ingestion.
ALTER TABLE items ADD COLUMN IF NOT EXISTS century INTEGER;


-- ===========================================================================
-- 4. search_text -- one normalized blob matching matchesQuery()'s fields
-- ===========================================================================
-- js/logic.js's matchesQuery() does a case-insensitive, diacritic-folded
-- SUBSTRING test against eleven fields, true if ANY matches -- not a word
-- match or prefix match, so "art" legitimately matches "Bharat".
-- Concatenating those eleven fields into one normalized column reproduces
-- that exactly (a substring present in any field is a substring of the
-- blob) and makes it one indexable expression instead of eleven ORs.
--
-- The field list mirrors matchesQuery() line for line -- if a field is
-- added there, add it here; tests/fixtures/feed-modes.json (18 real
-- search terms pinned against live results) is what catches the omission.
--
-- STORED rather than a plain index expression so the endpoint can read it
-- back for debugging, and a mismatch is visible in a row rather than only
-- inside a query plan.
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
--   node scripts/verify_feed_fixtures.mts         # must stay clean
