// Per-visitor-IP budget on /api/items, charged by how many items a request
// asks for. See lib/items-rate-limit.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireItemsBudget,
  detailRateLimitOrRespond,
  itemsCost,
  itemsRateLimitOrRespond,
  recordBudgetDenial,
} from "../lib/items-rate-limit.ts";
import { makeSql } from "./helpers/pg.ts";

type Call = { text: string; params?: unknown[] };

function fakeSql(results: unknown[]) {
  const queue = results.slice();
  const calls: Call[] = [];
  const query = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return (next === undefined ? [] : next) as Record<string, unknown>[];
  };
  return { query, calls };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: unknown) {
      this.body = body;
    },
  };
}

const LIMITS = { capacity: 100, refill_per_sec: 0.5, enforce: true };
const req = { headers: { "x-forwarded-for": "203.0.113.7" } };

describe("itemsCost", () => {
  it("charges a page by the rows it asks for", () => {
    expect(itemsCost({ limit: 60 })).toBe(60);
  });

  it("charges a lookup by the ids it asks for", () => {
    expect(itemsCost({ lookup: true, requestedIds: ["a", "b", "c"] })).toBe(3);
  });

  it("charges an aggregate answer one token", () => {
    expect(itemsCost({ facets: true })).toBe(1);
    expect(itemsCost({ suggest: true })).toBe(1);
    expect(itemsCost({ counting: true })).toBe(1);
    expect(itemsCost({ correction: true })).toBe(1);
  });
});

describe("acquireItemsBudget", () => {
  it("spends the cost and allows the request", async () => {
    const sql = fakeSql([[{ tokens: 40 }]]);
    const verdict = await acquireItemsBudget(sql, "visitor1", 60, LIMITS);
    expect(verdict).toMatchObject({ allowed: true, tokens: 40 });
    expect(sql.calls[0].params).toEqual(["items:visitor1", 60, 100, 0.5]);
  });

  it("keeps its own bucket, apart from the image budget", async () => {
    const sql = fakeSql([[{ tokens: 1 }]]);
    await acquireItemsBudget(sql, "visitor1", 1, LIMITS);
    expect(sql.calls[0].params?.[0]).not.toBe("visitor1");
  });

  it("denies when the bucket cannot cover the cost", async () => {
    const verdict = await acquireItemsBudget(
      fakeSql([[]]),
      "visitor1",
      60,
      LIMITS,
    );
    expect(verdict).toMatchObject({ allowed: false, reason: "rate-limited" });
  });

  it("never charges more than the bucket can hold", async () => {
    const sql = fakeSql([[{ tokens: 0 }]]);
    await acquireItemsBudget(sql, "visitor1", 5000, LIMITS);
    expect(sql.calls[0].params?.[1]).toBe(100);
  });

  it("fails open when the database errors", async () => {
    const verdict = await acquireItemsBudget(
      fakeSql([new Error("down")]),
      "visitor1",
      60,
      LIMITS,
    );
    expect(verdict.allowed).toBe(true);
  });

  it("allows a request whose visitor cannot be identified", async () => {
    const verdict = await acquireItemsBudget(fakeSql([]), null, 60, LIMITS);
    expect(verdict.allowed).toBe(true);
  });
});

describe("itemsRateLimitOrRespond", () => {
  beforeEach(() => {
    process.env.ITEMS_CURSOR_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.ITEMS_CURSOR_SECRET;
  });

  it("sends 429 with Retry-After when denied and enforcing", async () => {
    const res = fakeRes();
    const sent = await itemsRateLimitOrRespond(
      fakeSql([[]]),
      req,
      res,
      60,
      LIMITS,
    );
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("lets the request through when denied but not enforcing", async () => {
    const res = fakeRes();
    const sent = await itemsRateLimitOrRespond(fakeSql([[]]), req, res, 60, {
      ...LIMITS,
      enforce: false,
    });
    expect(sent).toBe(false);
    expect(res.statusCode).toBe(200);
  });

  it("stores no IP address, in the bucket or the denial record", async () => {
    const sql = fakeSql([[]]);
    await itemsRateLimitOrRespond(sql, req, fakeRes(), 60, LIMITS);
    expect(sql.calls).toHaveLength(2);
    expect(JSON.stringify(sql.calls)).not.toContain("203.0.113.7");
  });

  it("skips the budget when no secret is configured to hash with", async () => {
    delete process.env.ITEMS_CURSOR_SECRET;
    const sql = fakeSql([[]]);
    const sent = await itemsRateLimitOrRespond(sql, req, fakeRes(), 60, LIMITS);
    expect(sent).toBe(false);
    expect(sql.calls).toHaveLength(0);
  });

  it("lets an allowed request through", async () => {
    const res = fakeRes();
    const sent = await itemsRateLimitOrRespond(
      fakeSql([[{ tokens: 10 }]]),
      req,
      res,
      60,
      LIMITS,
    );
    expect(sent).toBe(false);
    expect(res.statusCode).toBe(200);
  });
});

describe("detailRateLimitOrRespond", () => {
  beforeEach(() => {
    process.env.ITEMS_CURSOR_SECRET = "test-secret";
  });
  afterEach(() => {
    delete process.env.ITEMS_CURSOR_SECRET;
  });

  it("charges one token against its own bucket", async () => {
    const sql = fakeSql([[{ tokens: 99 }]]);
    const sent = await detailRateLimitOrRespond(sql, req, fakeRes(), LIMITS);
    expect(sent).toBe(false);
    expect(sql.calls[0].params?.[0]).toMatch(/^detail:[0-9a-f]{16}$/);
    expect(sql.calls[0].params?.[1]).toBe(1);
  });

  it("records a denial under the detail kind", async () => {
    const sql = fakeSql([[]]);
    await detailRateLimitOrRespond(sql, req, fakeRes(), LIMITS);
    expect(sql.calls[1].params?.[1]).toBe("detail");
    expect(JSON.stringify(sql.calls)).not.toContain("203.0.113.7");
  });

  it("sends 429 when denied and enforcing", async () => {
    const res = fakeRes();
    const sent = await detailRateLimitOrRespond(
      fakeSql([[]]),
      req,
      res,
      LIMITS,
    );
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(429);
  });

  it("lets a denied request through while not enforcing", async () => {
    const sent = await detailRateLimitOrRespond(fakeSql([[]]), req, fakeRes(), {
      ...LIMITS,
      enforce: false,
    });
    expect(sent).toBe(false);
  });

  it("skips the budget when no secret is configured", async () => {
    delete process.env.ITEMS_CURSOR_SECRET;
    const sql = fakeSql([]);
    await detailRateLimitOrRespond(sql, req, fakeRes(), LIMITS);
    expect(sql.calls).toHaveLength(0);
  });
});

describe("against a real database", () => {
  const files = [
    "035_visitor_rate_state.sql",
    "060_visitor_budget_events.sql",
    "065_visitor_spent.sql",
  ];

  it("counts denials per visitor and day, and keeps them apart by budget", async () => {
    const sql = await makeSql(files);
    await recordBudgetDenial(sql, "abc", "items", 60, false);
    await recordBudgetDenial(sql, "abc", "items", 40, true);
    await recordBudgetDenial(sql, "abc", "detail", 1, true);
    const rows = await sql.query(
      "SELECT kind, denied_requests, denied_cost, enforced FROM items_budget_events ORDER BY kind",
    );
    expect(rows).toEqual([
      { kind: "detail", denied_requests: 1, denied_cost: 1, enforced: true },
      { kind: "items", denied_requests: 2, denied_cost: 100, enforced: true },
    ]);
    await sql.$close();
  });

  it("denies once the bucket is spent and admits again after it refills", async () => {
    const sql = await makeSql(files);
    const first = await acquireItemsBudget(sql, "abc", 80, LIMITS);
    const second = await acquireItemsBudget(sql, "abc", 80, LIMITS);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    await sql.query(
      "UPDATE visitor_fetch_state SET last_refill = now() - interval '10 minutes'",
    );
    expect((await acquireItemsBudget(sql, "abc", 80, LIMITS)).allowed).toBe(
      true,
    );
    await sql.$close();
  });

  it("totals what a visitor was served, and not what was refused", async () => {
    const sql = await makeSql(files);
    await acquireItemsBudget(sql, "abc", 60, LIMITS);
    await acquireItemsBudget(sql, "abc", 30, LIMITS);
    const refused = await acquireItemsBudget(sql, "abc", 60, LIMITS);
    expect(refused.allowed).toBe(false);
    const [row] = (await sql.query(
      "SELECT spent FROM visitor_fetch_state WHERE ip = 'items:abc'",
    )) as { spent: string | number }[];
    expect(Number(row.spent)).toBe(90);
    await sql.$close();
  });
});
