-- Content translations: one row per (entity, locale, field), so a new
-- language needs rows, not columns. Read by lib/translations.ts, which
-- serves a row only when review_status = 'approved' and, unless the row is
-- the source's own text (origin = 'original'), only while source_hash still
-- matches the text it translated.
--
-- entity_type/entity_id point at items.id ("source:native_id"),
-- storylines.id or shelves.id. Not a foreign key, since it spans tables; a
-- row whose entity is gone is never read.
--
-- field is a column name, or "chapter_caption:<item native_id>" for a
-- storyline chapter's caption.
--
-- source_hash is the lowercase hex SHA-256 of the UTF-8 source text, exactly
-- as stored.

CREATE TABLE IF NOT EXISTS translations (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('item', 'storyline', 'shelf')),
  entity_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  field TEXT NOT NULL,
  text TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('original', 'machine', 'human')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'held')),
  source_hash TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, locale, field),
  CHECK (origin = 'original' OR source_hash IS NOT NULL)
);
