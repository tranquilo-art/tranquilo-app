// The decisions the warming pass makes before it touches anything. 44.5%
// of the live catalogue has no cached display image, and organic warming
// can't close that at ~14 page views a day -- but a deliberate pass that
// gets its selection or pacing wrong is a scripted way to hammer a museum.
// The pure decisions live here since the loop itself can't be
// unit-tested without network or a live database.
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_ITEMS_AND } from "../lib/items-sql.ts";
import * as warm from "../scripts/warm_image_cache.mts";

describe("which sources may be warmed", () => {
  it("refuses commons, whatever else is asked for", () => {
    // A warming pass, a loop whose entire purpose is fetching images,
    // is the easiest way to hit a held source by accident.
    expect(() => warm.assertSourceAllowed("commons")).toThrow(/commons/i);
    expect(() => warm.assertSourceAllowed("COMMONS")).toThrow(/commons/i);
  });

  it("allows sources that are not held", () => {
    for (const s of ["met", "cleveland", "europeana", "smithsonian"]) {
      expect(() => warm.assertSourceAllowed(s)).not.toThrow();
    }
  });

  it("excludes commons from an unrestricted run", () => {
    // Asking for "everything" must not quietly mean the held-off source too.
    expect(warm.sourcesToWarm(null)).not.toContain("commons");
    expect(warm.sourcesToWarm(null).length).toBeGreaterThan(0);
  });
});

describe("pacing", () => {
  it("derives the interval from the host's own refill rate", () => {
    // Reuses the rate already sanctioned for a host in host_fetch_state,
    // so this can't become a second, unsanctioned rate.
    expect(warm.intervalMsFor({ refill_per_sec: 0.2 })).toBe(5000);
    expect(warm.intervalMsFor({ refill_per_sec: 1 })).toBe(1000);
  });

  it("falls back to the conservative default when a host is unknown", () => {
    expect(warm.intervalMsFor(null)).toBe(5000);
    expect(warm.intervalMsFor({ refill_per_sec: 0 })).toBe(5000);
    expect(warm.intervalMsFor({})).toBe(5000);
  });

  it("never goes faster than the floor, however the row is configured", () => {
    expect(warm.intervalMsFor({ refill_per_sec: 1000 })).toBeGreaterThanOrEqual(
      warm.MIN_INTERVAL_MS,
    );
  });
});

describe("the circuit breaker", () => {
  // Added after a live run failed on every item and kept going -- 12
  // requests reached Cleveland before it was killed by hand; without a
  // breaker it would have walked all 7,921.

  it("stops well before a run can become an incident", () => {
    expect(warm.ERROR_LIMIT).toBeLessThanOrEqual(10);
  });

  it("trips after consecutive failures", () => {
    const b = warm.makeBreaker();
    for (let i = 0; i < warm.ERROR_LIMIT; i++) b.fail();
    expect(b.tripped()).toBe(true);
  });

  it("counts CONSECUTIVE failures, so a success resets it", () => {
    const b = warm.makeBreaker();
    for (let i = 0; i < warm.ERROR_LIMIT - 1; i++) b.fail();
    b.succeed();
    expect(b.tripped()).toBe(false);
  });

  it("would have caught the transform bug on the third item", () => {
    const b = warm.makeBreaker();
    let stoppedAfter = 0;
    for (let i = 1; i <= 7921; i++) {
      b.fail();
      if (b.tripped()) {
        stoppedAfter = i;
        break;
      }
    }
    expect(stoppedAfter).toBe(warm.ERROR_LIMIT);
    expect(stoppedAfter).toBeLessThan(12); // fewer than the 12 that got out
  });
});

describe("reading the transform result", () => {
  it("takes the buffer off the documented key", () => {
    // The warmer once guessed `out.buffer || out.body || out`, got the
    // whole object, and failed on every single item.
    expect(
      warm.bufferFrom({ buf: Buffer.from("x"), contentType: "image/webp" }),
    ).toBeInstanceOf(Buffer);
  });

  it("throws loudly rather than passing an object along", () => {
    expect(() => warm.bufferFrom({ contentType: "image/webp" })).toThrow(
      /buffer/i,
    );
    expect(() => warm.bufferFrom(null)).toThrow(/buffer/i);
  });
});

describe("the estimate it prints before doing anything", () => {
  it("reports hours from the count and the interval", () => {
    const plan = warm.estimate(2000, 5000);
    expect(plan.requests).toBe(2000);
    expect(plan.hours).toBeCloseTo(2.78, 1);
  });

  it("is honest about an empty run", () => {
    expect(warm.estimate(0, 5000)).toMatchObject({ requests: 0, hours: 0 });
  });
});

describe("what counts as already warm", () => {
  it("treats an entry with an object key as done", () => {
    expect(
      warm.needsWarming({ object_key: "img-cache/met/ab/x/display/h" }),
    ).toBe(false);
  });

  it("treats a row with no object as still cold", () => {
    // Most rows without an object_key are admission bookkeeping for
    // images seen once -- exactly what this pass exists to store.
    expect(warm.needsWarming({ object_key: null })).toBe(true);
    expect(warm.needsWarming({ object_key: "" })).toBe(true);
    expect(warm.needsWarming(null)).toBe(true);
  });
});

describe("which items are eligible to warm", () => {
  // This runs against the whole catalogue, so a selection bug here means
  // caching something deliberately not live. A hand-rolled predicate once
  // drifted from the canonical LIVE_ITEMS_PREDICATE; asserting against
  // the shared constant catches the next withheld state too.
  it("uses the same live-items predicate as everywhere else, not a private copy", () => {
    expect(warm.coldItemsSql()).toContain(LIVE_ITEMS_AND);
  });

  it("still requires an object key and an image URL to fetch", () => {
    const sql = warm.coldItemsSql();
    expect(sql).toMatch(/object_key IS NULL/);
    expect(sql).toMatch(/i\.img IS NOT NULL/);
  });
});

describe("origin selection per tier", () => {
  it("uses img for display and full_img for lightbox", () => {
    const item = { img: "https://x/small.jpg", full_img: "https://x/big.jpg" };
    expect(warm.originFor(item, "display")).toBe("https://x/small.jpg");
    expect(warm.originFor(item, "lightbox")).toBe("https://x/big.jpg");
  });

  it("falls back to img when there is no full_img", () => {
    // Matches api/items.js's own `row.full_img || row.img`.
    expect(
      warm.originFor({ img: "https://x/a.jpg", full_img: null }, "lightbox"),
    ).toBe("https://x/a.jpg");
  });

  it("returns null when there is nothing to fetch", () => {
    expect(warm.originFor({ img: null, full_img: null }, "display")).toBeNull();
    expect(warm.originFor({}, "display")).toBeNull();
  });
});

describe("warmBatch -- the one loop every caller shares", () => {
  // Extracted so the CLI and the Vercel Cron job run the exact same
  // logic -- a second hand-written copy is how similar bugs happened
  // elsewhere in this project.

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

  function fakeDeps(overrides: any = {}) {
    return {
      proxy: {
        transformForTier: vi.fn(async (raw: any) => ({
          buf: raw,
          contentType: "image/webp",
        })),
      },
      objectKey: {
        contentHash: vi.fn(() => "deadbeef"),
        objectKeyFor: vi.fn(
          (source: any, id: any, tier: any, hash: any) =>
            `img-cache/${source}/${id}/${tier}/${hash}`,
        ),
      },
      store: {
        configFromEnv: vi.fn(() => ({ enabled: true })),
        recordObjectSql: vi.fn(() => "UPDATE img_cache_entries SET ..."),
      },
      s3: {
        putObject: vi.fn(async () => ({ ok: true })),
      },
      resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
      ...overrides,
    };
  }

  const ORIGIN_HOSTS: Record<string, string> = {
    met: "images.metmuseum.org",
  };
  const imageResponse = (type = "image/jpeg") =>
    new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]), {
      headers: { "content-type": type },
    });
  const noSleep = async () => {};
  const row = (source: any, native_id: any) => ({
    source,
    native_id,
    img: `https://${ORIGIN_HOSTS[source] ?? `${source}.example`}/${native_id}.jpg`,
    title: "T",
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plans without touching deps or writing anything on a dry run", async () => {
    const sql = fakeSql([[row("met", "1"), row("met", "2")]]);
    const deps = fakeDeps();
    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: false,
      deps,
      sleepMs: noSleep,
    });
    expect(result).toMatchObject({
      committed: false,
      workLength: 2,
      firstThree: ["met:1", "met:2"],
    });
    expect(deps.store.configFromEnv).not.toHaveBeenCalled();
    // Cold items, then host_fetch_state -- a dry run still queries pacing
    // for the estimated-hours figure it prints.
    expect(sql.calls.length).toBe(2);
  });

  it("throws rather than silently falling back to Blob when S3 is not configured", async () => {
    const sql = fakeSql([[row("met", "1")], []]);
    const deps = fakeDeps({
      store: {
        configFromEnv: vi.fn(() => ({ enabled: false })),
        recordObjectSql: vi.fn(),
      },
    });
    await expect(
      warm.warmBatch({
        sql,
        tier: "display",
        sources: ["met"],
        commit: true,
        deps,
        sleepMs: noSleep,
      }),
    ).rejects.toThrow(/S3 is not configured/);
  });

  it("fetches, transforms, writes to S3, and records each item on a real run", async () => {
    const sql = fakeSql([
      [row("met", "1")], // cold items
      [], // host_fetch_state
      [{}], // INSERT img_cache_entries
      [{}], // UPDATE (recordObjectSql)
    ]);
    const deps = fakeDeps();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse()),
    );

    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: true,
      deps,
      sleepMs: noSleep,
    });

    expect(result).toMatchObject({
      committed: true,
      done: 1,
      failed: 0,
      skipped: 0,
    });
    expect(deps.proxy.transformForTier).toHaveBeenCalledTimes(1);
    expect(deps.s3.putObject).toHaveBeenCalledTimes(1);
    // Both bookkeeping statements ran, in order, after the two read queries.
    expect(sql.calls[2].text).toMatch(/INSERT INTO img_cache_entries/);
    expect(sql.calls[3].text).toBe("UPDATE img_cache_entries SET ...");
  });

  it("counts an origin failure and does not write anything for that item", async () => {
    const sql = fakeSql([[row("met", "1")], []]);
    const deps = fakeDeps();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: true,
      deps,
      sleepMs: noSleep,
    });

    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(deps.s3.putObject).not.toHaveBeenCalled();
  });

  it("trips the circuit breaker after consecutive failures rather than grinding through every item", async () => {
    const cold = Array.from({ length: 10 }, (_, i) => row("met", String(i)));
    const sql = fakeSql([cold, []]);
    const deps = fakeDeps();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: true,
      deps,
      sleepMs: noSleep,
    });

    expect(result.breakerTripped).toBe(true);
    expect(result.failed).toBe(warm.ERROR_LIMIT);
    expect(result.failed).toBeLessThan(10); // stopped well before the whole batch
  });

  it("stops early and reports it when shouldStop() flips mid-run, without losing prior progress", async () => {
    const cold = [row("met", "1"), row("met", "2"), row("met", "3")];
    const sql = fakeSql([
      cold,
      [],
      [{}],
      [{}], // item 1 succeeds fully
    ]);
    const deps = fakeDeps();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => imageResponse()),
    );
    let calls = 0;
    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: true,
      deps,
      sleepMs: noSleep,
      // Mirrors SIGINT arriving mid-loop.
      shouldStop: () => {
        calls++;
        return calls > 1;
      },
    });

    expect(result.stoppedEarly).toBe(true);
    expect(result.done).toBe(1);
    expect(deps.proxy.transformForTier).toHaveBeenCalledTimes(1);
  });

  it("skips a row whose origin URL cannot be parsed as a host, rather than crashing the run", async () => {
    const badRow = { source: "met", native_id: "1", img: "not a valid url" };
    const sql = fakeSql([[badRow], []]);
    const deps = fakeDeps();
    const result = await warm.warmBatch({
      sql,
      tier: "display",
      sources: ["met"],
      commit: true,
      deps,
      sleepMs: noSleep,
    });
    expect(result.skipped).toBe(1);
    expect(deps.proxy.transformForTier).not.toHaveBeenCalled();
  });
  describe("hardened origin fetch", () => {
    async function warmOne(
      fetchMock: ReturnType<typeof vi.fn>,
      depsOverrides: Record<string, unknown> = {},
      tier: "display" | "lightbox" = "display",
    ) {
      const sql = fakeSql([[row("met", "1")], []]);
      const deps = fakeDeps(depsOverrides);
      vi.stubGlobal("fetch", fetchMock);
      const result = await warm.warmBatch({
        sql,
        tier,
        sources: ["met"],
        commit: true,
        deps,
        sleepMs: noSleep,
      });
      return { result, deps };
    }

    it.each([
      ["a private address", "https://127.0.0.1/a.jpg"],
      ["the metadata address", "https://169.254.169.254/latest/meta-data"],
      ["plain http", "http://images.metmuseum.org/a.jpg"],
      ["a non-allowlisted host", "https://evil.example/a.jpg"],
    ])(
      "refuses a redirect to %s and stores nothing",
      async (_label, target) => {
        const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
          init?.redirect === "manual"
            ? new Response(null, { status: 302, headers: { location: target } })
            : imageResponse(),
        );
        const { result, deps } = await warmOne(fetchMock);
        expect(result).toMatchObject({ done: 0, failed: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
          redirect: "manual",
        });
        expect(deps.s3.putObject).not.toHaveBeenCalled();
      },
    );

    it("refuses an allowlisted host that resolves to a private address", async () => {
      const fetchMock = vi.fn(async () => imageResponse());
      const { result, deps } = await warmOne(fetchMock, {
        resolve: vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]),
      });
      expect(result).toMatchObject({ done: 0, failed: 1 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(deps.s3.putObject).not.toHaveBeenCalled();
    });

    it("skips a stored origin URL outside the source's allowlist without fetching", async () => {
      const sql = fakeSql([
        [{ source: "met", native_id: "1", img: "https://evil.example/1.jpg" }],
        [],
      ]);
      const deps = fakeDeps();
      const fetchMock = vi.fn(async () => imageResponse());
      vi.stubGlobal("fetch", fetchMock);
      const result = await warm.warmBatch({
        sql,
        tier: "display",
        sources: ["met"],
        commit: true,
        deps,
        sleepMs: noSleep,
      });
      expect(result).toMatchObject({ done: 0, skipped: 1 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(["image/png", "text/html", "text/html; charset=utf-8"])(
      "never stores an HTML body served as %s",
      async (type) => {
        const fetchMock = vi.fn(
          async () =>
            new Response("<!doctype html><html><body>blocked</body></html>", {
              headers: { "content-type": type },
            }),
        );
        const { result, deps } = await warmOne(fetchMock);
        expect(result).toMatchObject({ done: 0, failed: 1 });
        expect(deps.proxy.transformForTier).not.toHaveBeenCalled();
        expect(deps.s3.putObject).not.toHaveBeenCalled();
      },
    );

    it("stores the content type sharp detects, not the one the origin declared", async () => {
      const png = await sharp({
        create: {
          width: 2,
          height: 2,
          channels: 3,
          background: "#fff",
        },
      })
        .png()
        .toBuffer();
      const fetchMock = vi.fn(
        async () =>
          new Response(new Uint8Array(png), {
            headers: { "content-type": "text/html" },
          }),
      );
      const { result, deps } = await warmOne(fetchMock, {
        proxy: {
          transformForTier: vi.fn(async (raw: Buffer, type: string) => ({
            buf: raw,
            contentType: type,
          })),
        },
      });
      expect(result).toMatchObject({ done: 1, failed: 0 });
      expect(deps.s3.putObject.mock.calls[0][3]).toBe("image/png");
    });

    it("sends the identifying headers on the origin request", async () => {
      const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
        imageResponse(),
      );
      await warmOne(fetchMock);
      const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
      expect(headers.get("user-agent")).toBeTruthy();
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    });
  });
});
