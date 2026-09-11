-- The search vocabulary, materialised. Run once by hand in Neon's SQL
-- editor, same convention as sql/005_items_search.sql and
-- sql/017_items_shuffle_key.sql. Safe to re-run.
--
-- Autocomplete and did-you-mean were the last two things holding the whole
-- catalogue in the browser. Two other designs for moving them server-side
-- were rejected on measurement: (1) shipping the whole index as the client
-- builds it today is 657 KB at 4,502 items, but titles/mediums are
-- effectively unique per item so it scales with the CATALOGUE rather than
-- distinct values (~29 MB at the 200k target, worse than the manifest it
-- replaced); (2) querying the items table per keystroke bounds the response
-- (8 rows, ~0.5 KB) but costs ~300ms at 4,502 items since an unanchored
-- LIKE across ten column branches can't use an index and degrades linearly.
-- So the vocabulary is computed once a night and stored: a keystroke
-- becomes a trigram-indexed lookup bounded by DISTINCT VALUES.
--
-- api/cron/db-backup.js refreshes both tables nightly alongside the
-- shuffle re-key, upserting and then deleting what it didn't touch rather
-- than TRUNCATE-then-INSERT, since the truncate version leaves a window
-- where a visitor typing gets no suggestions and no error explaining why.
-- refreshed_at is what makes that sweep possible. Measured on the live
-- catalogue: 7,916 vocabulary entries and 9,404 words at 4,502 items.

-- Suggestions: one row per normalised value.
CREATE TABLE IF NOT EXISTS items_vocab (
  -- immutable_unaccent(lower(value)), the same folding the search path
  -- uses, so "Cézanne" and "cezanne" collapse to one entry.
  key         TEXT PRIMARY KEY,
  -- Display form and the type that won -- where one string appears under
  -- several fields, the best-ranked type wins (SEARCH_TYPE_RANK tie-break)
  -- rather than showing a near-duplicate twice.
  value       TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  -- SEARCH_TYPE_RANK as a number, so ordering is an index read rather than
  -- a CASE evaluated per row per keystroke.
  rank        SMALLINT    NOT NULL,
  item_count  INTEGER     NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- getSearchSuggestions() does unanchored substring matching (indexOf(q),
-- not startsWith), so a btree is useless and trigram is the whole reason
-- this is fast. pg_trgm is already installed for items_search_text_trgm_idx.
CREATE INDEX IF NOT EXISTS items_vocab_key_trgm_idx
  ON items_vocab USING GIN (key gin_trgm_ops);

-- Matches getSearchSuggestions()'s sort: type rank first, item count
-- descending.
CREATE INDEX IF NOT EXISTS items_vocab_rank_idx
  ON items_vocab (rank ASC, item_count DESC);

-- Did-you-mean: individual words rather than whole phrases, so a typo in
-- one word of a longer query still finds a correction -- the client's own
-- rule, including its three-character minimum.
CREATE TABLE IF NOT EXISTS items_vocab_words (
  word         TEXT PRIMARY KEY,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_vocab_words_trgm_idx
  ON items_vocab_words USING GIN (word gin_trgm_ops);

-- Verify:
--   SELECT count(*) FROM items_vocab;         -- ~7,900 at 4,502 items
--   SELECT count(*) FROM items_vocab_words;   -- ~9,400 at 4,502 items
--   SELECT type, count(*) FROM items_vocab GROUP BY 1 ORDER BY 2 DESC;
--
-- A keystroke should be an index read, not a scan -- expect a Bitmap Index
-- Scan on items_vocab_key_trgm_idx:
--   EXPLAIN ANALYZE
--   SELECT value, type, item_count FROM items_vocab
--    WHERE key LIKE '%oil%' ORDER BY rank, item_count DESC LIMIT 8;
--
-- Nothing has gone stale (the nightly sweep is working):
--   SELECT max(now() - refreshed_at) FROM items_vocab;   -- expect < 25 hours
