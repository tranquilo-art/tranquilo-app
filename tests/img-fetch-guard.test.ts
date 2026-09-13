// The guards between a cache miss and an origin fetch. These are unit
// tests with a fake sql client -- they prove the logic (what each function
// does with a given database answer, and that failure paths fail toward
// shedding), not atomicity. "Two concurrent callers never both spend the
// last token" is a property of the Postgres statement, proved separately:
// img-guard-atomicity.test.ts runs the same statements against real
// Postgres via PGlite (serially, so it proves correctness given prior
// state), and scripts/verify_fetch_guard.mts exercises genuinely parallel
// transactions through the real driver.
import { describe, expect, it } from "vitest";
import * as guard from "../lib/img-fetch-guard.ts";

// Records every call, returns queued results in order.
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

describe("claimFetch -- single-flight", () => {
  it("wins the claim when the insert returns a row", async () => {
    const sql = fakeSql([[{ cache_key: "cleveland:1:display" }]]);
    expect(await guard.claimFetch(sql, "cleveland:1:display")).toBe(true);
  });

  it("loses when another caller holds a live claim", async () => {
    // ON CONFLICT ... WHERE expires_at < now() matches nothing while a live
    // claim exists, so RETURNING comes back empty -- the stampede prevention.
    const sql = fakeSql([[]]);
    expect(await guard.claimFetch(sql, "cleveland:1:display")).toBe(false);
  });

  it("does the whole decision in one statement, with no read-then-write", async () => {
    // A read-then-write would open a race window exactly wide enough for
    // the stampede it's meant to prevent.
    const sql = fakeSql([[{ cache_key: "k" }]]);
    await guard.claimFetch(sql, "k");
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toMatch(/ON CONFLICT/i);
    expect(sql.calls[0].text).toMatch(/expires_at < now\(\)/i);
  });

  it("sheds when the guard itself is unreachable", async () => {
    // Assuming nobody else is fetching would be the dangerous guess.
    expect(await guard.claimFetch(fakeSql([new Error("neon down")]), "k")).toBe(
      false,
    );
    expect(await guard.claimFetch(null, "k")).toBe(false);
  });

  it("release never throws, because expiry is the real guarantee", async () => {
    await expect(
      guard.releaseFetch(fakeSql([new Error("nope")]), "k"),
    ).resolves.toBeUndefined();
    await expect(guard.releaseFetch(null, "k")).resolves.toBeUndefined();
  });
});

describe("acquireFetchToken -- per-source budget and cooldown", () => {
  it("allows the fetch when a token was spent", async () => {
    const r = await guard.acquireFetchToken(
      fakeSql([[{ tokens: 12.5 }]]),
      "met",
    );
    expect(r.allowed).toBe(true);
    expect(r.tokens).toBe(12.5);
  });

  it("refills, checks cooldown and spends in a single atomic statement", async () => {
    const sql = fakeSql([[{ tokens: 1 }]]);
    await guard.acquireFetchToken(sql, "met");
    const text = sql.calls[0].text;
    expect(text).toMatch(/blocked_until IS NULL OR blocked_until <= now\(\)/i);
    expect(text).toMatch(/last_refill/);
    expect(text).toMatch(/LEAST\(capacity/i);
  });

  it("reports cooldown and exhaustion differently", async () => {
    // One is a source telling us to back off, the other is our own budget --
    // collapsing them would hide a 429.
    const future = new Date(Date.now() + 60000).toISOString();
    const cooled = await guard.acquireFetchToken(
      fakeSql([[], [{ blocked_until: future, tokens: 30 }]]),
      "commons",
    );
    expect(cooled).toMatchObject({ allowed: false, reason: "cooldown" });

    const spent = await guard.acquireFetchToken(
      fakeSql([[], [{ blocked_until: null, tokens: 0.2 }]]),
      "met",
    );
    expect(spent).toMatchObject({ allowed: false, reason: "no-tokens" });
  });

  it("reports a standing hold as held, ahead of any other reason", async () => {
    // The hold lives in hold_reason, not blocked_until (transient) or
    // tokens=0 (a two-second delay once refill is non-zero). Reporting a
    // held source as merely "no-tokens" would invite raising its budget
    // and quietly defeating the hold.
    const r = await guard.acquireFetchToken(
      fakeSql([
        [],
        [
          {
            blocked_until: null,
            tokens: 30,
            hold_reason: "Wikimedia rate-limit hold",
          },
        ],
      ]),
      "commons",
    );
    expect(r).toMatchObject({ allowed: false, reason: "held" });
    expect(r.hold).toContain("Wikimedia");
  });

  it("excludes held sources in the acquiring statement itself, not only in the report", async () => {
    const sql = fakeSql([[{ tokens: 1 }]]);
    await guard.acquireFetchToken(sql, "met");
    expect(sql.calls[0].text).toMatch(/hold_reason IS NULL/i);
  });

  it("flags an unknown source rather than silently denying it", async () => {
    // A source with no row is a configuration gap, not a busy source.
    const r = await guard.acquireFetchToken(fakeSql([[], []]), "getty");
    expect(r).toMatchObject({ allowed: false, reason: "unknown-source" });
  });

  it("denies when the database errors", async () => {
    const r = await guard.acquireFetchToken(
      fakeSql([new Error("boom")]),
      "met",
    );
    expect(r).toMatchObject({ allowed: false, reason: "error" });
  });
});

describe("parseRetryAfter", () => {
  it("accepts delta-seconds", () => {
    expect(guard.parseRetryAfter("120")).toBe(120);
    expect(guard.parseRetryAfter(" 45 ")).toBe(45);
    expect(guard.parseRetryAfter("0")).toBe(0);
  });

  it("accepts an HTTP date and converts it to a delay", () => {
    const inTwoMin = new Date(Date.now() + 120000).toUTCString();
    const secs = guard.parseRetryAfter(inTwoMin);
    expect(secs).toBeGreaterThan(100);
    expect(secs).toBeLessThanOrEqual(121);
  });

  it("treats a past date as zero rather than negative", () => {
    // A negative interval would move blocked_until into the past, silently
    // disabling the cooldown when it's needed.
    expect(
      guard.parseRetryAfter(new Date(Date.now() - 60000).toUTCString()),
    ).toBe(0);
  });

  it("falls back rather than returning nothing when the header is absent or junk", () => {
    // Assuming "no header means no cooldown" is how you get blocked twice.
    expect(guard.parseRetryAfter(undefined)).toBe(300);
    expect(guard.parseRetryAfter("")).toBe(300);
    expect(guard.parseRetryAfter("soon-ish")).toBe(300);
    expect(guard.parseRetryAfter("soon-ish", 60)).toBe(60);
  });

  it("clamps absurd values to a day", () => {
    expect(guard.parseRetryAfter("99999999")).toBe(86400);
  });
});

describe("bumpStat -- aggregate counters", () => {
  it("writes one aggregated row per day/source/tier, not a request log", async () => {
    // Anonymity is structural: counts only, nothing that could reconstruct
    // one visitor's browsing.
    const sql = fakeSql([[]]);
    await guard.bumpStat(sql, "met", "display", "hits");
    expect(sql.calls[0].text).toMatch(/INSERT INTO img_cache_stats/i);
    expect(sql.calls[0].text).toMatch(
      /ON CONFLICT \(day, source, tier\) DO UPDATE/i,
    );
    expect(sql.calls[0].params).toEqual(["met", "display"]);
  });

  it("refuses a field name outside the allowlist", async () => {
    // The column name is interpolated into SQL, so the allowlist is the
    // only thing standing between this and an injection.
    const sql = fakeSql([[]]);
    await guard.bumpStat(sql, "met", "display", "hits; DROP TABLE items--");
    expect(sql.calls).toHaveLength(0);
  });

  it("covers every field the schema defines", () => {
    expect(guard.STAT_FIELDS).toEqual([
      "hits",
      "misses",
      "origin_ok",
      "origin_429",
      "origin_error",
      "shed",
    ]);
  });

  it("never fails a request over a metric", async () => {
    await expect(
      guard.bumpStat(fakeSql([new Error("x")]), "met", "display", "hits"),
    ).resolves.toBeUndefined();
  });
});

describe("failure recording", () => {
  it("resets the failure streak on success and extends it on failure", async () => {
    const sql = fakeSql([[]]);
    await guard.recordOriginOutcome(sql, "met", 200, true);
    expect(sql.calls[0].text).toMatch(
      /CASE WHEN \$3 THEN 0 ELSE consecutive_failures \+ 1 END/i,
    );
    expect(sql.calls[0].params).toEqual(["met", 200, true]);
  });

  it("swallows its own errors -- health recording must not break the request", async () => {
    await expect(
      guard.recordOriginOutcome(fakeSql([new Error("x")]), "met", 500, false),
    ).resolves.toBeUndefined();
    await expect(
      guard.blockSource(fakeSql([new Error("x")]), "met", 300),
    ).resolves.toBeUndefined();
  });
});

describe("the per-host gate", () => {
  // Two tables answering two questions: source_fetch_state is policy (a
  // person's decision about a whole source); host_fetch_state is behaviour
  // (how one server responds now). Europeana is 26 institutions behind one
  // source key, so a source-level budget could let one institution's 429
  // pause all 26.
  const sqlOk = (rows: any) => {
    const fn: any = async () => rows;
    fn.query = fn;
    return fn;
  };
  const sqlThrows = () => {
    const fn: any = async () => {
      throw new Error("db down");
    };
    fn.query = fn;
    return fn;
  };

  it("spends a token and allows the fetch", async () => {
    const r = await guard.acquireHostToken(
      sqlOk([{ tokens: 4 }]),
      "media.jhn.ngo",
      "europeana",
    );
    expect(r).toMatchObject({ allowed: true, reason: "ok", tokens: 4 });
  });

  it("refuses while the host is cooling", async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    let call = 0;
    const sql: any = async () =>
      ++call === 1 ? [] : [{ blocked_until: soon, tokens: 0 }];
    sql.query = sql;
    const r = await guard.acquireHostToken(sql, "bvpb.mcu.es", "europeana");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("host-cooldown");
  });

  it("distinguishes an exhausted budget from a cooldown", async () => {
    // One is us being busy, the other is the server telling us to stop.
    let call = 0;
    const sql: any = async () =>
      ++call === 1 ? [] : [{ blocked_until: null, tokens: 0.4 }];
    sql.query = sql;
    const r = await guard.acquireHostToken(sql, "purl.pt", "europeana");
    expect(r.reason).toBe("host-no-tokens");
  });

  it("FAILS CLOSED on a database error", async () => {
    // A database we cannot read is not permission to fetch someone else's server.
    const r = await guard.acquireHostToken(sqlThrows(), "purl.pt", "europeana");
    expect(r).toMatchObject({ allowed: false, reason: "host-error" });
  });

  it("refuses when there is no host to key on", async () => {
    // An unparseable origin URL must not fall through to unlimited.
    const r = await guard.acquireHostToken(
      sqlOk([{ tokens: 5 }]),
      "",
      "europeana",
    );
    expect(r).toMatchObject({ allowed: false, reason: "no-host" });
  });

  it("creates the row on first sight rather than needing a seed", async () => {
    // Seeding would mean hand-maintaining a list of 26 institutions -- an
    // unlisted host would be either unlimited or unfetchable.
    let statement = "";
    const sql: any = async (q: string) => {
      statement = q;
      return [{ tokens: 5 }];
    };
    sql.query = sql;
    await guard.acquireHostToken(sql, "new-museum.example", "europeana");
    expect(statement).toMatch(/INSERT INTO host_fetch_state/);
    expect(statement).toMatch(/ON CONFLICT \(host\) DO UPDATE/);
  });

  it("blockHost never touches source_fetch_state", async () => {
    // A transient host cooldown must not affect the standing policy hold.
    let statement = "";
    const sql: any = async (q: string) => {
      statement = q;
      return [];
    };
    sql.query = sql;
    await guard.blockHost(sql, "bvpb.mcu.es", 300, "europeana");
    expect(statement).toMatch(/host_fetch_state/);
    expect(statement).not.toMatch(/source_fetch_state/);
    expect(statement).not.toMatch(/hold_reason/);
  });

  it("a success clears the host's failure streak", async () => {
    let statement = "";
    const sql: any = async (q: string) => {
      statement = q;
      return [];
    };
    sql.query = sql;
    await guard.recordHostOutcome(sql, "media.jhn.ngo", 200, true);
    expect(statement).toMatch(/consecutive_failures = CASE WHEN \$3 THEN 0/);
  });
});
