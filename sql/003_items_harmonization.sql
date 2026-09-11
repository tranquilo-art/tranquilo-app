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
