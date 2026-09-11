// A Blob failure must degrade to a cache miss, never to a 500. The read
// path once handled only BlobNotFoundError and rethrew everything else, so
// a paused/unauthorised store (BlobAccessError, confirmed live when Vercel
// paused the store on 25 Aug 2026) gave the visitor a 500 for an image the
// miss path could have served by redirecting to the museum. Rule: only the
// cache can fail closed -- an optimisation that takes the page down with
// it is worse than no cache.
import { describe, expect, it } from "vitest";

const proxy = await import("../api/img/[source]/[id]/[tier].ts");

class BlobNotFoundError extends Error {}
class BlobAccessError extends Error {}

describe("a Blob head() failure is a miss, not a fatal", () => {
  it("treats a missing object as a miss", () => {
    expect(proxy.isCacheMissError(new BlobNotFoundError("not found"))).toBe(
      true,
    );
  });

  it("treats access denied as a miss -- the paused-store case", () => {
    expect(proxy.isCacheMissError(new BlobAccessError("Access denied"))).toBe(
      true,
    );
  });

  it("treats a rate limit or quota error as a miss", () => {
    for (const msg of [
      "Too many requests",
      "quota exceeded",
      "store suspended",
    ]) {
      expect(proxy.isCacheMissError(new Error(msg))).toBe(true);
    }
  });

  it("treats an unrecognised error as a miss too", () => {
    // Deliberate: no cache-lookup failure is worth a 500, and enumerating
    // Vercel's error classes is how BlobAccessError got missed the first time.
    expect(
      proxy.isCacheMissError(new Error("something new from the SDK")),
    ).toBe(true);
    expect(proxy.isCacheMissError(null)).toBe(true);
  });
});
