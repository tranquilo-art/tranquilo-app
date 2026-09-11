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
