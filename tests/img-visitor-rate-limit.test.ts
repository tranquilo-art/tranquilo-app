// Per-visitor-IP budget on /api/img and /api/og. See
// lib/img-visitor-rate-limit.ts and sql/035_visitor_rate_state.sql
// for why this exists.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

describe("rateLimitOrRespond", () => {
  beforeEach(() => {
    process.env.ITEMS_CURSOR_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.ITEMS_CURSOR_SECRET;
  });

  it("keys the bucket on a visitor hash, never the IP address", async () => {
    const sql = fakeSql([[{ tokens: 59 }]]);
    await rateLimit.rateLimitOrRespond(
      sql,
      { headers: { "x-forwarded-for": "203.0.113.7" } },
      fakeRes(),
    );
    const key = sql.calls[0].params[0];
    expect(key).toMatch(/^img:[0-9a-f]{16}$/);
    expect(JSON.stringify(sql.calls)).not.toContain("203.0.113.7");
  });

  it("skips the budget when no secret is configured to hash with", async () => {
    delete process.env.ITEMS_CURSOR_SECRET;
    const sql = fakeSql([[]]);
    const handled = await rateLimit.rateLimitOrRespond(
      sql,
      { headers: { "x-forwarded-for": "203.0.113.7" } },
      fakeRes(),
    );
    expect(handled).toBe(false);
    expect(sql.calls).toHaveLength(0);
  });

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
