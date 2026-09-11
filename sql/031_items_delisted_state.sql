-- Add a protected 'delisted' review state, distinct from 'rejected'. Run
-- once by hand in Neon's web SQL editor, same convention as
-- sql/004_items_rejected_state.sql. Safe to re-run.
--
-- Exists for a bookmark fallback: a /v/{slug} for a row that exists but
-- isn't LIVE redirects the visitor to the item's own museum page instead
-- of the homepage -- but only when the SOURCE INSTITUTION moved or
-- withdrew the object, not for any non-LIVE row. Something we curated out
-- of our own catalogue (a rejected specimen, a quarantined data-quality
-- gap) isn't owed that treatment just because it was ingested once.
--
-- Neither existing withheld state means that: 'quarantined' is OUR
-- automated data-quality judgment (the harmonization gate held it back),
-- 'rejected' is OUR curatorial judgment (a human reviewer decided it's
-- unfit) -- both are decisions we made about content we chose to keep
-- ingesting. 'delisted' is a different kind of fact: the institution's own
-- record is gone or moved, verified against their API, not a judgment
-- call -- same reasoning that split 'rejected' out of 'quarantined' in
-- sql/004 (these differ in WHO decided and WHY).
--
-- Protected exactly like 'reviewed'/'rejected' (see the CASE guards in
-- the ingestion pipeline's Postgres upsert and its harmonization backfill's
-- recompute guard, both updated alongside this migration): the gate may
-- not move an item out of it, and a re-ingestion cannot silently revive a
-- delisted row.

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_review_status_check;

ALTER TABLE items ADD CONSTRAINT items_review_status_check
  CHECK (review_status IN ('ok', 'flagged', 'quarantined', 'reviewed', 'rejected', 'delisted'));

-- Delisted rows must not be served, same as quarantined/rejected. Every
-- index below is partial on this exact predicate (lib/items-sql.ts's
-- LIVE_ITEMS_PREDICATE) -- sql/017's own header explains why that isn't
-- optional: a non-matching partial index cannot serve a query carrying the
-- predicate without a recheck, and the acceptance criterion for the feed's
-- paging queries is an index range scan.
DROP INDEX IF EXISTS items_live_idx;
CREATE INDEX IF NOT EXISTS items_live_idx
  ON items (created_at, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_facets_idx;
CREATE INDEX IF NOT EXISTS items_facets_idx
  ON items (category, timeframe, palette, media_type, region_primary)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_artist_idx;
CREATE INDEX IF NOT EXISTS items_artist_idx
  ON items (artist)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_century_idx;
CREATE INDEX IF NOT EXISTS items_century_idx
  ON items (century)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_region_alt_idx;
CREATE INDEX IF NOT EXISTS items_region_alt_idx
  ON items USING GIN (region_alt)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_shuffle_idx;
CREATE INDEX IF NOT EXISTS items_shuffle_idx
  ON items (shuffle_key, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

DROP INDEX IF EXISTS items_category_shuffle_idx;
CREATE INDEX IF NOT EXISTS items_category_shuffle_idx
  ON items (category, shuffle_key, native_id)
  WHERE review_status NOT IN ('quarantined', 'rejected', 'delisted');

-- items_review_queue_idx (flagged, quarantined) is deliberately NOT touched.
-- That index backs the "still awaiting a decision" queue -- a delisted row
-- has already had its decision, same as rejected, so it stays out of it
-- exactly the way sql/004 kept rejected out.

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT review_status, count(*) FROM items GROUP BY 1 ORDER BY 2 DESC;
-- Expect no 'delisted' rows yet -- the application writes them, not this file.
