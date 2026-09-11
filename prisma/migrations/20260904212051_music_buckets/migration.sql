-- Run once against Tranquilo's Neon database, then load
-- 024_music_buckets_seed.sql once against the same database. See
-- sql/README.md.
--
-- Music buckets used to be a hardcoded object in src/data/music.ts
-- (bridged to js/music.js) -- same shape of problem as shelves/
-- storylines. src/data/music.ts stays in the repo as a frozen reference
-- and test fixture (tests/data-schema.test.ts); it is no longer bridged
-- into js/ or loaded by any page.
--
-- `key` is the bucket's own stable identifier (MusicBucketKey in
-- src/types/MusicBucket.ts) -- primary key, not `category`, since a
-- bucket can exist with no category at all ("asian-art", kept for a
-- future item-level override -- see the seed file's own comment) and
-- category is therefore nullable, unique only when present.
--
-- `category` on the bucket ITSELF (rather than only in a separate
-- category -> bucket map) is what makes CATEGORY_TO_MUSIC_BUCKET
-- (a client-derived reduction of this table, not its own table --
-- see lib/music.ts) redundant to store twice: the 1:1 relationship this
-- migration inherits from music.ts's own "New mapping is now 1:1 with
-- category" note lives in exactly one column now instead of two
-- hand-written, driftable statements.
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
