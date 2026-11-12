// The keyed listing (/v1/items?shape=listing): a stable, partner-and-internal
// way to enumerate the catalogue and to follow what changed, one light row per
// item. Against real Postgres (PGlite), including the updated_at trigger, key
// authentication and the per-key quota.

import { readFileSync } from "node:fs";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { issueAccessToken, type KeyTier } from "../lib/api-keys.ts";
import { makeSql } from "./helpers/pg.ts";

const db = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("../lib/db.ts", () => ({ getSql: () => db.sql }));
vi.mock("../lib/sentry.ts", () => ({ Sentry: {}, reportError: vi.fn() }));

const { default: handler, buildQuery } = await import("../api/items.ts");

type Sql = Awaited<ReturnType<typeof makeSql>>;
let sql: Sql;
const keys = {} as Record<KeyTier, string>;

async function insert(
  id: string,
  updatedAt: string,
  status = "ok",
  category = "Painting",
) {
  const cut = id.indexOf(":");
  await sql.query(
    "INSERT INTO items (id, source, native_id, title, category, review_status, updated_at) VALUES ($1, $2, $3, 'Title', $4, $5, $6)",
    [id, id.slice(0, cut), id.slice(cut + 1), category, status, updatedAt],
  );
}

beforeAll(async () => {
  process.env.ITEMS_CURSOR_SECRET = "listing-test-secret";
  sql = await makeSql([
    "001_items_schema.sql",
    "003_items_harmonization.sql",
    "004_items_rejected_state.sql",
    "005_items_search.sql",
    "017_items_shuffle_key.sql",
    "037_items_visual_metadata.sql",
    "039_items_vibe_search.sql",
    "040_items_accent_color_status.sql",
    "042_items_source_verified_at.sql",
    "049_items_master_dims.sql",
    "035_visitor_rate_state.sql",
    "060_visitor_budget_events.sql",
    "061_visitor_state_hashed_keys.sql",
    "062_api_keys.sql",
    "065_visitor_spent.sql",
  ]);
  await sql.$db.exec(
    readFileSync(
      new URL("../sql/063_items_updated_at.sql", import.meta.url),
      "utf8",
    ),
  );
  // Two rows share a timestamp, to prove the id breaks the tie across a page.
  await insert("met:1", "2026-01-01T00:00:00.000001Z");
  await insert("met:2", "2026-01-02T00:00:00Z");
  await insert("cleveland:3", "2026-01-02T00:00:00Z");
  await insert("npm:U:15646", "2026-01-03T00:00:00Z");
  await insert("met:5", "2026-02-01T00:00:00Z");
  await insert("met:rejected", "2026-03-01T00:00:00Z", "rejected");
  await insert("met:held", "2026-03-02T00:00:00Z", "quarantined");
  await insert("met:photo", "2026-03-03T00:00:00Z", "ok", "Photography");
  for (const tier of ["community", "partner", "internal"] as const) {
    keys[tier] = (
      await issueAccessToken(sql, { email: `${tier}@example.org`, tier })
    ).key;
  }
  db.sql = sql;
});
afterAll(async () => {
  if (sql) await sql.$close();
});

interface ListingBody {
  items: { key: string; updated_at: string; removed?: true }[];
  next_cursor: string | null;
  error?: string;
}

async function call(
  query: Record<string, string>,
  token?: string,
  audience = "keyed",
) {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    setHeader(name: string, value: string) {
      res.headers[name] = value;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  await handler(
    {
      method: "GET",
      query: { shape: "listing", ...(audience ? { audience } : {}), ...query },
      headers: token ? { authorization: `Bearer ${token}` } : {},
    } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res as typeof res & { body: ListingBody };
}

async function walk(first: Record<string, string>, token = keys.partner) {
  const seen: ListingBody["items"] = [];
  let cursor: string | null | undefined;
  for (let pages = 0; pages < 20; pages++) {
    const res = await call(cursor ? { ...first, cursor } : first, token);
    expect(res.statusCode).toBe(200);
    seen.push(...res.body.items);
    cursor = res.body.next_cursor;
    if (!cursor) return seen;
  }
  throw new Error("listing did not end");
}

const LIVE = ["met:1", "cleveland:3", "met:2", "npm:U:15646", "met:5"];

describe("who may list", () => {
  it("answers 401 without a key", async () => {
    expect((await call({})).statusCode).toBe(401);
  });

  it("refuses a community key", async () => {
    const res = await call({}, keys.community);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toHaveProperty("items");
  });

  it.each(["partner", "internal"] as const)("serves a %s key", async (tier) => {
    const res = await call({}, keys[tier]);
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("is not served on the public endpoint, key or not", async () => {
    for (const token of [undefined, keys.internal]) {
      const res = await call({}, token, "");
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toHaveProperty("items");
    }
  });
});

describe("what a listing row is", () => {
  it("is a key and a change time, nothing else", async () => {
    const res = await call({}, keys.partner);
    for (const row of res.body.items) {
      expect(Object.keys(row).sort()).toEqual(["key", "updated_at"]);
    }
  });

  it("names the item the way ?keys= does, colons in native ids included", async () => {
    const res = await call({}, keys.partner);
    expect(res.body.items.map((r) => r.key)).toContain("npm:U:15646");
  });

  it("keeps the timestamp's microseconds so a cursor never repeats or skips", async () => {
    const res = await call({}, keys.partner);
    expect(res.body.items[0]).toEqual({
      key: "met:1",
      updated_at: "2026-01-01T00:00:00.000001Z",
    });
  });
});

describe("enumerating everything", () => {
  it("lists live items in a stable order and leaves out the rest", async () => {
    const seen = await walk({});
    expect(seen.map((r) => r.key)).toEqual(LIVE);
  });

  it("visits every item exactly once across pages, ties included", async () => {
    const seen = await walk({ limit: "2" });
    expect(seen.map((r) => r.key)).toEqual(LIVE);
  });

  it("ends with no cursor", async () => {
    const res = await call({}, keys.partner);
    expect(res.body.next_cursor).toBeNull();
  });

  it("never serves more than one lookup's worth per page", async () => {
    await sql.query(
      "INSERT INTO items (id, source, native_id, title, category, updated_at) " +
        "SELECT 'bulk:' || n, 'bulk', n::text, 'T', 'Painting', '2030-01-01T00:00:00Z' " +
        "FROM generate_series(1, 150) AS n",
    );
    try {
      const res = await call({ limit: "500" }, keys.partner);
      expect(res.body.items.length).toBe(100);
      expect(res.body.next_cursor).not.toBeNull();
    } finally {
      await sql.query("DELETE FROM items WHERE source = 'bulk'");
    }
  });
});

describe("following changes", () => {
  it("returns what changed from a time onward, oldest first", async () => {
    const res = await call(
      { updated_since: "2026-01-03T00:00:00Z" },
      keys.partner,
    );
    expect(res.body.items.map((r) => r.key)).toEqual([
      "npm:U:15646",
      "met:5",
      "met:rejected",
      "met:held",
      "met:photo",
    ]);
  });

  it("reports an item that left the catalogue as removed, with no reason", async () => {
    const res = await call(
      { updated_since: "2026-03-01T00:00:00Z" },
      keys.partner,
    );
    expect(res.body.items).toEqual([
      {
        key: "met:rejected",
        updated_at: "2026-03-01T00:00:00.000000Z",
        removed: true,
      },
      {
        key: "met:held",
        updated_at: "2026-03-02T00:00:00.000000Z",
        removed: true,
      },
      {
        key: "met:photo",
        updated_at: "2026-03-03T00:00:00.000000Z",
        removed: true,
      },
    ]);
  });

  it("keeps reporting removals on later pages", async () => {
    const seen = await walk({
      updated_since: "2026-02-01T00:00:00Z",
      limit: "2",
    });
    expect(seen.map((r) => r.key)).toEqual([
      "met:5",
      "met:rejected",
      "met:held",
      "met:photo",
    ]);
    expect(seen.filter((r) => r.removed).length).toBe(3);
  });

  it("includes an item the moment its content changes", async () => {
    const since = "2026-04-01T00:00:00Z";
    expect(
      (await call({ updated_since: since }, keys.partner)).body.items,
    ).toEqual([]);
    await sql.query("UPDATE items SET title = 'Retitled' WHERE id = 'met:2'");
    const res = await call({ updated_since: since }, keys.partner);
    expect(res.body.items.map((r) => r.key)).toEqual(["met:2"]);
  });

  it("does not include an item whose only change is pipeline bookkeeping", async () => {
    await sql.query("UPDATE items SET shuffle_key = 0.42 WHERE id = 'met:1'");
    const res = await call({}, keys.partner);
    expect(res.body.items[0]).toEqual({
      key: "met:1",
      updated_at: "2026-01-01T00:00:00.000001Z",
    });
  });
});

describe("bad requests", () => {
  it.each([
    ["an unparseable updated_since", { updated_since: "yesterday" }],
    [
      "an updated_since with no time zone",
      { updated_since: "2026-01-01T00:00:00" },
    ],
    ["a cursor nobody issued", { cursor: "not-a-cursor" }],
  ])("rejects %s", async (_label, query) => {
    const res = await call(query, keys.partner);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toHaveProperty("items");
  });

  it("rejects a cursor that was edited", async () => {
    const page = await call({ limit: "1" }, keys.partner);
    const cursor = page.body.next_cursor as string;
    const forged = `${cursor.slice(0, -2)}${cursor.endsWith("AA") ? "BB" : "AA"}`;
    expect((await call({ cursor: forged }, keys.partner)).statusCode).toBe(400);
  });
});

describe("the query plan", () => {
  // A page must be an index range scan in listing order. If the ORDER BY
  // resolves to the formatted output column instead of items.updated_at, the
  // planner has to read everything after the cursor and sort it, per page.
  async function plan(params: Record<string, string>) {
    const query = buildQuery({ shape: "listing", ...params });
    await sql.query("SET enable_seqscan = off");
    await sql.query("SET enable_bitmapscan = off");
    try {
      const rows = await sql.query(`EXPLAIN ${query.text}`, query.params);
      return rows
        .map((r: Record<string, string>) => r["QUERY PLAN"])
        .join("\n");
    } finally {
      await sql.query("RESET enable_seqscan");
      await sql.query("RESET enable_bitmapscan");
    }
  }

  it.each([
    ["a full enumeration", {}],
    ["a change feed", { updated_since: "2026-01-01T00:00:00Z" }],
  ])(
    "reads %s straight off the listing index, with no sort",
    async (_l, params) => {
      const text = await plan(params);
      expect(text).toContain("items_updated_at_idx");
      expect(text).not.toMatch(/\bSort\b/);
    },
  );
});

describe("quota and metering", () => {
  it("meters the call under its own shape, charged by the page size", async () => {
    await call({ limit: "3" }, keys.internal);
    const rows = await sql.query(
      "SELECT shape, requests, rows_requested FROM api_usage u JOIN api_keys k ON k.id = u.key_id WHERE k.tier = 'internal' AND shape = 'listing'",
    );
    expect(rows.length).toBe(1);
    expect(Number(rows[0].rows_requested)).toBeGreaterThanOrEqual(3);
  });
});
