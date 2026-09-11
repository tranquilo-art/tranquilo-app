-- Record which object key is current, before anything is written to S3.
--
-- Run once by hand in Neon's SQL editor, same convention as
-- sql/011_img_cache_entries.sql. Safe to re-run.
--
-- ## Why this has to land first
--
-- This is the only real schema work in the S3 migration, and it must land
-- before objects are written, because retrofitting a key layout across a
-- 250 GB bucket is the expensive order to do it in.
--
-- The reason there is a column at all is that S3 keys are CONTENT-ADDRESSED
-- (see lib/img-object-key.ts): the key carries a hash of the bytes, so it
-- cannot be derived from (source, id, tier) alone. Something has to remember
-- what the current object hashed to, or the proxy would have to re-fetch an
-- image just to work out where it already stored it.
--
-- ## Why not simply invalidate instead
--
-- Two reasons, and the second is the one that settles it:
--
--   - CloudFront invalidations are slow and billed, which undoes the economic
--     argument for the CDN.
--   - The hot path answers a hit with a 302 carrying
--     `Cache-Control: public, max-age=31536000, immutable`. A browser holding
--     that will not re-ask for a year, and no amount of money invalidates a
--     browser cache. A corrected master genuinely cannot reuse its
--     predecessor's URL.
--
-- ## Nullable on purpose
--
-- Every existing row predates S3 and has no object key. NULL means "this entry
-- is Blob-only", which is exactly what the read-through path needs to know:
-- try S3 when there is a key, fall back to Blob when there is not. Making this
-- NOT NULL would require inventing keys for objects that have not been written
-- yet, which is the same as guessing.

-- The full S3 key of the current object, e.g.
--   img-cache/met/436535-1f0a3c9d/display/2ac8844e678589a8
ALTER TABLE img_cache_entries ADD COLUMN IF NOT EXISTS object_key TEXT;

-- The content hash the key ends in, kept as its own column rather than parsed
-- back out of object_key. The checksum-based backfill that copies existing
-- objects needs this, and a checksum that has to be recovered with a regex is
-- one bad key format away from silently comparing the wrong thing.
ALTER TABLE img_cache_entries ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- When the current object was written under its current key. Distinct from
-- admitted_at, which records when the entry was first allowed to be stored --
-- these differ the moment a master is replaced, and telling "stored once, long
-- ago" from "re-written yesterday" is the whole point of versioning.
ALTER TABLE img_cache_entries ADD COLUMN IF NOT EXISTS object_written_at TIMESTAMPTZ;

-- The proxy reads by key when serving, and a reconcile job backfills by key.
-- Partial, because rows without a key are Blob-only and are not candidates
-- for either.
CREATE INDEX IF NOT EXISTS img_cache_entries_object_key_idx
  ON img_cache_entries (object_key)
  WHERE object_key IS NOT NULL;

-- ===========================================================================
-- Verify
-- ===========================================================================
-- Nothing is keyed yet -- expected until dual-writing begins:
--   SELECT count(*) FILTER (WHERE object_key IS NOT NULL) AS keyed,
--          count(*) FILTER (WHERE object_key IS NULL)     AS blob_only
--     FROM img_cache_entries;
--
-- Once dual-writing, no two entries should ever share a key. A duplicate here
-- means two different images resolved to one object, which renders as the
-- wrong artwork rather than as a missing one:
--   SELECT object_key, count(*) FROM img_cache_entries
--    WHERE object_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
--
-- And a stored object should always carry both its key and its hash -- one
-- without the other means a write that half-completed:
--   SELECT count(*) FROM img_cache_entries
--    WHERE (object_key IS NULL) <> (content_hash IS NULL);
