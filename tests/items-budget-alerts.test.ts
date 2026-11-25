// The daily digest of visitors who ran past the /api/items budgets.
// Yesterday only: items_budget_events is day-granular, so a rolling window
// would report the same denial twice.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuerySql } from "../lib/img-store.ts";
import {
  checkImageBudgetDenials,
  checkItemsBudgetDenials,
  VISITOR_DENIED_COST_MIN,
  VISITORS_DENIED_MIN,
} from "../lib/items-budget-alerts.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: Awaited<ReturnType<typeof makeSql>>;
beforeEach(async () => {
  sql = await makeSql([
    "035_visitor_rate_state.sql",
    "060_visitor_budget_events.sql",
    "065_visitor_spent.sql",
  ]);
});
afterEach(async () => {
  if (sql) await sql.$close();
});

const denial = (
  visitor: string,
  deniedCost: number,
  { kind = "items", daysAgo = 1, enforced = true } = {},
) =>
  sql.query(
    "INSERT INTO items_budget_events (day, visitor, kind, denied_requests, denied_cost, enforced) " +
      "VALUES (CURRENT_DATE - ($4)::int, $1, $2, $5, $3, $6)",
    [
      visitor,
      kind,
      deniedCost,
      daysAgo,
      Math.max(1, Math.round(deniedCost / 60)),
      enforced,
    ],
  );

describe("items budget denials", () => {
  it("stays quiet when nobody was denied", async () => {
    expect(await checkItemsBudgetDenials(sql)).toEqual([]);
  });

  it("reports one visitor who was refused, however briefly", async () => {
    await denial("a", 60);
    const lines = await checkItemsBudgetDenials(sql);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("items");
  });

  it("stays quiet about a denial that was only logged", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN - 1, { enforced: false });
    expect(await checkItemsBudgetDenials(sql)).toEqual([]);
  });

  it("ignores today and older days", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN * 10, { daysAgo: 0 });
    await denial("b", VISITOR_DENIED_COST_MIN * 10, { daysAgo: 2 });
    expect(await checkItemsBudgetDenials(sql)).toEqual([]);
  });

  it("flags a visitor who kept hammering after being refused", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN);
    const lines = await checkItemsBudgetDenials(sql);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("items");
    expect(lines[0]).toContain(String(VISITOR_DENIED_COST_MIN));
  });

  it("flags many visitors denied even when none is extreme", async () => {
    for (let i = 0; i < VISITORS_DENIED_MIN; i++) await denial(`v${i}`, 60);
    const lines = await checkItemsBudgetDenials(sql);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(String(VISITORS_DENIED_MIN));
  });

  it("reports each budget separately", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN, { kind: "items" });
    await denial("b", VISITOR_DENIED_COST_MIN, { kind: "detail" });
    const lines = await checkItemsBudgetDenials(sql);
    expect(lines).toHaveLength(2);
  });

  it("leaves image refusals to the image digest", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN, { kind: "img" });
    expect(await checkItemsBudgetDenials(sql)).toEqual([]);
  });

  it("says where to find the addresses, since the rows carry none", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN);
    const [line] = await checkItemsBudgetDenials(sql);
    expect(line).toMatch(/firewall/i);
  });

  it("reports nothing rather than throwing when the query fails", async () => {
    const broken = {
      query: async () => {
        throw new Error("db down");
      },
    };
    expect(
      await checkItemsBudgetDenials(broken as unknown as QuerySql),
    ).toEqual([]);
  });
});

describe("image budget denials", () => {
  it("stays quiet when no image was refused", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN, { kind: "items" });
    expect(await checkImageBudgetDenials(sql)).toEqual([]);
  });

  it("reports any visitor refused images yesterday", async () => {
    await denial("a", 3, { kind: "img" });
    await denial("b", 40, { kind: "img" });
    const lines = await checkImageBudgetDenials(sql);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/2 visitor/);
    expect(lines[0]).toContain("43");
  });

  it("ignores today and older days", async () => {
    await denial("a", 40, { kind: "img", daysAgo: 0 });
    await denial("b", 40, { kind: "img", daysAgo: 2 });
    expect(await checkImageBudgetDenials(sql)).toEqual([]);
  });

  it("says how to find who was refused, since the rows carry no address", async () => {
    await denial("a", 3, { kind: "img" });
    const [line] = await checkImageBudgetDenials(sql);
    expect(line).toMatch(/vercel metrics/);
  });

  it("reports nothing rather than throwing when the query fails", async () => {
    const broken = {
      query: async () => {
        throw new Error("db down");
      },
    };
    expect(
      await checkImageBudgetDenials(broken as unknown as QuerySql),
    ).toEqual([]);
  });
});
