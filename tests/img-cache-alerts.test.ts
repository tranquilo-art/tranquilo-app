/* The silent-degradation conditions, and which of them are real. Built:
 * token bucket permanently empty (unambiguous -- that source's cache can
 * never fill, with no error anywhere), eviction thrash (repeatedly
 * requested, never held), and any 429 as a daily safety-net digest behind
 * the real-time inline alert.
 *
 * Not built: cache hit-rate collapse, since the proxy's hit response is a
 * cached 302 that never re-enters the function after the first request
 * per CDN edge, so hits/(hits+misses) is precisely the ratio bumpStat's
 * own header says not to quote. Also not built: sustained shed rate,
 * since shedding is normal (84 of 93 objects seen were one-offs shed by
 * design, ~20% of requests) and `shed` has no reason granularity to
 * distinguish "working correctly" from "back to hotlinking" -- alerting
 * on the causes (the three built above) is the honest interim.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as alerts from "../lib/img-cache-alerts.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: any;
beforeEach(async () => {
  sql = await makeSql([
    "010_img_fetch_state.sql",
    "011_img_cache_entries.sql",
    "025_img_cache_native_id.sql",
    "009_blob_usage_tracker_schema.sql",
    "032_blob_suspension_state.sql",
  ]);
});
afterEach(async () => {
  if (sql) await sql.$close();
});

const stat = (source: string, tier: string, cols: any) =>
  sql.query(
    "INSERT INTO img_cache_stats (day, source, tier, hits, misses, shed, origin_429) " +
      "VALUES (CURRENT_DATE - ($7)::int, $1, $2, $3, $4, $5, $6)",
    [
      source,
      tier,
      cols.hits || 0,
      cols.misses || 0,
      cols.shed || 0,
      cols.r429 || 0,
      cols.daysAgo || 0,
    ],
  );

describe("token bucket exhaustion", () => {
  it("stays quiet when every bucket is healthy", async () => {
    expect(await alerts.checkTokenBuckets(sql)).toEqual([]);
  });

  it("reports a source whose bucket is empty while it is being asked for", async () => {
    await sql.query(
      "UPDATE source_fetch_state SET tokens = 0 WHERE source = 'met'",
    );
    await stat("met", "display", { misses: 40, shed: 40 });
    const out = await alerts.checkTokenBuckets(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/met/);
  });

  it("does NOT report an empty bucket nobody is asking for", async () => {
    // An idle source sitting at zero is nobody requesting it, not a problem.
    await sql.query(
      "UPDATE source_fetch_state SET tokens = 0 WHERE source = 'met'",
    );
    expect(await alerts.checkTokenBuckets(sql)).toEqual([]);
  });

  it("does NOT report a held source", async () => {
    // commons has zero effective budget by design while the hold stands.
    await sql.query(
      "UPDATE source_fetch_state SET tokens = 0 WHERE source = 'commons'",
    );
    await stat("commons", "display", { misses: 40, shed: 40 });
    expect(await alerts.checkTokenBuckets(sql)).toEqual([]);
  });

  it("does NOT report a source inside a Retry-After cooldown", async () => {
    await sql.query(
      "UPDATE source_fetch_state SET tokens = 0, " +
        "blocked_until = now() + interval '5 minutes' WHERE source = 'met'",
    );
    await stat("met", "display", { misses: 40, shed: 40 });
    expect(await alerts.checkTokenBuckets(sql)).toEqual([]);
  });
});

describe("eviction thrash", () => {
  const entry = (key: string, requests: number, bytes: number | null) =>
    sql.query(
      "INSERT INTO img_cache_entries (cache_key, source, tier, requests, bytes, first_seen, last_seen) " +
        "VALUES ($1, 'met', 'display', $2, $3, now(), now())",
      [key, requests, bytes],
    );

  it("stays quiet on a healthy cache", async () => {
    await entry("met:1:display", 5, 400);
    await entry("met:2:display", 1, null); // a normal unadmitted one-off
    expect(await alerts.checkEvictionThrash(sql)).toEqual([]);
  });

  it("reports keys asked for repeatedly that we still do not hold", async () => {
    // Either evicted and re-requested in a loop, or admitted and failing
    // to store -- either way, paying the origin cost while keeping nothing.
    for (let i = 0; i < 12; i++) await entry(`met:thrash${i}:display`, 6, null);
    const out = await alerts.checkEvictionThrash(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/12/);
  });

  it("does not count ordinary one-offs as thrash", async () => {
    // Most objects are seen once and correctly not stored; counting those
    // would fire this every single day.
    for (let i = 0; i < 50; i++) await entry(`met:once${i}:display`, 1, null);
    expect(await alerts.checkEvictionThrash(sql)).toEqual([]);
  });
});

describe("rate-limit digest", () => {
  it("stays quiet when no source was rate-limited", async () => {
    await stat("met", "display", { hits: 100 });
    expect(await alerts.checkRateLimits(sql)).toEqual([]);
  });

  it("reports a 429, because that is the failure this system exists for", async () => {
    // A safety-net digest for anything the real-time inline path missed,
    // e.g. a function that died before its alert flushed.
    await stat("europeana", "lightbox", { misses: 3, r429: 2, daysAgo: 1 });
    const out = await alerts.checkRateLimits(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/europeana/);
  });

  it("reports each day exactly once, never twice", async () => {
    // A rolling two-day window would report every 429 on the day it
    // happened and again the next morning.
    await stat("europeana", "lightbox", { r429: 2, daysAgo: 1 }); // yesterday
    await stat("europeana", "display", { r429: 5, daysAgo: 0 }); // today, not yet complete
    const out = await alerts.checkRateLimits(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/2 rate-limit/); // yesterday's count, not today's
  });
});

describe("every alert fails safe", () => {
  it("returns no alerts rather than throwing when the database is unreachable", async () => {
    const broken = async () => {
      throw new Error("connection refused");
    };
    expect(await alerts.checkTokenBuckets(broken)).toEqual([]);
    expect(await alerts.checkEvictionThrash(broken)).toEqual([]);
    expect(await alerts.checkRateLimits(broken)).toEqual([]);
  });
});
