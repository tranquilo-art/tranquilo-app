// The daily digest of visitors who ran past the /api/items budgets.
// Yesterday only: items_budget_events is day-granular, so a rolling window
// would report the same denial twice.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuerySql } from "../lib/img-store.ts";
import {
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
  { kind = "items", daysAgo = 1 } = {},
) =>
  sql.query(
    "INSERT INTO items_budget_events (day, visitor, kind, denied_requests, denied_cost, enforced) " +
      "VALUES (CURRENT_DATE - ($4)::int, $1, $2, $5, $3, true)",
    [
      visitor,
      kind,
      deniedCost,
      daysAgo,
      Math.max(1, Math.round(deniedCost / 60)),
    ],
  );

describe("items budget denials", () => {
  it("stays quiet when nobody was denied", async () => {
    expect(await checkItemsBudgetDenials(sql)).toEqual([]);
  });

  it("stays quiet for one visitor who briefly hit the limit", async () => {
    await denial("a", VISITOR_DENIED_COST_MIN - 1);
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
