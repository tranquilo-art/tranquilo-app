// How an image object is addressed in S3. Lives outside /api/ since every
// file there deploys as its own function and Hobby caps the project at 12
// (see lib/items-sql.ts).
//
// The key is content-addressed (hash of the bytes), never version-counted:
// a served 302 carries a one-year immutable Cache-Control, so a corrected
// master cannot reuse its predecessor's URL at any price -- and hashing
// means the same bytes always produce the same key (idempotent re-fetch)
// while new bytes produce a new one automatically, with nothing to remember
// to bump. The cost is that a key needs the bytes in hand, hence
// img_cache_entries.object_key (sql/026_img_object_keys.sql).

import crypto from "node:crypto";

// The tiers that exist. An unknown one is a programming error rather than a
// runtime condition, and writing an object under a misspelt tier would be
// invisible until someone noticed the cache never hit.
const TIERS = ["display", "lightbox"];

// 16 hex characters (64 bits): at the ~1M object target, 48 bits carries a
// ~2e-3 birthday collision chance, and a collision here is two different
// images silently sharing a key, not a failed request. 64 bits drops that to
// ~3e-8 for four extra characters.
const HASH_CHARS = 16;

function contentHash(buf: any): string {
  return crypto
    .createHash("sha256")
    .update(buf)
    .digest("hex")
    .slice(0, HASH_CHARS);
}

// The id segment is a readable prefix plus a short hash OF THE ID, not
// percent-encoding: percent-encoding puts a literal "%" in the S3 key, which
// becomes "%25" in the CloudFront URL and 404s only for punctuation-heavy
// ids (Commons, Europeana). Readable lets a key be eyeballed against the
// catalogue; hashed makes it injective, since the Blob layout collapses "/"
// to "_" (see legacyBlobPathname) and could otherwise collide two ids onto
// one object -- a wrong-picture bug, not a missing one.
const ID_PREFIX_CHARS = 24;

// 12 hex characters (48 bits) for the ID fingerprint, sized against the 5M
// catalogue target: 8 hex gives ~2,900 expected colliding pairs there
// (a wrong-picture bug, not a missing-picture one), 12 hex drops that to
// ~0.04. Unlike the content hash (16 hex), this only needs to distinguish
// across the whole catalogue, not versions of one item, so it can't be
// shortened the same way.
const ID_HASH_CHARS = 12;

// The shard segment: two hex characters, 256 folders per source, carrying no
// information -- only there to keep a prefix listable (ListObjectsV2 pages
// at 1,000 keys). Hashed rather than taken from the id's own first
// characters, since raw ids are wildly skewed (measured: naive first-2-chars
// gave 98 buckets with one at 669; sha256 gives 256 buckets maxing at 30).
// Two hex holds to ~5M items; object_key stays authoritative in the database
// so a future widening wouldn't need re-keying existing objects.
const SHARD_CHARS = 2;

function shardFor(id: any): string {
  return crypto
    .createHash("sha256")
    .update(String(id))
    .digest("hex")
    .slice(0, SHARD_CHARS);
}

function idSegment(id: any): string {
  const raw = String(id);
  const readable = raw
    .replace(/[^A-Za-z0-9._-]+/g, "-") // collapse everything unsafe
    .replace(/^-+|-+$/g, "") // no leading or trailing separators
    .slice(0, ID_PREFIX_CHARS);
  // The hash is over the RAW id, so the collapsing above can never merge two
  // distinct ids.
  const fingerprint = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, ID_HASH_CHARS);
  return (readable ? `${readable}-` : "") + fingerprint;
}

// img-cache/{source}/{encoded id}/{tier}/{hash} -- the hash is last, not
// first, so everything about an item stays under one prefix (lifecycle
// rules, targeted deletes, and "what do we hold for this item" are all
// prefix operations).
function objectKeyFor(source: any, id: any, tier: any, hash: any): string {
  if (!hash) {
    throw new Error(
      "objectKeyFor requires a content hash -- an unversioned key is exactly " +
        "what this layout exists to prevent",
    );
  }
  if (TIERS.indexOf(tier) === -1) {
    throw new Error(`unknown tier: ${tier}`);
  }
  return `${prefixFor(source, id) + idSegment(id)}/${tier}/${hash}`;
}

// Everything up to and including the shard, with a trailing slash -- lets
// (source, native_id) alone locate an item's objects for bulk listing, with
// no lookup table needed:
//   aws s3 ls "s3://$BUCKET/$(node scripts/s3_prefix_for.mjs met 436535)"
function prefixFor(source: any, id: any): string {
  return `img-cache/${String(source).replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  )}/${shardFor(id)}/`;
}

// The Blob pathname, kept derivable for the dual-write/fallback path and the
// checksum-based backfill that copies existing objects from these pathnames
// rather than re-fetching them (re-fetching at scale is how a real
// institution 429 happened). Reproduced exactly as
// api/img/[source]/[id]/[tier].ts builds it, since this has to address
// objects that already exist.
function legacyBlobPathname(source: any, id: any, tier: any): string {
  const safeId = String(id).replace(/\//g, "_");
  return `img-cache/${source}/${safeId}/${tier}`;
}

export {
  contentHash,
  HASH_CHARS,
  ID_HASH_CHARS,
  ID_PREFIX_CHARS,
  idSegment,
  legacyBlobPathname,
  objectKeyFor,
  prefixFor,
  SHARD_CHARS,
  shardFor,
  TIERS,
};
