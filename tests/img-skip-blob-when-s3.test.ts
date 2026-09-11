// When S3 is on, never ask Blob anything. Without this, an un-warmed S3
// row would keep hitting Blob's head() on every request until a cache
// warms it -- one operation per image on a meter with an exhausted
// 10,000/month free tier, and pointless anyway: if S3 is enabled and the
// row has no object_key, the object is known not to be in S3, so the
// miss path is exactly what should happen next. This makes warming an
// optimisation rather than a dependency.
import { describe, expect, it } from "vitest";

const proxy = await import("../api/img/[source]/[id]/[tier].ts");

describe("shouldConsultBlob", () => {
  it("is false when S3 is enabled -- the whole point", () => {
    expect(proxy.shouldConsultBlob({ enabled: true })).toBe(false);
  });

  it("is true when S3 is not configured, so the old path still works", () => {
    expect(proxy.shouldConsultBlob({ enabled: false })).toBe(true);
    expect(proxy.shouldConsultBlob(null)).toBe(true);
    expect(proxy.shouldConsultBlob(undefined)).toBe(true);
  });
});

// The write-side sibling of shouldConsultBlob() above, asked about the
// soft-cap breaker instead of the read-side head() call. Without this,
// every S3-routed admitted write still charges blob_usage_tracker for
// bytes that were never going to Blob, eventually tripping the breaker
// over a budget that was never real.
describe("shouldCheckBlobBudget", () => {
  it("is false when S3 is enabled -- the write never reaches Blob, so its budget is not the constraint", () => {
    expect(proxy.shouldCheckBlobBudget({ enabled: true })).toBe(false);
  });

  it("is true when S3 is not configured, so the original Blob breaker still protects Blob", () => {
    expect(proxy.shouldCheckBlobBudget({ enabled: false })).toBe(true);
    expect(proxy.shouldCheckBlobBudget(null)).toBe(true);
    expect(proxy.shouldCheckBlobBudget(undefined)).toBe(true);
  });
});
