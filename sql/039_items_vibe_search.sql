-- TRA-274 Phase 3: the vibe-tag real color/mood search. Three columns,
-- together -- all inputs to the same ranked, bounded vibe_search shape
-- (api/items.ts), not filters over the whole catalogue, so none of them
-- need to be index-scanned against millions of rows; they only ever sort
-- an already-filtered, already-small candidate set.
--
-- Run once by hand in Neon's web SQL editor, same convention as every
-- other file here. Safe to re-run (ADD COLUMN IF NOT EXISTS).

-- Up to 3 tags per item (1 primary + up to 2 secondary, in that order --
-- vibe_tags[1] is always the primary by construction), from the closed
-- vocabulary in artscroll-poc's vibe_taxonomy.py. Set only by the human
-- review + apply step (scripts/apply_vibe_tag_batch.mts in this repo) --
-- never by ingestion, so it's absent from POSTGRES_INGEST_COLUMNS-
-- equivalent lists the same way set_of_work_id/storyline_ids are.
ALTER TABLE items ADD COLUMN IF NOT EXISTS vibe_tags TEXT[];

-- Matching a value inside a TEXT[] needs GIN -- same reasoning and same
-- partial condition as items_region_alt_idx (sql/006) and
-- items_palette_buckets_idx (sql/038). A "moody" search expands to
-- several tags and matches an item carrying ANY of them (array overlap,
-- `&&`), not all of them -- see api/items.ts's vibe_tags_any filter.
CREATE INDEX IF NOT EXISTS items_vibe_tags_idx
  ON items USING GIN (vibe_tags)
  WHERE review_status NOT IN ('quarantined', 'rejected');

-- RMS contrast (population std deviation of lightness, normalized to
-- [0,1]), precomputed at ingestion from the same image enrich_item()
-- already decodes for accent_color/blur_placeholder/palette_hex/phash/
-- dimensions -- see precompute_colors.py's contrast_score_from_image()
-- in the ingestion repo. One of two inputs to the vibe-search ranking's
-- tie-break after curator_boost (the other, palette harmony, is a cheap
-- inline SQL expression over the already-stored palette_buckets array,
-- so it doesn't need its own column).
ALTER TABLE items ADD COLUMN IF NOT EXISTS palette_contrast_score REAL;

-- Human-set only (never by ingestion, same as vibe_tags above): lets a
-- curator promote specific items to the top of a vibe-search result
-- regardless of their harmony/contrast score. Nullable rather than
-- NOT NULL DEFAULT 0 deliberately: a disaster-recovery restore inserts an
-- explicit NULL for any column absent from an older backup snapshot (see
-- tests/backup-restore-fidelity.test.ts), which a NOT NULL constraint
-- would reject outright. NULL and 0 mean the same thing to every reader
-- (api/items.ts's ranking SQL treats it as COALESCE(curator_boost, 0)) --
-- a no-op until someone actually curates, which is expected at launch;
-- every row ranks purely on harmony+contrast until then. No index: it
-- only ever sorts an already-filtered candidate set, same as
-- palette_contrast_score.
ALTER TABLE items ADD COLUMN IF NOT EXISTS curator_boost SMALLINT;

-- Verify:
--   SELECT count(*) FILTER (WHERE vibe_tags IS NOT NULL)             AS with_vibe_tags,
--          count(*) FILTER (WHERE palette_contrast_score IS NOT NULL) AS with_contrast,
--          count(*) FILTER (WHERE curator_boost != 0)                 AS curator_boosted,
--          count(*)                                                    AS total
--     FROM items;
