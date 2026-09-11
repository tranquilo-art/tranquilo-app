-- Harmonization / validation columns on `items`. Safe to run before any
-- application code ships, and safe to re-run: every statement is
-- IF NOT EXISTS. See the note on review_status's default below -- that
-- ordering property is deliberate, not incidental.

-- ---------------------------------------------------------------------------
-- Review state
-- ---------------------------------------------------------------------------

-- NOT NULL DEFAULT 'ok' is load-bearing: against a NULLable column,
-- `WHERE review_status <> 'quarantined'` evaluates to NULL (not TRUE) for
-- every pre-existing row, and the entire catalogue would vanish from
-- /api/items. The default lets the API change deploy before any backfill.
--
--   ok           nothing flagged
--   flagged      stays live, but is in the review queue
--   quarantined  persisted but NOT served -- held back, not deleted
--   reviewed     terminal, human-set: "I looked, it's fine, stop showing me"
ALTER TABLE items ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'ok';

-- The findings/changes payload: {v, rules_version, checked_at, verdict,
-- verdict_shadow, findings[], changes[]}. `changes` is the audit trail for
-- auto-applied normalizations -- the entire justification for applying any
-- of them unattended. INFO-severity findings are never written here (553
-- items share one palette bucket; per-row that is pure bloat).
ALTER TABLE items ADD COLUMN IF NOT EXISTS review_flags JSONB;

-- Which rule version last checked this row, so a 'reviewed' item stays
-- reviewed across re-ingests without going stale when a rule changes:
-- re-flag only if RULES_VERSION > items.rules_version, or the verdict differs.
ALTER TABLE items ADD COLUMN IF NOT EXISTS rules_version INTEGER;

ALTER TABLE items ADD COLUMN IF NOT EXISTS harmonized_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- source_type -- the source's own raw type/classification string, verbatim
-- ---------------------------------------------------------------------------
-- e.g. met.classification, cleveland.type, europeana's dcType. Persisted
-- rather than left transient so category-vs-source-type re-checks are a SQL
-- scan instead of a network crawl -- a re-fetch script at ~0.5s/row is ~28
-- hours at 200k items.
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_type TEXT;

-- ---------------------------------------------------------------------------
-- Attribution split
-- ---------------------------------------------------------------------------
-- `bio` conflates two things: a person's nationality + lifespan ("French,
-- 1819-1889") and a culture/dynasty attribution ("China, Tang dynasty
-- (618-907)") -- a dynasty is not a lifespan.
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

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guarded to stay re-runnable.
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
-- Partial, since the overwhelming majority of rows are 'ok'.
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
