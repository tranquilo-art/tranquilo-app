// Deciding whether a cache miss is worth STORING.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as admission from "../lib/img-admission.ts";

function fakeSql(results: any) {
  const queue = Array.isArray(results) ? results.slice() : [];
  const fn: any = async (text: string, params?: any[]) => {
    fn.calls.push({ text, params });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next === undefined ? [] : next;
  };
  fn.calls = [];
  fn.query = fn;
  return fn;
}

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env = { ...savedEnv };
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("thresholds", () => {
  it("asks BOTH tiers to be seen twice", () => {
    // Display is scrolled past (weak signal, the long tail we don't want to
    // store); lightbox is a deliberate tap. Lightbox is still 2, not 1,
    // because it can never shed to origin -- admitting on first sight made
    // every first open an unavoidable server-side fetch from our IP.
    expect(admission.thresholdFor("display")).toBe(2);
    expect(admission.thresholdFor("lightbox")).toBe(2);
  });

  it("is overridable per tier without a code change", () => {
    process.env.IMG_ADMIT_THRESHOLD_DISPLAY = "5";
    expect(admission.thresholdFor("display")).toBe(5);
  });

  it("ignores a nonsensical override rather than admitting nothing", () => {
    // A threshold of 0 or -1 would make every image un-admittable, silently
    // disabling caching entirely.
    process.env.IMG_ADMIT_THRESHOLD_DISPLAY = "0";
    expect(admission.thresholdFor("display")).toBe(2);
    process.env.IMG_ADMIT_THRESHOLD_DISPLAY = "banana";
    expect(admission.thresholdFor("display")).toBe(2);
  });

  it("defaults an unknown tier to admitting on first sight", () => {
    expect(admission.thresholdFor("thumbnail")).toBe(1);
  });
});

describe("fast-path velocity thresholds", () => {
  it("defaults to 3 requests within 60 seconds", () => {
    expect(admission.fastPathMinRequests()).toBe(3);
    expect(admission.fastPathWindowSeconds()).toBe(60);
  });

  it("is overridable without a code change, same as thresholdFor", () => {
    process.env.IMG_ADMIT_FASTPATH_REQUESTS = "5";
    process.env.IMG_ADMIT_FASTPATH_WINDOW_SECONDS = "30";
    expect(admission.fastPathMinRequests()).toBe(5);
    expect(admission.fastPathWindowSeconds()).toBe(30);
  });

  it("ignores a nonsensical override rather than disabling the fast path", () => {
    process.env.IMG_ADMIT_FASTPATH_REQUESTS = "0";
    expect(admission.fastPathMinRequests()).toBe(3);
    process.env.IMG_ADMIT_FASTPATH_WINDOW_SECONDS = "banana";
    expect(admission.fastPathWindowSeconds()).toBe(60);
  });
});

describe("noteRequest", () => {
  it("refuses a display image on its first request", async () => {
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 1, bytes: null }]]),
      "met:1:display",
      "met",
      "display",
    );
    expect(r).toMatchObject({
      admit: false,
      requests: 1,
      reason: "below-threshold",
    });
  });

  it("admits it on the second", async () => {
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 2, bytes: null }]]),
      "met:1:display",
      "met",
      "display",
    );
    expect(r).toMatchObject({ admit: true, requests: 2, reason: "admitted" });
  });

  it("refuses a lightbox on the first open, and admits it on the second", async () => {
    const first = await admission.noteRequest(
      fakeSql([[{ requests: 1, bytes: null }]]),
      "met:1:lightbox",
      "met",
      "lightbox",
    );
    expect(first).toMatchObject({ admit: false, requests: 1 });

    const second = await admission.noteRequest(
      fakeSql([[{ requests: 2, bytes: null }]]),
      "met:1:lightbox",
      "met",
      "lightbox",
    );
    expect(second).toMatchObject({ admit: true, requests: 2 });
  });

  it("counts and decides in a single statement", async () => {
    // A read-then-write split could let two concurrent misses both read "1"
    // and decline forever, however popular the image gets.
    const sql = fakeSql([[{ requests: 2, bytes: null }]]);
    await admission.noteRequest(sql, "k", "met", "display");
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toMatch(/ON CONFLICT \(cache_key\) DO UPDATE/i);
    expect(sql.calls[0].text).toMatch(
      /requests = img_cache_entries\.requests \+ 1/i,
    );
  });

  it("does not re-admit something already stored", async () => {
    // bytes IS NOT NULL means we hold it already.
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 9, bytes: 12345 }]]),
      "k",
      "met",
      "display",
    );
    expect(r).toMatchObject({ admit: false, reason: "already-stored" });
  });

  it("admits a burst even when a raised threshold has not been reached", async () => {
    // A viral item shouldn't wait for 10 lifetime requests if 3 just landed
    // in the same minute, even with the threshold raised to conserve Blob ops.
    process.env.IMG_ADMIT_THRESHOLD_DISPLAY = "10";
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 3, bytes: null, seconds_since_first: 12 }]]),
      "met:1:display",
      "met",
      "display",
    );
    expect(r).toMatchObject({ admit: true, requests: 3, reason: "fast-path" });
  });

  it("does not fast-path a slow trickle to the same count", async () => {
    // Same count as the burst case but spread over an hour -- not the
    // velocity signal the fast path exists to catch.
    process.env.IMG_ADMIT_THRESHOLD_DISPLAY = "10";
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 3, bytes: null, seconds_since_first: 3600 }]]),
      "met:1:display",
      "met",
      "display",
    );
    expect(r).toMatchObject({ admit: false, reason: "below-threshold" });
  });

  it("never lets the fast path override the default threshold, which already wins first", async () => {
    // Default threshold is 2, default fast-path minimum is 3, so the
    // ordinary path admits first under default config, deliberately.
    const r = await admission.noteRequest(
      fakeSql([[{ requests: 2, bytes: null, seconds_since_first: 1 }]]),
      "met:1:display",
      "met",
      "display",
    );
    expect(r).toMatchObject({ admit: true, reason: "admitted" });
  });

  it("declines to store when it cannot reach the database", async () => {
    // Fails toward "serve but do not store".
    for (const sql of [fakeSql([new Error("down")]), null, fakeSql([[]])]) {
      const r = await admission.noteRequest(sql, "k", "met", "display");
      expect(r.admit).toBe(false);
    }
  });
});

describe("markStored", () => {
  it("records the byte count, which is what lets eviction free it", async () => {
    // Without it, deleting a blob frees space blob_usage_tracker never
    // learns about, drifting the running total up forever.
    const sql = fakeSql([[]]);
    await admission.markStored(sql, "met:1:display", 284000);
    expect(sql.calls[0].text).toMatch(/SET bytes = \$2/i);
    expect(sql.calls[0].params).toEqual(["met:1:display", 284000]);
  });

  it("never throws", async () => {
    await expect(
      admission.markStored(fakeSql([new Error("x")]), "k", 1),
    ).resolves.toBeUndefined();
  });
});

describe("touch", () => {
  it("refreshes recency on a hit", async () => {
    // Otherwise a popular image looks cold to LRU purely from cache age.
    const sql = fakeSql([[]]);
    await admission.touch(sql, "met:1:display");
    expect(sql.calls[0].text).toMatch(/last_seen = now\(\)/i);
    expect(sql.calls[0].params).toEqual(["met:1:display"]);
  });

  it("never throws", async () => {
    await expect(
      admission.touch(fakeSql([new Error("x")]), "k"),
    ).resolves.toBeUndefined();
  });
});
