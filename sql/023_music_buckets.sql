-- Run once against Tranquilo's Neon database, then load
-- 024_music_buckets_seed.sql once against the same database. See
-- sql/README.md.
--
-- Music buckets used to be a hardcoded object in src/data/music.ts
-- (bridged to js/music.js), same shape of problem as shelves/storylines;
-- src/data/music.ts stays as a frozen reference/test fixture
-- (tests/data-schema.test.ts), no longer bridged into js/ or loaded by
-- any page.
--
-- `key` (MusicBucketKey in src/types/MusicBucket.ts) is the primary key
-- rather than `category`, since a bucket can exist with no category at
-- all ("asian-art", kept for a future item-level override) -- category is
-- therefore nullable, unique only when present. Storing category on the
-- bucket ITSELF makes CATEGORY_TO_MUSIC_BUCKET (a client-derived
-- reduction of this table, see lib/music.ts) redundant to store twice:
-- the 1:1 relationship lives in one column instead of two hand-written,
-- driftable statements.
CREATE TABLE IF NOT EXISTS music_buckets (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT UNIQUE,
  track TEXT,
  credit TEXT,
  credit_url TEXT,
  license TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
