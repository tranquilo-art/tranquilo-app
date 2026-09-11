// Versioned object keys, before anything is written to S3 -- "never
// invalidate; version the key", since CloudFront invalidations are slow
// and billed, and an immutable 1-year Cache-Control can't be corrected in
// place. This must land before objects are written, since retrofitting a
// key layout across a 250 GB bucket is expensive.
//
// What's pinned: the key is content-addressed (same bytes -> same key, so
// re-fetching is idempotent and a corrected master can't collide with the
// one it replaces); it survives real id formats (Europeana slashes,
// Commons colons/commas/spaces); and it stays derivable from
// (source, id, tier) plus the hash, so the proxy can build a redirect
// without re-fetching bytes.
import { describe, expect, it } from "vitest";
import * as keys from "../lib/img-object-key.ts";

// Real shapes from the live catalogue, not invented ones.
const REAL_IDS = [
  ["met", "436535"],
  ["cleveland", "1335"],
  ["smithsonian", "ld1-1643399887910-1643399894916-0"],
  ["commons", "File:11 Qian Xuan. Sqirrel. National Palace Museum, Taipei.jpg"],
  ["europeana", "/91619/SMVK_EM_objekt_1330436"],
  ["europeana", "/542/item_6ISFIEDNWZYBCL2HOKY55GHEOJW25MJK"],
];

const BYTES = Buffer.from("pretend this is a jpeg");
const HASH = keys.contentHash(BYTES);

describe("contentHash", () => {
  it("is stable for the same bytes", () => {
    expect(keys.contentHash(BYTES)).toBe(HASH);
  });

  it("differs for different bytes", () => {
    expect(keys.contentHash(Buffer.from("a corrected master"))).not.toBe(HASH);
  });

  it("is short enough to read but long enough not to collide", () => {
    // A collision means two different images sharing a key -- a wrong
    // picture rather than a failed request.
    expect(HASH).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("the id fingerprint is wide enough for the target catalogue", () => {
  it("is 12 hex characters, not 8", () => {
    // Stops two different artworks resolving to the same folder -- a
    // correctness property, not a style choice. 8 hex was the original
    // choice and is wrong at the 5M target; widening later means re-keying
    // every object, which is why this is pinned.
    expect(keys.ID_HASH_CHARS).toBe(12);
    const seg = keys.idSegment("753368");
    expect(seg).toMatch(/-[0-9a-f]{12}$/);
  });

  it("still distinguishes ids that sanitise to the same readable prefix", () => {
    // The readable half is truncated and punctuation-collapsed, so it
    // alone can't be relied on.
    const a = keys.idSegment(
      "File:A very long Commons filename that differs at the end AAA.jpg",
    );
    const b = keys.idSegment(
      "File:A very long Commons filename that differs at the end BBB.jpg",
    );
    expect(a).not.toBe(b);
  });
});

describe("the shard segment", () => {
  it("is two hex characters and derived from native_id alone", () => {
    expect(keys.SHARD_CHARS).toBe(2);
    expect(keys.shardFor("753368")).toMatch(/^[0-9a-f]{2}$/);
    // Pure function of the id, so a database row can compute its own S3
    // prefix with no lookup table.
    expect(keys.shardFor("753368")).toBe(keys.shardFor("753368"));
  });

  it("spreads evenly across id formats that a naive prefix would not", () => {
    const ids = [];
    for (let i = 0; i < 600; i++) {
      ids.push(String(400000 + i));
      ids.push(`File:Some Commons Painting ${i}.jpg`);
      ids.push(`/10501/bib_rnod_${i}`);
    }
    const naive = new Set(ids.map((s) => s.slice(0, 2)));
    const hashed = new Set(ids.map((s) => keys.shardFor(s)));
    // The naive scheme collapses: every Commons id shares "Fi", every
    // Europeana id shares "/1".
    expect(hashed.size).toBeGreaterThan(naive.size * 2);
    expect(hashed.size).toBeGreaterThan(200);
  });

  it("prefixFor matches the start of the key it belongs to", () => {
    const prefix = keys.prefixFor("met", "753368");
    const key = keys.objectKeyFor("met", "753368", "display", "a".repeat(16));
    expect(key.startsWith(prefix)).toBe(true);
    expect(prefix.endsWith("/")).toBe(true);
  });

  it("puts the shard between source and item, not at the front", () => {
    // A leading shard would scatter one artwork's objects across the bucket.
    expect(
      keys.objectKeyFor("met", "753368", "display", "a".repeat(16)),
    ).toMatch(/^img-cache\/met\/[0-9a-f]{2}\/753368-/);
  });
});

describe("objectKeyFor", () => {
  it("is content-addressed: same bytes, same key", () => {
    expect(keys.objectKeyFor("met", "436535", "display", HASH)).toBe(
      keys.objectKeyFor("met", "436535", "display", HASH),
    );
  });

  it("changes when the bytes change, so a replacement cannot collide", () => {
    const other = keys.contentHash(Buffer.from("a corrected master"));
    expect(keys.objectKeyFor("met", "436535", "display", other)).not.toBe(
      keys.objectKeyFor("met", "436535", "display", HASH),
    );
  });

  it("separates tiers", () => {
    expect(keys.objectKeyFor("met", "436535", "display", HASH)).not.toBe(
      keys.objectKeyFor("met", "436535", "lightbox", HASH),
    );
  });

  REAL_IDS.forEach(([source, id]) => {
    it(`produces a safe S3 key for ${source} id ${id.slice(0, 28)}`, () => {
      const key = keys.objectKeyFor(source, id, "display", HASH);
      // No leading slash, no empty segments -- a "//" broke Blob pathnames
      // live, and S3 silently accepts it as a real empty segment, producing
      // an unreachable-looking key.
      expect(key.startsWith("/"), key).toBe(false);
      expect(key.includes("//"), key).toBe(false);
      // No escaping needed in a URL path, so the key goes straight into a
      // CloudFront URL.
      expect(key, key).toMatch(/^[A-Za-z0-9!_.*'()/-]+$/);
    });
  });

  it("keeps distinct ids distinct after sanitising", () => {
    // The Blob layout collapsed "/" to "_", so "a/b" and "a_b" would land
    // on the same object -- a wrong-picture bug, costs nothing to avoid.
    const a = keys.objectKeyFor("europeana", "/91619/X", "display", HASH);
    const b = keys.objectKeyFor("europeana", "_91619_X", "display", HASH);
    expect(a).not.toBe(b);
  });

  it("refuses to build a key without a hash", () => {
    // Must fail loudly rather than write an unversioned object that later
    // needs an invalidation to correct.
    expect(() => keys.objectKeyFor("met", "436535", "display", "")).toThrow(
      /hash/i,
    );
    expect(() => keys.objectKeyFor("met", "436535", "display", null)).toThrow(
      /hash/i,
    );
  });

  it("refuses an unknown tier", () => {
    expect(() => keys.objectKeyFor("met", "436535", "thumbnail", HASH)).toThrow(
      /tier/i,
    );
  });
});

describe("the migration keeps Blob and S3 addressable side by side", () => {
  it("exposes the legacy Blob pathname unchanged", () => {
    // The dual-write/read-with-Blob-fallback overlap needs the old layout
    // derivable, and the later copy-by-checksum step reads from these paths.
    expect(keys.legacyBlobPathname("met", "436535", "display")).toBe(
      "img-cache/met/436535/display",
    );
    expect(keys.legacyBlobPathname("europeana", "/91619/X", "display")).toBe(
      "img-cache/europeana/_91619_X/display",
    );
  });
});
