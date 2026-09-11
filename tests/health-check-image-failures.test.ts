// The image-failure alert fired multiple times claiming real visitors hit
// hundreds of failures, when the data showed hundreds of failures clustered
// in a single second -- a crawler with an unbounded viewport rendering the
// whole feed with images blocked, not real browsing (the feed itself can't
// produce that many simultaneous loads; imageVisibilityObserver and the
// recycling window bound it). A raw per-source count can't distinguish "the
// CDN is down for everyone" from "one crawler," and those need opposite
// responses -- these tests pin the distinction.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkRecentImageLoadFailures,
  checkSourceReachability,
  IMAGE_LOAD_FAILED_THRESHOLD_24H,
} from "../lib/cron/health-check.ts";
import { imageFetchHeaders } from "../lib/source-identity.ts";

// Minimal stand-in for the `client` tagged-query function: returns fixed rows
// and records what it was asked.
function clientReturning(rows: any) {
  const calls: any[] = [];
  const fn: any = async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    return rows;
  };
  fn.calls = calls;
  return fn;
}

function row(over: any = {}) {
  return {
    source: "cleveland",
    n: 200,
    page_loads: 4,
    timeouts: 200,
    errors: 0,
    ...over,
  };
}

describe("checkRecentImageLoadFailures", () => {
  it("says nothing when nothing failed", async () => {
    expect(await checkRecentImageLoadFailures(clientReturning([]))).toEqual([]);
  });

  it("alerts when failures span several page loads", async () => {
    const alerts = await checkRecentImageLoadFailures(clientReturning([row()]));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("cleveland");
  });

  it("does not alert when every failure came from a single page load", async () => {
    // One client, hundreds of rows, images fine for everyone else -- paging
    // a human for that is how an alert earns the reputation that makes the
    // real one get ignored.
    const alerts = await checkRecentImageLoadFailures(
      clientReturning([row({ n: 512, page_loads: 1 })]),
    );
    expect(alerts).toEqual([]);
  });

  it("still alerts for a small failure count spread across many page loads", async () => {
    // Few events but many distinct clients is a real outage in its early
    // minutes -- the opposite shape from the crawler bursts.
    const alerts = await checkRecentImageLoadFailures(
      clientReturning([
        row({ n: IMAGE_LOAD_FAILED_THRESHOLD_24H, page_loads: 5 }),
      ]),
    );
    expect(alerts).toHaveLength(1);
  });

  it("reports affected page loads, not just a row count", async () => {
    const alerts = await checkRecentImageLoadFailures(
      clientReturning([row({ n: 200, page_loads: 4 })]),
    );
    expect(alerts[0]).toMatch(/4 page load/);
  });

  it("distinguishes timeouts from errors in the message", async () => {
    // A timeout means slow or blocked; an error means 404/CORS/decode --
    // different causes, different fixes.
    const alerts = await checkRecentImageLoadFailures(
      clientReturning([row({ n: 10, timeouts: 7, errors: 3 })]),
    );
    expect(alerts[0]).toMatch(/7 timeout/);
    expect(alerts[0]).toMatch(/3 error/);
  });

  it("does not claim the failures came from real visitors", async () => {
    // The old wording asserted a fact the data can't support.
    const alerts = await checkRecentImageLoadFailures(clientReturning([row()]));
    expect(alerts[0]).not.toMatch(/real visitor/i);
  });

  it("keeps the 24h window and the event floor in the query", async () => {
    const client = clientReturning([]);
    await checkRecentImageLoadFailures(client);
    expect(client.calls[0].sql).toContain("24 hours");
    expect(client.calls[0].params).toContain(IMAGE_LOAD_FAILED_THRESHOLD_24H);
  });

  it("keeps the event floor low, because the baseline is genuinely zero", async () => {
    // The crawler problem is solved by the page-load rule, not by raising
    // this -- raising it would only delay a real outage being noticed.
    expect(IMAGE_LOAD_FAILED_THRESHOLD_24H).toBeLessThanOrEqual(10);
  });
});

// checkSourceReachability()'s probe fetch had no headers at all, unlike the
// main proxy's fetchOriginOnce(). Confirmed live: an unheaded request to a
// real Europeana thumbnail got a 403 from Cloudflare; the identical request
// with imageFetchHeaders() succeeded.
function reachabilityClient(imgBySource: Record<string, string | null>) {
  const calls: any[] = [];
  const fn: any = async (sql: string, params?: any[]) => {
    calls.push({ sql, params });
    if (sql.includes("hold_reason")) return [];
    if (sql.includes("SELECT img FROM items")) {
      const source = params?.[0];
      const img = source ? imgBySource[source] : undefined;
      return img ? [{ img }] : [];
    }
    return [];
  };
  fn.calls = calls;
  return fn;
}

describe("checkSourceReachability", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the same identifying headers as the main proxy fetch", async () => {
    let sentHeaders: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init: any) => {
        sentHeaders = init?.headers;
        return { ok: true, status: 200 };
      }),
    );
    await checkSourceReachability(
      reachabilityClient({
        europeana: "https://api.europeana.eu/thumbnail/v2/x.jpg",
      }),
    );
    expect(sentHeaders).toEqual(imageFetchHeaders("europeana"));
  });

  it("uses the Wikimedia-specific header for commons, same as the main proxy", async () => {
    let sentHeaders: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init: any) => {
        sentHeaders = init?.headers;
        return { ok: true, status: 200 };
      }),
    );
    await checkSourceReachability(
      reachabilityClient({ commons: "https://upload.wikimedia.org/x.jpg" }),
    );
    expect(sentHeaders).toEqual(imageFetchHeaders("commons"));
  });
});
