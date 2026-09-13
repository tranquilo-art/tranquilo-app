/* Records WHY each shed happened, so the count means something.
 * `img_cache_stats.shed` is one integer covering both healthy admission
 * declines (~20% of requests) and a tripped circuit breaker (silent total
 * failure) -- noise by construction, so a shed-rate alert can't be built
 * on it directly.
 *
 * `shed` is bumped at three of the four shed paths; the fourth (a failed
 * origin fetch) counts origin_429/origin_error instead, disjoint on
 * purpose. So img_shed_stats is the complete picture, and the invariant
 * against the old counter is a sum over non-origin reasons, not a total --
 * pinned below since "the new table should equal the old column" is a
 * plausible-but-wrong assumption that survives review.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as alerts from "../lib/img-cache-alerts.ts";
import * as guard from "../lib/img-fetch-guard.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: any;
beforeEach(async () => {
  sql = await makeSql(["010_img_fetch_state.sql", "013_img_shed_stats.sql"]);
});
afterEach(async () => {
  if (sql) await sql.$close();
});

describe("normalizeShedReason -- the key must be bounded", () => {
  it("collapses not-admitted-N, whatever N is", () => {
    // shedToVisitor emits "not-admitted-" + verdict.requests, an unbounded
    // string that would otherwise make row count grow with request counts.
    expect(guard.normalizeShedReason("not-admitted-1")).toBe("not-admitted");
    expect(guard.normalizeShedReason("not-admitted-17")).toBe("not-admitted");
    expect(guard.normalizeShedReason("not-admitted-999")).toBe("not-admitted");
  });

  it("passes the known vocabulary through untouched", () => {
    for (const r of [
      "held",
      "in-flight",
      "origin-429",
      "origin-error",
      "host-cooldown",
      "host-no-tokens",
      "no-db",
      "origin-handoff",
    ]) {
      expect(guard.normalizeShedReason(r)).toBe(r);
    }
  });

  it("folds anything unrecognised into 'other', so cardinality cannot blow up", () => {
    // A new reason string lands in `other` until added to the vocabulary --
    // a visible prompt, not silent schema growth.
    expect(guard.normalizeShedReason("something-new")).toBe("other");
    expect(guard.normalizeShedReason("")).toBe("other");
    expect(guard.normalizeShedReason(null)).toBe("other");
    expect(guard.normalizeShedReason("not-admitted-abc")).toBe("other");
  });
});

describe("bumpShedReason -- aggregate on write", () => {
  const rows = () =>
    sql.query("SELECT reason, n FROM img_shed_stats ORDER BY reason");

  it("aggregates repeated sheds into one row", async () => {
    for (let i = 0; i < 12; i++) {
      await guard.bumpShedReason(sql, "met", "display", "not-admitted-1");
    }
    const out = await rows();
    expect(out).toHaveLength(1);
    expect(Number(out[0].n)).toBe(12);
  });

  it("keeps different reasons apart", async () => {
    await guard.bumpShedReason(sql, "met", "display", "not-admitted-1");
    await guard.bumpShedReason(sql, "met", "display", "origin-429");
    const out = await rows();
    expect(out.map((r: any) => r.reason)).toEqual([
      "not-admitted",
      "origin-429",
    ]);
  });

  it("bounds row growth by key cardinality, never by request count", async () => {
    // Counts only, never a per-request log with timestamps that starts to
    // look like a browsing trail. 200 requests across 2 reasons must be 2 rows.
    for (let i = 0; i < 100; i++) {
      await guard.bumpShedReason(sql, "met", "display", `not-admitted-${i}`);
      await guard.bumpShedReason(sql, "met", "display", "in-flight");
    }
    const out = await rows();
    expect(out).toHaveLength(2);
    expect(out.reduce((a: number, r: any) => a + Number(r.n), 0)).toBe(200);
  });

  it("never throws, whatever the database does", async () => {
    const broken = async () => {
      throw new Error("db down");
    };
    await expect(
      guard.bumpShedReason(broken, "met", "display", "held"),
    ).resolves.toBeUndefined();
    await expect(
      guard.bumpShedReason(null, "met", "display", "held"),
    ).resolves.toBeUndefined();
  });
});

describe("the invariant against the old counter", () => {
  it("non-origin reasons sum to img_cache_stats.shed", async () => {
    // Not a total -- `shed` is bumped only on the three pre-fetch paths.
    for (const r of ["not-admitted-1", "in-flight", "held"]) {
      await guard.bumpShedReason(sql, "met", "display", r);
      await guard.bumpStat(sql, "met", "display", "shed");
    }
    await guard.bumpShedReason(sql, "met", "display", "origin-429"); // no shed bump
    await guard.bumpStat(sql, "met", "display", "origin_429");

    const [old] = await sql.query(
      "SELECT shed FROM img_cache_stats WHERE source='met'",
    );
    const [pre] = await sql.query(
      "SELECT COALESCE(SUM(n), 0)::int AS n FROM img_shed_stats " +
        "WHERE reason NOT IN ('origin-429', 'origin-error')",
    );
    expect(Number(pre.n)).toBe(Number(old.shed));

    const [all] = await sql.query(
      "SELECT SUM(n)::int AS n FROM img_shed_stats",
    );
    expect(Number(all.n)).toBeGreaterThan(Number(old.shed)); // the complete picture is larger
  });
});

describe("the alert this unlocks", () => {
  const shed = (source: string, reason: string, n: number, daysAgo: number) =>
    sql.query(
      "INSERT INTO img_shed_stats (day, source, tier, reason, n) " +
        "VALUES (CURRENT_DATE - ($4)::int, $1, 'display', $2, $3) " +
        "ON CONFLICT (day, source, tier, reason) DO UPDATE SET n = img_shed_stats.n + $3",
      [source, reason, n, daysAgo || 0],
    );

  it("stays quiet when shedding is all admission control", async () => {
    // The normal state -- an alert that fires here is an alert nobody reads.
    await shed("met", "not-admitted", 500, 1);
    expect(await alerts.checkShedReasons(sql)).toEqual([]);
  });

  it("reports sustained shedding for a reason that is NOT admission control", async () => {
    // The signal the raw rate could never give.
    await shed("europeana", "host-no-tokens", 300, 1);
    const out = await alerts.checkShedReasons(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/europeana/);
    expect(out[0]).toMatch(/host-no-tokens/);
  });

  it("ignores a handful, so ordinary noise does not page anyone", async () => {
    await shed("met", "in-flight", 3, 1);
    expect(await alerts.checkShedReasons(sql)).toEqual([]);
  });

  it("reads the last complete day, so nothing is reported twice", async () => {
    await shed("europeana", "host-no-tokens", 300, 1); // yesterday
    await shed("europeana", "host-no-tokens", 900, 0); // today, incomplete
    const out = await alerts.checkShedReasons(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/300/);
  });

  it("never throws when the database is unreachable", async () => {
    const broken = async () => {
      throw new Error("db down");
    };
    expect(await alerts.checkShedReasons(broken)).toEqual([]);
  });
});
