// The image proxy: circuit breaker, Blob writes, origin fetches, and the
// alerting layer (AL1/AL2/AL4). The e2e harness stubs /img/** wholesale, so
// this was previously uncovered anywhere. Concurrency primitives
// (single-flight, token bucket) bring their own deliberately concurrent
// tests elsewhere, since those bugs are invisible to a single-threaded test.
//
// Both lib/sentry.ts and the proxy are real ES modules, so vi.mock()
// (which intercepts module resolution) replaces vi.spyOn() (which needed a
// mutable CommonJS module.exports and now throws on a frozen ESM
// namespace), and the proxy is loaded via a real `import` rather than
// createRequire().require(), which hits a Node/Vitest internal limitation
// once the file has its own `import` statements.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/sentry.ts", () => ({
  Sentry: {},
  reportError: vi.fn(),
}));

const sentry = await import("../lib/sentry.ts");
const proxy = await import("../api/img/[source]/[id]/[tier].ts");
const sharpLib = (await import("sharp")).default;

let reportError: any;
beforeEach(() => {
  proxy._resetAlerts();
  reportError = sentry.reportError;
  reportError.mockClear();
  reportError.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("hostOf", () => {
  it("reduces a URL to its host, which is the alert key", () => {
    // Per-host, not per-URL: one source rate-limiting us is ONE condition.
    // Keying on the URL would reproduce the flood the dedupe prevents.
    expect(
      proxy.hostOf("https://openaccess-cdn.clevelandart.org/1926.140.6/x.jpg"),
    ).toBe("openaccess-cdn.clevelandart.org");
    expect(proxy.hostOf("https://images.metmuseum.org/a/b/c.jpg")).toBe(
      "images.metmuseum.org",
    );
  });

  it("never throws on a malformed URL", () => {
    // Runs inside an error path -- a throw here would replace a useful
    // alert with an unrelated crash.
    expect(proxy.hostOf("not a url")).toBe("unknown-host");
    expect(proxy.hostOf("")).toBe("unknown-host");
    expect(proxy.hostOf(null)).toBe("unknown-host");
  });
});

describe("isAllowedOrigin", () => {
  it("allows both of Wikimedia's real image hosts for commons", () => {
    // upload.wikimedia.org serves originals; thumb.wikimedia.org serves
    // Wikimedia's own rendered derivative for non-web-ready files (TIFF
    // scans, etc). Commons items on thumb.wikimedia.org 400'd before this
    // host was added, for 15 real rows.
    expect(
      proxy.isAllowedOrigin(
        "commons",
        "display",
        "https://upload.wikimedia.org/wikipedia/commons/4/47/x.jpg",
      ),
    ).toBe(true);
    expect(
      proxy.isAllowedOrigin(
        "commons",
        "display",
        "https://thumb.wikimedia.org/wikipedia/commons/thumb/4/47/x.tif/lossy-page1-960px-x.tif.jpg",
      ),
    ).toBe(true);
  });

  it("allows npm's IIIF image host", () => {
    // Missing entirely at launch -- every npm request 400'd here as
    // "disallowed origin" before ever reaching the S3 cache-hit lookup,
    // regardless of whether the object was already cached. Confirmed
    // against real ingested rows' img/full_img values.
    expect(
      proxy.isAllowedOrigin(
        "npm",
        "display",
        "https://iiifod.npm.gov.tw/iiif/2/K1F%2FK1F001541N000000000PAA/full/,1200/0/default.jpg",
      ),
    ).toBe(true);
  });

  it("rejects a host outside the allowlist for a real source", () => {
    expect(
      proxy.isAllowedOrigin("commons", "display", "https://example.com/x.jpg"),
    ).toBe(false);
  });

  it("rejects non-https even for an allowed host", () => {
    expect(
      proxy.isAllowedOrigin(
        "commons",
        "display",
        "http://upload.wikimedia.org/wikipedia/commons/4/47/x.jpg",
      ),
    ).toBe(false);
  });
});

describe("alertOnce", () => {
  it("reports the first occurrence of a condition", async () => {
    await proxy.alertOnce("breaker-tripped", "cache is full");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].message).toContain("cache is full");
    expect(reportError.mock.calls[0][0].name).toBe("ImgProxyDegraded");
  });

  it("suppresses repeats of the same condition inside the window", async () => {
    // image_load_failed fired 14,436 times over two days before per-session
    // dedupe landed -- ten thousand identical Sentry events is
    // indistinguishable from no alert at all.
    for (let i = 0; i < 500; i++) {
      await proxy.alertOnce("breaker-tripped", "cache is full");
    }
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("keeps distinct conditions independent", async () => {
    await proxy.alertOnce("429:images.metmuseum.org", "met rate-limited");
    await proxy.alertOnce("429:upload.wikimedia.org", "commons rate-limited");
    await proxy.alertOnce("breaker-tripped", "cache full");
    expect(reportError).toHaveBeenCalledTimes(3);
  });

  it("re-alerts once the window has passed, so a persisting fault resurfaces", async () => {
    vi.useFakeTimers();
    await proxy.alertOnce("usage-high", "80%");
    expect(reportError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(proxy.ALERT_REPEAT_MS + 1000);
    await proxy.alertOnce("usage-high", "85%");
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it("never lets an alerting failure escape into the request path", async () => {
    reportError.mockRejectedValueOnce(new Error("sentry unreachable"));
    await expect(proxy.alertOnce("x", "y")).resolves.toBeUndefined();
  });

  it("tags the report with the alert key, so a Sentry rule can filter on one condition", async () => {
    // All conditions here share one error name (ImgProxyDegraded) -- the
    // tag is what lets an alert rule target e.g. s3-put-failed alone.
    await proxy.alertOnce("s3-put-failed", "boom", {
      source: "met",
      id: "1",
      tier: "display",
    });
    expect(reportError.mock.calls[0][1]).toEqual({
      tags: { alert_key: "s3-put-failed" },
      extra: { source: "met", id: "1", tier: "display" },
    });
  });

  it("still tags a report that has no extra context", async () => {
    await proxy.alertOnce("breaker-tripped", "cache is full");
    expect(reportError.mock.calls[0][1]).toEqual({
      tags: { alert_key: "breaker-tripped" },
      extra: undefined,
    });
  });
});

describe("thresholds and vocabulary", () => {
  it("warns before the cap, not at it", () => {
    // At 1.0 the alert and the outage are the same event.
    expect(proxy.USAGE_WARN_FRACTION).toBeGreaterThan(0.5);
    expect(proxy.USAGE_WARN_FRACTION).toBeLessThan(1);
  });

  it("serves exactly the two tiers the API generates", () => {
    expect(proxy.TIERS).toEqual(["display", "lightbox"]);
  });
});

describe("canShedToOrigin -- which tiers may be redirected to the source", () => {
  it("sheds display, because the origin is the same bytes we would cache", () => {
    // display's web derivative (0.1-0.5MB measured) costs the visitor
    // nothing to redirect to.
    expect(proxy.canShedToOrigin("display")).toBe(true);
  });

  it("never sheds lightbox, because the origin is the unresized master", () => {
    // Measured 20MB (Commons) / 52.9MB (Cleveland TIFF) -- redirecting there
    // discards our ~450KB resize and makes the heaviest possible request of
    // the museum. Was a live bug: the breaker 302'd both tiers to origin.
    expect(proxy.canShedToOrigin("lightbox")).toBe(false);
  });

  it("refuses to shed an unknown tier", () => {
    // Fails safe: a new tier must be opted in by someone who has thought
    // about how big its origin is.
    expect(proxy.canShedToOrigin("thumbnail" as any)).toBe(false);
    expect(proxy.canShedToOrigin(undefined as any)).toBe(false);
  });

  it("has a decision for every tier the proxy serves", () => {
    proxy.TIERS.forEach((t: string) => {
      expect(typeof proxy.canShedToOrigin(t as any)).toBe("boolean");
    });
  });
});

// What we actually store per tier: the display tier re-encodes to WebP but
// never resizes, so a large source derivative is stored at whatever size
// it arrived (15 objects over 1MB in production, largest 3.1MB, on the
// tier that loads in the feed). Run against real bytes since the property
// that matters -- stored output is bounded -- is what reading the code missed.
describe("transformForTier", () => {
  // Re-encoding a multi-megapixel plate through sharp measures 2-3s and
  // tips past vitest's 5s default when files run in parallel.
  vi.setConfig({ testTimeout: 20000 });

  // Generated, not a fixture, since dimensions are the thing under test.
  // Noise, not flat colour, since a solid image compresses to nothing and
  // the size assertions would be vacuous.
  async function plate(width: number, height: number) {
    const px = Buffer.alloc(width * height * 3);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7919) % 256;
    return sharpLib(px, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 92 })
      .toBuffer();
  }
  const dims = async (buf: Buffer) => {
    const m = await sharpLib(buf).metadata();
    return { w: m.width, h: m.height, format: m.format };
  };

  it("caps an oversized display image on its long edge", async () => {
    const big = await plate(4000, 2500);
    const out = await proxy.transformForTier(big, "image/jpeg", "display");
    const d = await dims(out.buf);
    expect(d.w).toBe(proxy.DISPLAY_MAX_DIMENSION);
    expect(d.format).toBe("webp");
    // Aspect ratio preserved: `fit: inside`, not a crop or a squash.
    expect(d.h).toBe(Math.round(2500 * (proxy.DISPLAY_MAX_DIMENSION / 4000)));
  });

  it("caps on the long edge whichever edge that is", async () => {
    // A portrait plate must be bounded by height -- passing only `width`
    // to sharp leaves tall images effectively uncapped.
    const tall = await plate(1200, 5000);
    const d = await dims(
      (await proxy.transformForTier(tall, "image/jpeg", "display")).buf,
    );
    expect(d.h).toBe(proxy.DISPLAY_MAX_DIMENSION);
    expect(d.w).toBeLessThanOrEqual(proxy.DISPLAY_MAX_DIMENSION);
  });

  it("never upscales a source that already serves something small", async () => {
    const small = await plate(600, 400);
    const d = await dims(
      (await proxy.transformForTier(small, "image/jpeg", "display")).buf,
    );
    expect(d.w).toBe(600);
    expect(d.h).toBe(400);
  });

  it("keeps the lightbox meaningfully larger, so the tier keeps its purpose", async () => {
    // If the two caps converge, the lightbox stops being worth opening.
    expect(proxy.LIGHTBOX_MAX_DIMENSION).toBeGreaterThan(
      proxy.DISPLAY_MAX_DIMENSION * 1.25,
    );
  });

  // --- behaviour that must NOT change ---
  it("still shrinks the stored bytes", async () => {
    const big = await plate(4000, 2500);
    const out = await proxy.transformForTier(big, "image/jpeg", "display");
    expect(out.buf.length).toBeLessThan(big.length);
  });

  it("still keeps the original bytes when it cannot decode them", async () => {
    const notAnImage = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const out = await proxy.transformForTier(
      notAnImage,
      "image/svg+xml",
      "display",
    );
    expect(out.buf).toBe(notAnImage);
    expect(out.contentType).toBe("image/svg+xml");
  });

  it("still caps the lightbox tier at its own dimension", async () => {
    const big = await plate(4000, 2500);
    const d = await dims(
      (await proxy.transformForTier(big, "image/jpeg", "lightbox")).buf,
    );
    expect(d.w).toBe(proxy.LIGHTBOX_MAX_DIMENSION);
  });

  it("still leaves an unknown tier's bytes alone", async () => {
    const buf = await plate(800, 600);
    const out = await proxy.transformForTier(
      buf,
      "image/jpeg",
      "something-else",
    );
    expect(out.buf).toBe(buf);
  });
});

// What we serve when we decline to fetch. Coverage of already-correct
// behaviour, not a bug fix -- each assertion was proved to have teeth by
// breaking the rule it guards and watching it fail.
describe("shedPlan", () => {
  const neverCalled = () => {
    throw new Error("must not look up a blob");
  };

  it("sends a display miss to the origin", async () => {
    // The origin is the source's web derivative, so the visitor gets
    // byte-identical content with no bytes through the function.
    expect(await proxy.shedPlan("display", neverCalled)).toEqual({
      kind: "origin",
    });
  });

  it("NEVER sends a lightbox miss to the origin", async () => {
    // The lightbox origin is the unresized master, so a redirect punishes
    // the visitor and makes the heaviest possible request of a museum --
    // this is the bvpb.mcu.es 429.
    const plan = await proxy.shedPlan("lightbox", async () => ({
      url: "https://blob/display.webp",
    }));
    expect(plan.kind).not.toBe("origin");
  });

  it("falls a lightbox miss back to the cached display image", async () => {
    expect(
      await proxy.shedPlan("lightbox", async () => ({
        url: "https://blob/d.webp",
      })),
    ).toEqual({ kind: "display", url: "https://blob/d.webp" });
  });

  it("fails honestly when the display tier is not cached either", async () => {
    // head() throws BlobNotFoundError, the real shape of "we hold nothing".
    expect(
      await proxy.shedPlan("lightbox", async () => {
        throw new Error("BlobNotFound");
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("agrees with canShedToOrigin, so the rule has ONE definition", async () => {
    for (const tier of proxy.TIERS) {
      const plan = await proxy.shedPlan(tier, async () => ({
        url: "https://blob/d",
      }));
      expect(plan.kind === "origin").toBe(proxy.canShedToOrigin(tier));
    }
  });
});

// The shed path must respond before it books. Two problems found while
// measuring latency: shedToVisitor was async but awaited at none of its
// call sites, so an awaited write inside it could resolve the handler
// while the response was still pending; and 90% of misses take this path,
// awaiting four sequential Neon round trips before a 302 -- the cache-hit
// path solved this long ago by responding then booking in parallel.
describe("shed bookkeeping", () => {
  it("runs its writes in parallel and never rejects", async () => {
    // Parallel because sequential Neon round trips after the response
    // hold the function open for no reason.
    const calls: string[] = [];
    const slow = (name: string) => async () => {
      calls.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 20));
      calls.push(`${name}:end`);
    };
    const t0 = Date.now();
    await proxy.bookShed([slow("a")(), slow("b")(), slow("c")()]);
    expect(Date.now() - t0).toBeLessThan(55); // parallel, not 60ms serial
    expect(calls.filter((c) => c.endsWith(":end"))).toHaveLength(3);
  });

  it("swallows a failed write rather than surfacing it", async () => {
    const boom = Promise.reject(new Error("neon down"));
    await expect(proxy.bookShed([boom])).resolves.toBeUndefined();
  });
});

describe("the shed path's structure", () => {
  const src = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "api",
      "img",
      "[source]",
      "[id]",
      "[tier].ts",
    ),
    "utf8",
  );

  it("awaits shedToVisitor at every call site", () => {
    const calls = src.match(/^\s*(await\s+)?shedToVisitor\(/gm) || [];
    expect(calls.length).toBeGreaterThan(2);
    const unawaited = calls.filter((c) => !/await/.test(c));
    expect(
      unawaited,
      `${unawaited.length} shedToVisitor call(s) not awaited`,
    ).toEqual([]);
  });

  it("counts a shed exactly once", () => {
    // shedWrites() bumps `shed`; the call sites used to bump it too, which
    // would silently double-count every shed.
    const bumps = (src.match(/tier,\s*"shed"/g) || []).length;
    expect(bumps, "`shed` should be bumped in exactly one place").toBe(1);
  });

  it("records an origin-handoff separately from the cause reason, only on the origin branch", () => {
    // A display-tier shed hands the visitor's own browser a 302 straight to
    // the raw origin URL, a request carrying none of imageFetchHeaders()'s
    // identifying headers and rejectable by a source's WAF for unrelated
    // reasons. Without a distinct write, that handoff was invisible in
    // img_shed_stats. Scoped to the origin branch: display-fallback and
    // unavailable never talk to the source, so tagging those would claim a
    // handoff that never happened.
    const originBranch = src.match(
      /if \(plan\.kind === "origin"\) \{[\s\S]*?\n\s*\}/,
    );
    expect(originBranch, "origin branch not found").toBeTruthy();
    expect(originBranch?.[0]).toMatch(/"origin-handoff"/);

    const displayBranch = src.match(
      /if \(plan\.kind === "display"\) \{[\s\S]*?\n\s*\}/,
    );
    expect(displayBranch, "display branch not found").toBeTruthy();
    expect(displayBranch?.[0]).not.toMatch(/"origin-handoff"/);
  });

  it("sends the response before it books", () => {
    // Structural: the ordering lives inside a closure over `res` that can't
    // be invoked without a full handler harness -- fails if a write moves
    // back above the response.
    const fn = src.match(/async function shedToVisitor[\s\S]*?\n {2}\}/);
    expect(fn, "shedToVisitor not found").toBeTruthy();
    const body = fn![0];
    const responded = Math.min(
      ...["res.end()", "redirectToOrigin()", "res.json("].map((m) => {
        const i = body.indexOf(m);
        return i === -1 ? Infinity : i;
      }),
    );
    const booked = body.indexOf("bookShed(");
    expect(responded).toBeLessThan(Infinity);
    expect(booked).toBeGreaterThan(responded);
  });
});

describe("the S3-write-failure path", () => {
  // Structural, same reasoning as above: this branch can't be invoked
  // without a full harness (real S3 signing, a real fetched image, a real
  // sql client).
  const src = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "api",
      "img",
      "[source]",
      "[id]",
      "[tier].ts",
    ),
    "utf8",
  );
  const section = src.slice(
    src.indexOf("s3Location = null;"),
    src.indexOf("// S3 not configured at all"),
  );

  it("alerts on the failure rather than staying silent", () => {
    const failedBranch = section.slice(section.indexOf("if (s3PutFailed)"));
    expect(failedBranch).toContain("alertOnce(");
    expect(failedBranch).toMatch(/alertOnce\(\s*"s3-put-failed"/);
  });

  it("hotlinks to originUrl, not a Blob URL, on the failure", () => {
    const failedBranch = section.slice(
      section.indexOf("if (s3PutFailed)"),
      section.indexOf("return;", section.indexOf("if (s3PutFailed)")),
    );
    expect(failedBranch).toContain("headerSafeLocation(originUrl)");
    expect(failedBranch).not.toContain("put(pathname");
  });

  it("still falls through to Blob when S3 is simply not configured", () => {
    // The s3PutFailed branch must not have swallowed the unconfigured case.
    expect(section.indexOf("if (s3PutFailed)")).toBeLessThan(
      src.indexOf("written = await put(pathname"),
    );
  });
});

describe("the telemetry spans carry no visitor data", () => {
  // Structural, same reasoning as above. Asserts the PII guarantee itself
  // -- span attributes are catalogue-shape debug data, never
  // req/headers/ip/cookies -- rather than exact spelling, so it survives a
  // span being renamed or moved.
  const src = readFileSync(
    join(
      import.meta.dirname,
      "..",
      "api",
      "img",
      "[source]",
      "[id]",
      "[tier].ts",
    ),
    "utf8",
  );
  const spans =
    src.match(/sentry\.Sentry\.startSpan\(\s*\{[\s\S]*?\}\s*,/g) || [];

  it("wraps the origin fetch, the transform and the S3 put", () => {
    expect(spans.length).toBe(3);
  });

  it("never passes req, headers, cookies or an ip into a span's attributes", () => {
    for (const span of spans) {
      expect(span).not.toMatch(/\breq\b/);
      expect(span).not.toMatch(/headers/);
      expect(span).not.toMatch(/cookie/i);
      expect(span).not.toMatch(/\bip\b/i);
    }
  });
});
