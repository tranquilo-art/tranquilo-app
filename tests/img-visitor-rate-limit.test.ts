// Per-visitor-IP budget on /api/img and /api/og. See
// lib/img-visitor-rate-limit.ts and sql/035_visitor_rate_state.sql
// for why this exists.
import { describe, expect, it } from "vitest";
import * as rateLimit from "../lib/img-visitor-rate-limit.ts";

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

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: any) {
      this.body = body;
    },
  };
}

describe("acquireVisitorToken", () => {
  it("spends a token and allows the request", async () => {
    const r = await rateLimit.acquireVisitorToken(
      fakeSql([[{ tokens: 59 }]]),
      "203.0.113.7",
    );
    expect(r).toMatchObject({ allowed: true, reason: "ok", tokens: 59 });
  });

  it("denies once the bucket is empty", async () => {
    const r = await rateLimit.acquireVisitorToken(fakeSql([[]]), "203.0.113.7");
    expect(r).toMatchObject({
      allowed: false,
      reason: "rate-limited",
      tokens: 0,
    });
  });

  it("creates the row on first sight rather than needing a seed", async () => {
    let statement = "";
    const sql: any = async (q: string) => {
      statement = q;
      return [{ tokens: 60 }];
    };
    sql.query = sql;
    await rateLimit.acquireVisitorToken(sql, "203.0.113.7");
    expect(statement).toMatch(/INSERT INTO visitor_fetch_state/);
    expect(statement).toMatch(/ON CONFLICT \(ip\) DO UPDATE/);
  });

  it("FAILS OPEN on a database error -- the opposite of the origin-side guards", async () => {
    // This protects our own budget from a visitor, not a museum's server
    // from us; a database we can't reach is not a reason to 429 everyone.
    const r = await rateLimit.acquireVisitorToken(
      fakeSql([new Error("db down")]),
      "203.0.113.7",
    );
    expect(r).toMatchObject({ allowed: true, reason: "error" });
  });

  it("allows when there is no db or no ip to key on", async () => {
    expect(
      await rateLimit.acquireVisitorToken(null, "203.0.113.7"),
    ).toMatchObject({
      allowed: true,
      reason: "no-db-or-ip",
    });
    expect(
      await rateLimit.acquireVisitorToken(fakeSql([[{ tokens: 1 }]]), ""),
    ).toMatchObject({
      allowed: true,
      reason: "no-db-or-ip",
    });
  });
});

describe("clientIp", () => {
  it("reads the first address out of x-forwarded-for", () => {
    expect(
      rateLimit.clientIp({
        headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      }),
    ).toBe("203.0.113.7");
  });

  it("trims whitespace around the first address", () => {
    expect(
      rateLimit.clientIp({
        headers: { "x-forwarded-for": "  203.0.113.7 , 10.0.0.1" },
      }),
    ).toBe("203.0.113.7");
  });

  it("handles a header array as Node sometimes provides", () => {
    expect(
      rateLimit.clientIp({
        headers: { "x-forwarded-for": ["203.0.113.7", "10.0.0.1"] },
      }),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(
      rateLimit.clientIp({ headers: { "x-real-ip": "203.0.113.9" } }),
    ).toBe("203.0.113.9");
  });

  it("returns null rather than guessing when neither header is present", () => {
    expect(rateLimit.clientIp({ headers: {} })).toBe(null);
    expect(rateLimit.clientIp({})).toBe(null);
  });
});

describe("rateLimitOrRespond", () => {
  it("sends 429 with Retry-After and reports the response as already sent", async () => {
    const res = fakeRes();
    const handled = await rateLimit.rateLimitOrRespond(
      fakeSql([[]]),
      { headers: { "x-forwarded-for": "203.0.113.7" } },
      res,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeTruthy();
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toMatchObject({ error: "Too many requests" });
  });

  it("touches nothing on the response and lets the caller proceed when allowed", async () => {
    const res = fakeRes();
    const handled = await rateLimit.rateLimitOrRespond(
      fakeSql([[{ tokens: 59 }]]),
      { headers: { "x-forwarded-for": "203.0.113.7" } },
      res,
    );
    expect(handled).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
  });
});
