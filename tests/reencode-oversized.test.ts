// Re-encodes display objects cached before the WebP transform existed --
// measured as legacy PNG pass-through objects the S3 migration copied
// byte-for-byte, which stay at their original size forever since the
// transform only runs on a cache miss and these entries already exist.
// Safe because content-addressing means the re-encoded object hashes
// differently and lands on a new key, so every immutable browser cache
// already holding the old response keeps resolving.
import { describe, expect, it } from "vitest";
import * as reencode from "../scripts/reencode_oversized_images.mts";

describe("which objects are worth re-encoding", () => {
  it("takes an object above the threshold", () => {
    expect(reencode.isCandidate({ bytes: 2_000_000 }, 1_000_000)).toBe(true);
  });

  it("leaves one below it alone", () => {
    expect(reencode.isCandidate({ bytes: 100_000 }, 1_000_000)).toBe(false);
  });

  it("skips an entry with no recorded size", () => {
    // bytes IS NULL means never stored -- nothing to re-encode.
    expect(reencode.isCandidate({ bytes: null }, 1_000_000)).toBe(false);
  });

  it("skips an entry with no object key", () => {
    expect(reencode.isCandidate({ bytes: 9e9, object_key: null }, 1_000)).toBe(
      false,
    );
  });
});

describe("the decision to keep a re-encode", () => {
  it("keeps it when it is meaningfully smaller", () => {
    expect(reencode.shouldReplace(3_200_000, 240_000)).toBe(true);
  });

  it("refuses when the result is BIGGER", () => {
    // Silently inflating storage while believing we shrank it is a
    // failure that goes unnoticed.
    expect(reencode.shouldReplace(100_000, 140_000)).toBe(false);
  });

  it("refuses a saving too small to be worth a new object", () => {
    // Writing a new object, updating a row, and orphaning the old one has
    // a cost even when bytes go down.
    expect(reencode.shouldReplace(1_000_000, 990_000)).toBe(false);
  });

  it("uses a proportional threshold, not an absolute one", () => {
    // 50 kB off a 3 MB object is noise; 50 kB off a 120 kB object is a third.
    expect(reencode.shouldReplace(3_000_000, 2_950_000)).toBe(false);
    expect(reencode.shouldReplace(120_000, 70_000)).toBe(true);
  });
});

describe("the new object's identity", () => {
  it("lands on a different key than the object it replaces", () => {
    // If the key were reused, every browser holding an immutable response
    // would keep the old bytes while the database claimed otherwise.
    const before = reencode.keyFor(
      "commons",
      "File:X.png",
      "display",
      "aaaaaaaaaaaaaaaa",
    );
    const after = reencode.keyFor(
      "commons",
      "File:X.png",
      "display",
      "bbbbbbbbbbbbbbbb",
    );
    expect(before).not.toBe(after);
    expect(before.split("/").slice(0, -1).join("/")).toBe(
      after.split("/").slice(0, -1).join("/"),
    ); // same prefix, new leaf
  });

  it("keeps the key derivable from the database row", () => {
    const key = reencode.keyFor(
      "commons",
      "File:X.png",
      "display",
      "0123456789abcdef",
    );
    expect(key.startsWith("img-cache/commons/")).toBe(true);
    expect(key.endsWith("/display/0123456789abcdef")).toBe(true);
  });
});

describe("reporting", () => {
  it("totals the saving across a run", () => {
    const summary = reencode.summarise([
      { before: 3_200_000, after: 240_000 },
      { before: 1_100_000, after: 180_000 },
    ]);
    expect(summary.objects).toBe(2);
    expect(summary.savedBytes).toBe(3_880_000);
    expect(summary.pct).toBeGreaterThan(80);
  });

  it("is honest about a run that changed nothing", () => {
    expect(reencode.summarise([])).toMatchObject({
      objects: 0,
      savedBytes: 0,
      pct: 0,
    });
  });
});
