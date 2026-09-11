-- The seed file's upsert (024_music_buckets_seed.sql) no longer inserts
-- this bucket, but an upsert has no DELETE branch -- an already-seeded
-- database needs this run once, by hand, to drop the row. Safe to re-run.
DELETE FROM music_buckets WHERE key = 'architecture-space';
