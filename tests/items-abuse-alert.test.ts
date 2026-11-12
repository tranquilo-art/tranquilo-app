// An email goes out while a visitor is crossing the line, not the next
// morning, so there is still a scrape to block. Each crossing alerts once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIREWALL_URL,
  VISITOR_ACTIVE_HOURS_MIN,
  VISITOR_ACTIVE_MIN_ITEMS,
  VISITOR_DAILY_ITEMS_MIN,
  VISITOR_DENIED_COST_MIN,
} from "../lib/items-abuse-alert.ts";
import { itemsRateLimitOrRespond } from "../lib/items-rate-limit.ts";
import { makeSql } from "./helpers/pg.ts";

type Sql = Awaited<ReturnType<typeof makeSql>>;

const ROOMY = { capacity: 1e9, refill_per_sec: 1e6, enforce: true };
const TIGHT = { capacity: 100, refill_per_sec: 0.0001, enforce: true };

function res() {
  return {
    statusCode: 200,
    setHeader() {},
    json() {},
  };
}
const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } });

let sql: Sql;
let fetchMock: ReturnType<typeof vi.fn>;

const emails = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("resend.com"));
const lastEmailText = () =>
  JSON.parse(emails().at(-1)?.[1].body as string).text as string;

beforeEach(async () => {
  vi.stubEnv("ITEMS_CURSOR_SECRET", "test-secret");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("OPS_ALERT_EMAIL", "ops@example.com");
  fetchMock = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  sql = await makeSql([
    "035_visitor_rate_state.sql",
    "060_visitor_budget_events.sql",
    "065_visitor_spent.sql",
  ]);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await sql.$close();
});

const read = (ip: string, cost: number, limits = ROOMY) =>
  itemsRateLimitOrRespond(sql, from(ip), res(), cost, limits);

describe("a visitor served a very large number of items", () => {
  it("is emailed once, at the moment the day's total passes the limit", async () => {
    const step = VISITOR_DAILY_ITEMS_MIN / 4;
    for (let i = 0; i < 3; i++) await read("203.0.113.1", step);
    expect(emails()).toHaveLength(0);
    await read("203.0.113.1", step);
    expect(emails()).toHaveLength(1);
    await read("203.0.113.1", step);
    await read("203.0.113.1", step);
    expect(emails()).toHaveLength(1);
  });

  it("says where to block, since the visitor key carries no address", async () => {
    await read("203.0.113.1", VISITOR_DAILY_ITEMS_MIN);
    const text = lastEmailText();
    expect(text).toContain(FIREWALL_URL);
    expect(text).toContain("/api/items");
    expect(text).toContain(String(VISITOR_DAILY_ITEMS_MIN));
  });

  it("stays quiet for ordinary browsing", async () => {
    for (let i = 0; i < 20; i++) await read("203.0.113.1", 120);
    expect(emails()).toHaveLength(0);
  });
});

describe("a visitor reading steadily across many hours", () => {
  async function visitorKeyFor(ip: string) {
    const { visitorKey } = await import("../lib/visitor-hash.ts");
    return visitorKey(ip, "test-secret") as string;
  }

  it("is emailed once reading has run long enough with real volume", async () => {
    const key = await visitorKeyFor("203.0.113.2");
    await sql.query(
      "INSERT INTO visitor_fetch_state (ip, tokens, capacity, refill_per_sec, last_refill, first_seen, updated_at, spent) " +
        "VALUES ($1, 1e9, 1e9, 1e6, now(), now() - make_interval(hours => $2::int), now(), $3::bigint)",
      [`items:${key}`, VISITOR_ACTIVE_HOURS_MIN, VISITOR_ACTIVE_MIN_ITEMS],
    );
    await read("203.0.113.2", 10);
    expect(emails()).toHaveLength(1);
    await read("203.0.113.2", 10);
    expect(emails()).toHaveLength(1);
  });

  it("ignores a long day with little reading", async () => {
    const key = await visitorKeyFor("203.0.113.2");
    await sql.query(
      "INSERT INTO visitor_fetch_state (ip, tokens, capacity, refill_per_sec, last_refill, first_seen, updated_at, spent) " +
        "VALUES ($1, 1e9, 1e9, 1e6, now(), now() - make_interval(hours => $2::int), now(), $3::bigint)",
      [`items:${key}`, VISITOR_ACTIVE_HOURS_MIN + 8, 200],
    );
    await read("203.0.113.2", 10);
    expect(emails()).toHaveLength(0);
  });

  it("ignores heavy reading in a short span", async () => {
    const key = await visitorKeyFor("203.0.113.2");
    await sql.query(
      "INSERT INTO visitor_fetch_state (ip, tokens, capacity, refill_per_sec, last_refill, first_seen, updated_at, spent) " +
        "VALUES ($1, 1e9, 1e9, 1e6, now(), now() - make_interval(hours => 1), now(), $2::bigint)",
      [`items:${key}`, VISITOR_ACTIVE_MIN_ITEMS],
    );
    await read("203.0.113.2", 10);
    expect(emails()).toHaveLength(0);
  });
});

describe("a visitor kept hammering after being refused", () => {
  it("is emailed once, as refusals add up to the limit", async () => {
    await read("203.0.113.3", 60, TIGHT);
    const refusals = Math.ceil(VISITOR_DENIED_COST_MIN / 60);
    for (let i = 0; i < refusals - 1; i++) await read("203.0.113.3", 60, TIGHT);
    expect(emails()).toHaveLength(0);
    await read("203.0.113.3", 60, TIGHT);
    expect(emails()).toHaveLength(1);
    for (let i = 0; i < 10; i++) await read("203.0.113.3", 60, TIGHT);
    expect(emails()).toHaveLength(1);
  });
});

describe("limits on the alerts themselves", () => {
  it("caps emails per hour when many visitors cross at once", async () => {
    for (let i = 0; i < 8; i++) {
      await read(`198.51.100.${i}`, VISITOR_DAILY_ITEMS_MIN);
    }
    expect(emails().length).toBeGreaterThan(0);
    expect(emails().length).toBeLessThanOrEqual(3);
  });

  it("never fails or delays the request when the email cannot be sent", async () => {
    fetchMock.mockRejectedValue(new Error("resend down"));
    const limited = await read("203.0.113.4", VISITOR_DAILY_ITEMS_MIN);
    expect(limited).toBe(false);
  });

  it("sends nothing when no recipient is configured", async () => {
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    vi.stubEnv("SUBMIT_NOTIFY_EMAIL", "");
    await read("203.0.113.5", VISITOR_DAILY_ITEMS_MIN);
    expect(emails()).toHaveLength(0);
  });
});
