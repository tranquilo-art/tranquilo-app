-- Give img_cache_entries a real native_id column. Run once by hand in
-- Neon's SQL editor, same convention as the other files here. Safe to
-- re-run.
--
-- The only link from a cache entry back to an item is `cache_key`
-- (`{source}:{native_id}:{tier}`), which looks parseable and isn't --
-- native_id contains colons, breaking every Commons row:
--
--   cache_key                     commons:File:Tansen painting.jpg:display
--   split_part(cache_key, ':', 2) -> 'File'                      <- wrong
--
-- lib/img-eviction.ts already hit this and works around it with a regex
-- ("NOT split_part(cache_key, ':', 2), which this was"); a column retires
-- the whole class of bug rather than let the workaround be rediscovered
-- again.
--
-- The backfill can't split on ':' either, so it uses the `source` and
-- `tier` COLUMNS already stored alongside and takes the substring between
-- them (`start = length(source) + 2`, `length = length(cache_key) -
-- length(source) - length(tier) - 2`) -- colons inside native_id are
-- irrelevant to that arithmetic, which is the point. It also covers
-- orphaned entries whose item no longer exists, which a join against
-- `items` would silently skip.
ALTER TABLE img_cache_entries ADD COLUMN IF NOT EXISTS native_id TEXT;

UPDATE img_cache_entries
   SET native_id = substring(
         cache_key
         FROM length(source) + 2
         FOR  length(cache_key) - length(source) - length(tier) - 2)
 WHERE native_id IS NULL;

-- Joins go both ways now: item -> its objects, and object -> its item.
CREATE INDEX IF NOT EXISTS img_cache_entries_native_id_idx
  ON img_cache_entries (source, native_id);

-- Verify:
-- Every row reconstructs its own cache_key from the parts -- catches any
-- off-by-one in the arithmetic above, including on colon-bearing ids:
--
--   SELECT count(*) AS mismatched FROM img_cache_entries
--    WHERE cache_key <> source || ':' || native_id || ':' || tier;
--   -- expect 0
--
-- The colon-bearing rows specifically, which are the ones that matter:
--
--   SELECT cache_key, native_id FROM img_cache_entries
--    WHERE source = 'commons' LIMIT 5;
--
-- And how many cache entries correspond to a live item:
--
--   SELECT count(*) FROM img_cache_entries e
--     JOIN items i ON i.source = e.source AND i.native_id = e.native_id
--    WHERE i.review_status NOT IN ('quarantined', 'rejected');
