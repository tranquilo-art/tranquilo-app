// buildPatternsNarrative() is pure and DB-free, so it doesn't need the
// live-production-data verification the rest of analytics-report.js relies
// on by convention.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPatternsNarrative,
  sampleSourceLatency,
} from "../lib/cron/analytics-report.ts";
import { imageFetchHeaders } from "../lib/source-identity.ts";

function rows(pairs: any) {
  return pairs.map(([k, n]: any) => ({
    event_name: k,
    category: k,
    n: String(n),
  }));
}

function period(totalCount: any, typePairs?: any, categoryPairs?: any) {
  return {
    total: { count: String(totalCount) },
    byType: rows(typePairs || []),
    byCategory: rows(categoryPairs || []),
  };
}

describe("buildPatternsNarrative", () => {
  it("declines to compare when the previous period is too thin", () => {
    const current = period(50, [["detail_view", 50]]);
    const previous = period(3, [["detail_view", 3]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/Not enough prior-period data/);
    expect(text).toMatch(/50 total event/);
    expect(text).not.toMatch(/%/); // no percentage claim from 3 events
  });

  it("reports overall growth with a percentage", () => {
    const current = period(150, [["detail_view", 150]]);
    const previous = period(100, [["detail_view", 100]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/up 50%/);
    expect(text).toMatch(/150 vs 100/);
  });

  it("reports overall decline with a percentage", () => {
    const current = period(50, [["detail_view", 50]]);
    const previous = period(100, [["detail_view", 100]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/down 50%/);
  });

  it("calls a small swing steady rather than manufacturing a direction", () => {
    // 105 vs 100 is +5%, under the 15% notability floor.
    const current = period(105, [["detail_view", 105]]);
    const previous = period(100, [["detail_view", 100]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/held roughly steady/);
  });

  it("identifies the biggest-growing and biggest-declining event type", () => {
    const current = period(200, [
      ["detail_view", 100],
      ["category_filter", 80],
      ["music_toggle", 20],
    ]);
    const previous = period(150, [
      ["detail_view", 60],
      ["category_filter", 80],
      ["music_toggle", 10],
    ]);
    const text = buildPatternsNarrative(current, previous);
    // detail_view grew 60 -> 100 (+40, the biggest absolute gain);
    // music_toggle also grew but by less (10 -> 20, +10);
    // category_filter is flat (80 -> 80, no delta -- must not be reported
    // as either a gainer or a decliner, since it did not move at all).
    expect(text).toMatch(/`detail_view` grew the most/);
    expect(text).not.toMatch(/`category_filter` (grew|fell)/);
  });

  it("ignores a mover with too little combined volume to mean anything", () => {
    // 1 -> 3 is a real +200%, but 4 combined events is noise.
    const current = period(103, [
      ["detail_view", 100],
      ["share_click", 3],
    ]);
    const previous = period(101, [
      ["detail_view", 100],
      ["share_click", 1],
    ]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).not.toMatch(/share_click/);
  });

  it("does not claim a gainer or decliner when nothing moved enough to report", () => {
    const current = period(100, [["detail_view", 100]]);
    const previous = period(100, [["detail_view", 100]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).not.toMatch(/grew the most|fell the most/);
    expect(text).toMatch(/held roughly steady/);
  });

  it("reports the biggest category swing", () => {
    const current = period(
      120,
      [["detail_view", 20]],
      [
        ["Paintings & Portraits", 60],
        ["Photography", 40],
      ],
    );
    const previous = period(
      105,
      [["detail_view", 20]],
      [
        ["Paintings & Portraits", 30],
        ["Photography", 55],
      ],
    );
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/Paintings & Portraits/);
    expect(text).toMatch(/up 100%/);
  });

  it("handles an event type that is brand new this period", () => {
    const current = period(120, [
      ["detail_view", 100],
      ["collection_view_open", 20],
    ]);
    const previous = period(100, [["detail_view", 100]]);
    const text = buildPatternsNarrative(current, previous);
    expect(text).toMatch(/`collection_view_open` grew the most/);
    expect(text).toMatch(/new this period/);
  });
});

// Same gap as checkSourceReachability(): this probe's fetch had no headers
// at all, unlike the main proxy's fetchOriginOnce().
function latencyClient(imgBySource: Record<string, string | null>) {
  const fn: any = async (sql: string, params?: any[]) => {
    if (sql.includes("hold_reason")) return [];
    if (sql.includes("SELECT img FROM items")) {
      const source = params?.[0];
      const img = source ? imgBySource[source] : undefined;
      return img ? [{ img }] : [];
    }
    return [];
  };
  fn.query = fn;
  return fn;
}

describe("sampleSourceLatency", () => {
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
    await sampleSourceLatency(
      latencyClient({
        europeana: "https://api.europeana.eu/thumbnail/v2/x.jpg",
      }),
    );
    expect(sentHeaders).toEqual(imageFetchHeaders("europeana"));
  });
});
