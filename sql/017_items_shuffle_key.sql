-- Feed ordering moves server-side, on a PRECOMPUTED shuffle key. Run once
-- by hand in Neon's SQL editor, same convention as sql/005_items_search.sql
-- and sql/006_items_region_alt.sql. Safe to re-run.
--
-- The obvious server-side shuffle, `ORDER BY hash(native_id || seed)` with
-- the cursor keyed on the hash, can't be indexed since the seed varies per
-- session -- every distinct page position pays a full sort of the filtered
-- set, cost per PAGE rather than per session (the first visitor to reach
-- page 50 sorts the whole catalogue for 60 rows). A stored key inverts
-- that: the order is materialised once, and paging is `WHERE shuffle_key >
-- $cursor ORDER BY shuffle_key LIMIT n`, an ordinary index range scan --
-- O(log N + n) at any depth and catalogue size. This closes a gap in a
-- $45/month Postgres budget that hadn't accounted for a per-request sort
-- at all. Variety comes instead from a per-session start offset into the
-- order (a random point in the key space, paging forward and wrapping) plus
-- periodic re-randomisation of the column, yielding more distinct
-- experiences than a fixed set of precomputed orders for one column rather
-- than K.
--
-- random() returns a double in [0,1); collisions are vanishingly unlikely
-- at 2^53 values, but that's the exact class of assumption behind the
-- cursor bug documented in api/items.js, where created_at looked
-- distinguishing and turned out to have only 44 distinct values across 950
-- rows, silently returning the same page forever. So the cursor is the
-- tuple (shuffle_key, native_id), never shuffle_key alone, and the index
-- carries native_id second so the comparison stays a range scan rather
-- than a filter with no tiebreak cost. native_id is NOT unique on its own
-- -- the primary key is the composite `{source}:{native_id}`, and four live
-- items share a native_id across two sources (met/cleveland:107208, plus
-- 112835, 122338, 437876; checked: 4,502 live rows, 4,498 distinct
-- native_ids, 4,502 distinct primary keys). The pair stays unique in
-- practice because shuffle_key itself has 4,663 distinct values over 4,663
-- rows, and a collision needs two identical doubles (~2e-6 at the 200k
-- target) landing on one of those native_id twins -- measured at zero
-- (shuffle_key, native_id) tuples matching more than one live row. Using
-- the primary key as tiebreak instead was considered and rejected: it buys
-- nothing against a risk this size, and would drag (created_at, native_id)
-- -- the existing pagination's tiebreak, also verified unique here -- along
-- with it for no gain.
--
-- ONE statement, not ADD COLUMN + UPDATE -- measured, not just reasoned
-- about. random() is VOLATILE, so Postgres can't treat this as a
-- metadata-only default: it rewrites the table, evaluating the default
-- once per row, producing a fresh compact heap. The three-step version
-- (ADD COLUMN, UPDATE ... SET shuffle_key = random(), SET NOT NULL)
-- instead leaves one dead tuple per row -- measured on this catalogue at
-- 9,064 kB -> 16 MB, near-100% bloat, reclaimable only by a later VACUUM.
-- Until vacuumed, the planner costs the sequential scan against double the
-- table's real size and picks it over the index -- exactly the failure the
-- acceptance criterion below checks for, arrived at through the migration
-- rather than the design. The one-statement rewrite instead finishes at
-- 8,656 kB, SMALLER than the 9,064 kB it started at, and the planner picks
-- the index immediately. Also gets NOT NULL and DEFAULT in the same
-- statement, so ingestion never has to know this column exists and no
-- batch can introduce rows the feed silently skips. IF NOT EXISTS keeps
-- the file re-runnable without reshuffling an already-ordered catalogue --
-- only the periodic job is allowed to do that.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS shuffle_key DOUBLE PRECISION NOT NULL DEFAULT random();

-- ===========================================================================
-- Indexes
-- ===========================================================================
-- Every index here is partial on the same live-items predicate the three
-- API handlers share (lib/items-sql.js): a non-partial index wouldn't be
-- usable by a query carrying that predicate without a recheck, and the
-- acceptance criterion is that paging is an index range scan.

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
-- Buffer count is flat in catalogue size, the property being bought:
-- verified holding at 4,502 / 10,000 / 20,000 / 27,600 / 50,000 rows against
-- a table padded to the same row width, always Index Scan and never a Sort.
--
-- Acceptance criterion is EXPLAIN, not assumption -- expect "Index Scan
-- using items_shuffle_idx" and NO Sort node; a Seq Scan means the index
-- isn't being used and the point of the column is lost:
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
