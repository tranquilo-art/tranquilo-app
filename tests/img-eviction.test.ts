// Eviction. `del` is injected, so these prove the order of eviction and the
// bookkeeping around it -- the part that can silently corrupt the usage
// tracker -- not that a delete against real Vercel Blob behaves as assumed.
// This is the only code in the project that destroys data, which is why it
// ships behind IMG_EVICTION_ENABLED and these tests aren't sufficient to arm it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as evict from "../lib/img-eviction.ts";

const CAP = 1000;

// A tiny in-memory stand-in for the two tables and Blob.
function harness({
  used,
  entries,
  claims = [],
}: {
  used: number;
  entries: any[];
  claims?: any[];
}) {
  const state: any = {
    used,
    entries: entries.map((e) => ({ ...e })),
    deleted: [],
  };
  const sql: any = async (text: string, params?: any[]) => {
    if (/SELECT total_bytes FROM blob_usage_tracker/i.test(text)) {
      return [{ total_bytes: state.used }];
    }
    if (/FROM img_cache_entries e/i.test(text)) {
      const pinned = evict.PINNED_IDS;
      const candidates = state.entries
        .filter((e: any) => e.bytes != null && !claims.includes(e.cache_key))
        // Mirrors CACHE_KEY_ID_SQL: the id is everything between the first
        // and last colon, since Commons ids contain colons. Pin correctness
        // is proved against real Postgres in img-eviction-pinning.test.ts;
        // this stays so the tests below pick the same victims the real query would.
        .filter(
          (e: any) =>
            !pinned.includes(
              String(e.cache_key).replace(/^[^:]*:(.*):[^:]*$/, "$1"),
            ),
        )
        .sort((a: any, b: any) => a.last_seen - b.last_seen);
      return candidates.length
        ? [{ cache_key: candidates[0].cache_key, bytes: candidates[0].bytes }]
        : [];
    }
    if (/UPDATE blob_usage_tracker/i.test(text)) {
      state.used = Math.max(0, state.used - Number(params?.[0]));
      return [];
    }
    if (/SET bytes = NULL/i.test(text)) {
      const e = state.entries.find((x: any) => x.cache_key === params?.[0]);
      if (e) {
        e.bytes = null;
        e.admitted_at = null;
      }
      return [];
    }
    if (/SET last_seen = now\(\)/i.test(text)) {
      const e = state.entries.find((x: any) => x.cache_key === params?.[0]);
      if (e) e.last_seen = Date.now();
      return [];
    }
    return [];
  };
  sql.query = sql;
  const del = async (key: string) => {
    state.deleted.push(key);
  };
  return { state, sql, del };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env = { ...saved, IMG_EVICTION_ENABLED: "1" };
});
afterEach(() => {
  process.env = { ...saved };
});

describe("arming", () => {
  it("does nothing at all unless explicitly enabled", async () => {
    // It deletes data and has never been verified against real Blob --
    // default-off is the whole safety story.
    delete process.env.IMG_EVICTION_ENABLED;
    const h = harness({
      used: 990,
      entries: [{ cache_key: "a", bytes: 100, last_seen: 1 }],
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(r).toMatchObject({ ran: false, reason: "disabled" });
    expect(h.state.deleted).toEqual([]);
  });

  it("stays inert with no cap, no sql or no del", async () => {
    const h = harness({ used: 990, entries: [] });
    const cases: [any, any, any][] = [
      [null, h.del, { cap: CAP }],
      [h.sql, null, { cap: CAP }],
      [h.sql, h.del, {}],
    ];
    for (const args of cases) {
      expect((await evict.evictIfNeeded(...args)).ran).toBe(false);
    }
  });
});

describe("the high/low water gap", () => {
  it("does not run below the high-water mark", async () => {
    const h = harness({
      used: 500,
      entries: [{ cache_key: "a", bytes: 100, last_seen: 1 }],
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(r).toMatchObject({ ran: false, reason: "below-high-water" });
    expect(h.state.deleted).toEqual([]);
  });

  it("evicts down toward the LOW mark, not merely under the high one", async () => {
    // Stopping at the high-water mark would leave us one write away from
    // evicting again, forever.
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "cold", bytes: 100, last_seen: 1 },
        { cache_key: "mid", bytes: 100, last_seen: 2 },
        { cache_key: "warm", bytes: 100, last_seen: 3 },
      ],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.used).toBeLessThanOrEqual(CAP * evict.LOW_WATER);
  });
});

describe("what gets chosen", () => {
  it("evicts coldest first", async () => {
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "newest", bytes: 60, last_seen: 300 },
        { cache_key: "oldest", bytes: 60, last_seen: 1 },
        { cache_key: "middle", bytes: 60, last_seen: 100 },
      ],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.deleted[0]).toBe("oldest");
  });

  it("never evicts a key with a live fetch claim", async () => {
    // Deleting it underneath an in-flight fetch means they write into a
    // slot we just freed, crediting bytes that are no longer there.
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "inflight", bytes: 200, last_seen: 1 },
        { cache_key: "safe", bytes: 200, last_seen: 2 },
      ],
      claims: ["inflight"],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.deleted).not.toContain("inflight");
    expect(h.state.deleted).toContain("safe");
  });

  it("is bounded per call, however far over the cap we are", async () => {
    // A visitor is waiting; sustained pressure is handled by many requests
    // each doing a little.
    const entries = Array.from({ length: 50 }, (_, i) => ({
      cache_key: `k${i}`,
      bytes: 1,
      last_seen: i,
    }));
    const h = harness({ used: 999, entries });
    const r = await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(r.evicted).toBeLessThanOrEqual(evict.MAX_EVICTIONS_PER_CALL);
  });

  it("stops cleanly when there is nothing evictable", async () => {
    const h = harness({
      used: 990,
      entries: [{ cache_key: "a", bytes: null, last_seen: 1 }],
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(r).toMatchObject({ ran: true, evicted: 0, freed: 0 });
  });
});

describe("bookkeeping", () => {
  it("decrements the tracker by exactly what it freed", async () => {
    // Drift here matters: over-credit and the breaker eventually trips on
    // a cache that is mostly empty.
    const h = harness({
      used: 950,
      entries: [{ cache_key: "a", bytes: 150, last_seen: 1 }],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.used).toBe(800);
  });

  it("keeps the request history when it clears the bytes", async () => {
    // A re-popular image should be re-admitted on its history, not treated
    // as brand new -- only `bytes` is cleared.
    const h = harness({
      used: 950,
      entries: [{ cache_key: "a", bytes: 150, last_seen: 1, requests: 9 }],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    const row = h.state.entries.find((e: any) => e.cache_key === "a");
    expect(row).toBeDefined();
    expect(row.bytes).toBeNull();
    expect(row.requests).toBe(9);
  });

  it("credits nothing when the delete itself fails", async () => {
    const h = harness({
      used: 950,
      entries: [{ cache_key: "a", bytes: 150, last_seen: 1 }],
    });
    const failingDel = async () => {
      throw new Error("blob unavailable");
    };
    const r = await evict.evictIfNeeded(h.sql, failingDel, { cap: CAP });
    expect(h.state.used).toBe(950);
    expect(r.freed).toBe(0);
    expect(r.failed).toBeGreaterThan(0);
  });

  it("does not let one undeletable object block eviction forever", async () => {
    // Without pushing it back, the same broken key stays coldest and gets
    // picked again every call, stalling eviction permanently.
    const h = harness({
      used: 950,
      entries: [{ cache_key: "stuck", bytes: 150, last_seen: 1 }],
    });
    const failingDel = async () => {
      throw new Error("nope");
    };
    await evict.evictIfNeeded(h.sql, failingDel, { cap: CAP });
    expect(h.state.entries[0].last_seen).toBeGreaterThan(1);
  });
});

describe("dry run -- how a destructive operation gets verified safely", () => {
  it("reports what would go without deleting anything", async () => {
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "cold", bytes: 100, last_seen: 1 },
        { cache_key: "warm", bytes: 100, last_seen: 9 },
      ],
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, {
      cap: CAP,
      dryRun: true,
    });
    expect(r.reason).toBe("dry-run");
    expect(h.state.deleted).toEqual([]);
    expect(h.state.used).toBe(950);
    expect(r.would_evict.map((e: any) => e.cache_key)).toContain("cold");
    expect(r.would_free).toBeGreaterThan(0);
  });

  it("does not report evicting the same object repeatedly", async () => {
    // The real loop re-queries for "the coldest" after each deletion, but a
    // dry run deletes nothing -- a naive implementation would pick the same
    // row every pass. Candidates are batched up front to avoid that.
    const h = harness({
      used: 999,
      entries: Array.from({ length: 10 }, (_, i) => ({
        cache_key: `k${i}`,
        bytes: 50,
        last_seen: i,
      })),
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, {
      cap: CAP,
      dryRun: true,
    });
    const keys = r.would_evict.map((e: any) => e.cache_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("respects the same bound as a real run", async () => {
    const h = harness({
      used: 999,
      entries: Array.from({ length: 30 }, (_, i) => ({
        cache_key: `k${i}`,
        bytes: 1,
        last_seen: i,
      })),
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, {
      cap: CAP,
      dryRun: true,
    });
    expect(r.would_evict.length).toBeLessThanOrEqual(
      evict.MAX_EVICTIONS_PER_CALL,
    );
  });

  it("force bypasses the enable flag but nothing else", async () => {
    // What the verify-eviction route relies on: exercising the real code
    // path before arming it globally, without loosening any rules.
    delete process.env.IMG_EVICTION_ENABLED;
    const h = harness({
      used: 500,
      entries: [{ cache_key: "a", bytes: 100, last_seen: 1 }],
    });
    const r = await evict.evictIfNeeded(h.sql, h.del, {
      cap: CAP,
      force: true,
    });
    // Forced, but still below the high-water mark -- so still no eviction.
    expect(r).toMatchObject({ ran: false, reason: "below-high-water" });
  });
});

describe("hero pinning", () => {
  it("never evicts a hero, however cold it looks", async () => {
    // Found live: reconcile stamps last_seen from upload time, so until
    // traffic refreshes it, heroes (cached earliest of all) look coldest --
    // evicting the images every visitor opens on would be backwards.
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "met:191811:display", bytes: 300, last_seen: 1 }, // hero, coldest
        { cache_key: "met:999999:display", bytes: 300, last_seen: 5 },
      ],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.deleted).not.toContain("met:191811:display");
    expect(h.state.deleted).toContain("met:999999:display");
  });

  it("pins both tiers of a hero, since the id is what is pinned", async () => {
    const h = harness({
      used: 950,
      entries: [
        { cache_key: "met:191811:lightbox", bytes: 700, last_seen: 1 },
        { cache_key: "met:888888:display", bytes: 300, last_seen: 9 },
      ],
    });
    await evict.evictIfNeeded(h.sql, h.del, { cap: CAP });
    expect(h.state.deleted).not.toContain("met:191811:lightbox");
  });

  it("pins exactly the ids the feed treats as heroes", () => {
    expect(evict.PINNED_IDS).toEqual([
      "191811",
      "436528",
      "261941",
      "438821",
      "437397",
    ]);
  });
});
