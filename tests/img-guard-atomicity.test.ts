/* The properties that live in SQL, not in JavaScript. img-fetch-guard.test.ts
 * covers the same functions with a fake `sql` client, which can't prove a
 * property of the Postgres statement like "two concurrent callers never
 * both spend the last token." scripts/verify_fetch_guard.mts checks these
 * against real Neon by hand, since the vitest suite is offline by design.
 * PGlite removes that constraint -- real Postgres, in-process, no network
 * -- so these assertions are ported from that script to run on every commit.
 *
 * This does not replace the script: PGlite executes statements serially,
 * so `Promise.all` here doesn't produce genuinely parallel transactions.
 * What a serial run proves is ours to prove -- does the next caller's
 * predicate refuse correctly given the prior state -- since Postgres row
 * locking makes real concurrency equivalent to some serial order; whether
 * Postgres takes the lock is confirmed end to end by the Neon script.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as admission from "../lib/img-admission.ts";
import * as guard from "../lib/img-fetch-guard.ts";
import * as rateLimit from "../lib/img-visitor-rate-limit.ts";
import { makeSql } from "./helpers/pg.ts";

const proxy = await import("../api/img/[source]/[id]/[tier].ts");

const KEY = "met:1:display";
let sql: any;

beforeEach(async () => {
  sql = await makeSql([
    "010_img_fetch_state.sql",
    "012_host_fetch_state.sql",
    "011_img_cache_entries.sql",
    "025_img_cache_native_id.sql",
    "009_blob_usage_tracker_schema.sql",
  ]);
});
afterEach(async () => {
  if (sql) await sql.$close();
});

describe("single-flight (1b)", () => {
  it("admits exactly one of many callers for the same key", async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => guard.claimFetch(sql, KEY)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not serialise unrelated keys", async () => {
    // A global one-fetch-at-a-time guard would also satisfy the test above.
    const keys = ["met:1:display", "met:2:display", "cleveland:3:display"];
    expect(
      await Promise.all(keys.map((k) => guard.claimFetch(sql, k))),
    ).toEqual([true, true, true]);
  });

  it("makes a released key immediately re-claimable", async () => {
    await guard.claimFetch(sql, KEY);
    await guard.releaseFetch(sql, KEY);
    expect(await guard.claimFetch(sql, KEY)).toBe(true);
  });

  it("lets a later caller take over an expired claim", async () => {
    // A lease, not a lock -- a function that died mid-fetch must not
    // block that image forever.
    await guard.claimFetch(sql, KEY);
    await sql(
      "UPDATE img_fetch_claims SET expires_at = now() - interval '1 second'",
    );
    expect(await guard.claimFetch(sql, KEY)).toBe(true);
  });

  it("still admits exactly one when several race for an expired claim", async () => {
    await guard.claimFetch(sql, KEY);
    await sql(
      "UPDATE img_fetch_claims SET expires_at = now() - interval '1 second'",
    );
    const again = await Promise.all(
      Array.from({ length: 10 }, () => guard.claimFetch(sql, KEY)),
    );
    expect(again.filter(Boolean)).toHaveLength(1);
  });
});

describe("token bucket (1c)", () => {
  const setTokens = (source: string, tokens: number, refill: number) =>
    sql(
      "UPDATE source_fetch_state SET tokens = $2, refill_per_sec = $3, " +
        "last_refill = now() WHERE source = $1",
      [source, tokens, refill],
    );

  it("never lets more callers through than there are tokens", async () => {
    // The property. With refill off, 3 tokens must serve exactly 3 of 20.
    await setTokens("met", 3, 0);
    const out = await Promise.all(
      Array.from({ length: 20 }, () => guard.acquireFetchToken(sql, "met")),
    );
    expect(out.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("never drives the balance below zero", async () => {
    await setTokens("met", 2, 0);
    await Promise.all(
      Array.from({ length: 15 }, () => guard.acquireFetchToken(sql, "met")),
    );
    const [row] = await sql(
      "SELECT tokens FROM source_fetch_state WHERE source = 'met'",
    );
    expect(Number(row.tokens)).toBeGreaterThanOrEqual(0);
  });

  it("refuses a fractional last token rather than rounding up", async () => {
    // Rounding up grants one extra origin request per source per window.
    await setTokens("met", 0.9, 0);
    expect((await guard.acquireFetchToken(sql, "met")).allowed).toBe(false);
  });

  it("refills over elapsed time, with no scheduled job", async () => {
    await setTokens("met", 0, 10);
    expect((await guard.acquireFetchToken(sql, "met")).allowed).toBe(false);
    await sql(
      "UPDATE source_fetch_state SET last_refill = now() - interval '1 second' " +
        "WHERE source = 'met'",
    );
    expect((await guard.acquireFetchToken(sql, "met")).allowed).toBe(true);
  });

  it("never refills past capacity", async () => {
    await setTokens("met", 0, 10);
    await sql(
      "UPDATE source_fetch_state SET last_refill = now() - interval '1 hour' " +
        "WHERE source = 'met'",
    );
    const r = await guard.acquireFetchToken(sql, "met");
    const [row] = await sql(
      "SELECT capacity FROM source_fetch_state WHERE source = 'met'",
    );
    expect(r.tokens).toBeLessThanOrEqual(Number(row.capacity));
  });
});

describe("Retry-After cooldown (1d)", () => {
  it("denies despite a completely full bucket", async () => {
    await sql(
      "UPDATE source_fetch_state SET tokens = 100, refill_per_sec = 0 " +
        "WHERE source = 'met'",
    );
    await guard.blockSource(sql, "met", 120);
    const r = await guard.acquireFetchToken(sql, "met");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("cooldown");
  });

  it("allows again once the window has passed", async () => {
    await sql(
      "UPDATE source_fetch_state SET tokens = 100, refill_per_sec = 0, " +
        "blocked_until = now() - interval '1 second' WHERE source = 'met'",
    );
    expect((await guard.acquireFetchToken(sql, "met")).allowed).toBe(true);
  });
});

describe("counters aggregate rather than accumulating rows (1a/A2)", () => {
  it("keeps 25 concurrent bumps in one row, losing none", async () => {
    // Aggregate-on-write keeps this anonymous by construction: counts and
    // last_seen, never a per-request log.
    await Promise.all(
      Array.from({ length: 25 }, () =>
        guard.bumpStat(sql, "met", "display", "hits"),
      ),
    );
    const rows = await sql(
      "SELECT hits FROM img_cache_stats WHERE day = CURRENT_DATE " +
        "AND source = 'met' AND tier = 'display'",
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].hits)).toBe(25);
  });
});

describe("standing holds are data, not code", () => {
  it("refuses commons however full its bucket is", async () => {
    // The standing rate-limit hold must outrank a full bucket.
    await sql(
      "UPDATE source_fetch_state SET tokens = 100, refill_per_sec = 10 " +
        "WHERE source = 'commons'",
    );
    const r = await guard.acquireFetchToken(sql, "commons");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("held");
  });
});

describe("admission control (3a)", () => {
  it("does not admit on first sight, and does on the second", async () => {
    const key = "met:admit-me:display";
    const first = await admission.noteRequest(sql, key, "met", "display");
    expect(first.admit).toBe(false);
    const second = await admission.noteRequest(sql, key, "met", "display");
    expect(second.admit).toBe(true);
  });

  it("counts and decides in one statement, so concurrent misses cannot both admit", async () => {
    const key = "met:race:display";
    const out = await Promise.all(
      Array.from({ length: 10 }, () =>
        admission.noteRequest(sql, key, "met", "display"),
      ),
    );
    const [row] = await sql(
      "SELECT requests FROM img_cache_entries WHERE cache_key = $1",
      [key],
    );
    expect(Number(row.requests)).toBe(10); // none lost
    expect(out.filter((r) => r.admit).length).toBeGreaterThan(0);
  });
});

describe("the storage circuit breaker", () => {
  // reserveUsage()'s own statement, imported rather than retyped, so this
  // can't keep passing after someone edits the real one.
  const RESERVE = proxy.RESERVE_USAGE_SQL;

  beforeEach(async () => {
    await sql(
      "INSERT INTO blob_usage_tracker (id, total_bytes) VALUES (1, 0) " +
        "ON CONFLICT (id) DO UPDATE SET total_bytes = 0",
    );
  });

  it("never lets concurrent writers cross the cap", async () => {
    // 10 writers, 300 bytes each, 1000-byte cap: exactly 3 may win.
    const out = await Promise.all(
      Array.from({ length: 10 }, () => sql(RESERVE, [300, 1000])),
    );
    expect(out.filter((rows) => rows.length)).toHaveLength(3);
    const [row] = await sql(
      "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
    );
    expect(Number(row.total_bytes)).toBeLessThanOrEqual(1000);
  });

  it("admits a write that lands exactly on the cap", async () => {
    expect(await sql(RESERVE, [1000, 1000])).toHaveLength(1);
  });

  it("refuses one byte over, and writes nothing", async () => {
    expect(await sql(RESERVE, [1001, 1000])).toHaveLength(0);
    const [row] = await sql(
      "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
    );
    expect(Number(row.total_bytes)).toBe(0);
  });
});

describe("visitor rate limit", () => {
  // Its own schema and its own local `sql`, kept scoped to this describe block.
  let visitorSql: any;

  beforeEach(async () => {
    visitorSql = await makeSql(["035_visitor_rate_state.sql"]);
  });
  afterEach(async () => {
    if (visitorSql) await visitorSql.$close();
  });

  const setTokens = (
    ip: string,
    tokens: number,
    capacity: number,
    refill: number,
  ) =>
    visitorSql(
      "UPDATE visitor_fetch_state SET tokens = $2, capacity = $3, refill_per_sec = $4, " +
        "last_refill = now() WHERE ip = $1",
      [ip, tokens, capacity, refill],
    );

  it("creates the row on first sight and admits it, at the configured capacity", async () => {
    const r = await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    expect(r.allowed).toBe(true);
    const [row] = await visitorSql(
      "SELECT capacity, refill_per_sec FROM visitor_fetch_state WHERE ip = $1",
      ["203.0.113.7"],
    );
    expect(Number(row.capacity)).toBe(60);
    expect(Number(row.refill_per_sec)).toBe(1);
  });

  it("never lets more callers through than there are tokens", async () => {
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7"); // creates the row
    await setTokens("203.0.113.7", 3, 60, 0);
    const out = await Promise.all(
      Array.from({ length: 20 }, () =>
        rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7"),
      ),
    );
    expect(out.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("never drives the balance below zero", async () => {
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    await setTokens("203.0.113.7", 2, 60, 0);
    await Promise.all(
      Array.from({ length: 15 }, () =>
        rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7"),
      ),
    );
    const [row] = await visitorSql(
      "SELECT tokens FROM visitor_fetch_state WHERE ip = $1",
      ["203.0.113.7"],
    );
    expect(Number(row.tokens)).toBeGreaterThanOrEqual(0);
  });

  it("keeps separate IPs on separate budgets", async () => {
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    await setTokens("203.0.113.7", 0, 60, 0);
    expect(
      (await rateLimit.acquireVisitorToken(visitorSql, "198.51.100.1")).allowed,
    ).toBe(true);
    expect(
      (await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7")).allowed,
    ).toBe(false);
  });

  it("refills over elapsed time, with no scheduled job", async () => {
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    await setTokens("203.0.113.7", 0, 60, 10);
    expect(
      (await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7")).allowed,
    ).toBe(false);
    await visitorSql(
      "UPDATE visitor_fetch_state SET last_refill = now() - interval '1 second' WHERE ip = $1",
      ["203.0.113.7"],
    );
    expect(
      (await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7")).allowed,
    ).toBe(true);
  });

  it("never refills past capacity", async () => {
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    await setTokens("203.0.113.7", 0, 60, 10);
    await visitorSql(
      "UPDATE visitor_fetch_state SET last_refill = now() - interval '1 hour' WHERE ip = $1",
      ["203.0.113.7"],
    );
    await rateLimit.acquireVisitorToken(visitorSql, "203.0.113.7");
    const [row] = await visitorSql(
      "SELECT tokens, capacity FROM visitor_fetch_state WHERE ip = $1",
      ["203.0.113.7"],
    );
    expect(Number(row.tokens)).toBeLessThanOrEqual(Number(row.capacity));
  });
});
