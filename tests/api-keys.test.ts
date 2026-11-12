// API keys: generation, hashing, bearer parsing, lookup, per-key budget and
// usage metering. See lib/api-keys.ts.
import { describe, expect, it } from "vitest";
import {
  authenticateKey,
  bearerToken,
  hashAccessToken,
  issueAccessToken,
  keyBudgetOrRespond,
  mintAccessToken,
  recordKeyUsage,
  revokeAccessToken,
} from "../lib/api-keys.ts";
import { makeSql } from "./helpers/pg.ts";

const FILES = [
  "035_visitor_rate_state.sql",
  "062_api_keys.sql",
  "065_visitor_spent.sql",
];

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

async function insertKey(
  sql: { query: (t: string, p?: unknown[]) => Promise<unknown[]> },
  key: string,
  tier = "community",
  status = "active",
) {
  const rows = (await sql.query(
    "INSERT INTO api_keys (key_hash, key_prefix, owner_email, tier, status) " +
      "VALUES ($1, $2, 'dev@example.org', $3, $4) RETURNING id",
    [hashAccessToken(key), key.slice(0, 12), tier, status],
  )) as { id: string | number }[];
  return Number(rows[0].id);
}

describe("mintAccessToken / hashAccessToken", () => {
  it("makes a prefixed, high-entropy, unique key", () => {
    const a = mintAccessToken();
    const b = mintAccessToken();
    expect(a).toMatch(/^tq_live_[0-9A-Za-z_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("hashes deterministically and never returns the key", () => {
    const key = mintAccessToken();
    expect(hashAccessToken(key)).toBe(hashAccessToken(key));
    expect(hashAccessToken(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAccessToken(key)).not.toContain(key);
  });
});

describe("bearerToken", () => {
  it("reads a Bearer header", () => {
    expect(bearerToken("Bearer tq_live_abc")).toBe("tq_live_abc");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["another scheme", "Basic abc"],
    ["no token", "Bearer "],
    ["an array of headers", ["Bearer a", "Bearer b"]],
  ])("rejects %s", (_name, header) => {
    expect(bearerToken(header as string | undefined)).toBeNull();
  });
});

describe("authenticateKey", () => {
  it("accepts an active key and returns its tier", async () => {
    const sql = await makeSql(FILES);
    const key = mintAccessToken();
    const id = await insertKey(sql, key, "partner");
    expect(await authenticateKey(sql, `Bearer ${key}`)).toEqual({
      keyId: id,
      tier: "partner",
    });
    await sql.$close();
  });

  it("stores only a hash, never the key", async () => {
    const sql = await makeSql(FILES);
    const key = mintAccessToken();
    await insertKey(sql, key);
    const rows = await sql.query("SELECT * FROM api_keys");
    expect(JSON.stringify(rows)).not.toContain(key);
    await sql.$close();
  });

  it("rejects an unknown key, a revoked key and a missing header alike", async () => {
    const sql = await makeSql(FILES);
    const revoked = mintAccessToken();
    await insertKey(sql, revoked, "community", "revoked");
    expect(
      await authenticateKey(sql, `Bearer ${mintAccessToken()}`),
    ).toBeNull();
    expect(await authenticateKey(sql, `Bearer ${revoked}`)).toBeNull();
    expect(await authenticateKey(sql, undefined)).toBeNull();
    await sql.$close();
  });

  it("lets a database error surface, so the caller can fail closed", async () => {
    const sql = {
      query: async () => {
        throw new Error("down");
      },
    };
    await expect(authenticateKey(sql, "Bearer tq_live_x")).rejects.toThrow(
      "down",
    );
  });
});

describe("keyBudgetOrRespond", () => {
  const LIMITS = { capacity: 100, refill_per_sec: 0.5 };

  it("charges the key's own bucket and lets the request through", async () => {
    const sql = await makeSql(FILES);
    const res = fakeRes();
    const sent = await keyBudgetOrRespond(sql, 7, res, 60, LIMITS);
    expect(sent).toBe(false);
    const rows = await sql.query("SELECT ip FROM visitor_fetch_state");
    expect(rows).toEqual([{ ip: "key:7" }]);
    await sql.$close();
  });

  it("answers 429 with Retry-After once the bucket is spent", async () => {
    const sql = await makeSql(FILES);
    await keyBudgetOrRespond(sql, 7, fakeRes(), 80, LIMITS);
    const res = fakeRes();
    const sent = await keyBudgetOrRespond(sql, 7, res, 80, LIMITS);
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    await sql.$close();
  });

  it("keeps one key's spending from affecting another's", async () => {
    const sql = await makeSql(FILES);
    await keyBudgetOrRespond(sql, 1, fakeRes(), 100, LIMITS);
    const sent = await keyBudgetOrRespond(sql, 2, fakeRes(), 100, LIMITS);
    expect(sent).toBe(false);
    await sql.$close();
  });

  it("fails closed with 503 when the database errors", async () => {
    const sql = {
      query: async () => {
        throw new Error("down");
      },
    };
    const res = fakeRes();
    const sent = await keyBudgetOrRespond(sql, 7, res, 1, LIMITS);
    expect(sent).toBe(true);
    expect(res.statusCode).toBe(503);
  });
});

describe("recordKeyUsage", () => {
  it("counts requests, rows and denials per key, day and shape", async () => {
    const sql = await makeSql(FILES);
    const id = await insertKey(sql, mintAccessToken());
    await recordKeyUsage(sql, id, "feed", 60, false);
    await recordKeyUsage(sql, id, "feed", 40, true);
    await recordKeyUsage(sql, id, "detail", 1, false);
    const rows = await sql.query(
      "SELECT shape, requests, rows_requested, denied FROM api_usage ORDER BY shape",
    );
    expect(rows).toEqual([
      { shape: "detail", requests: 1, rows_requested: 1, denied: 0 },
      { shape: "feed", requests: 2, rows_requested: 100, denied: 1 },
    ]);
    await sql.$close();
  });

  it("never fails the request when counting fails", async () => {
    const sql = {
      query: async () => {
        throw new Error("down");
      },
    };
    await expect(
      recordKeyUsage(sql, 1, "feed", 1, false),
    ).resolves.toBeUndefined();
  });

  it("keeps a key's usage rows after the key is revoked", async () => {
    const sql = await makeSql(FILES);
    const id = await insertKey(sql, mintAccessToken());
    await recordKeyUsage(sql, id, "feed", 1, false);
    await sql.query(
      "UPDATE api_keys SET status = 'revoked', revoked_at = now() WHERE id = $1",
      [id],
    );
    const rows = await sql.query("SELECT count(*)::int AS n FROM api_usage");
    expect(rows).toEqual([{ n: 1 }]);
    await sql.$close();
  });
});

describe("issueAccessToken / revokeAccessToken", () => {
  it("issues a key that authenticates, storing only its hash", async () => {
    const sql = await makeSql(FILES);
    const issued = await issueAccessToken(sql, {
      email: "dev@example.org",
      tier: "community",
      note: "first developer",
    });
    expect(issued.key).toMatch(/^tq_live_/);
    expect(await authenticateKey(sql, `Bearer ${issued.key}`)).toEqual({
      keyId: issued.id,
      tier: "community",
    });
    expect(
      JSON.stringify(await sql.query("SELECT * FROM api_keys")),
    ).not.toContain(issued.key);
    await sql.$close();
  });

  it("rejects a tier that does not exist", async () => {
    const sql = await makeSql(FILES);
    await expect(
      issueAccessToken(sql, {
        email: "dev@example.org",
        tier: "gold" as never,
      }),
    ).rejects.toThrow(/tier/);
    await sql.$close();
  });

  it("revokes by prefix, keeping the row and its usage", async () => {
    const sql = await makeSql(FILES);
    const issued = await issueAccessToken(sql, {
      email: "dev@example.org",
      tier: "partner",
    });
    await recordKeyUsage(sql, issued.id, "feed", 1, false);
    expect(await revokeAccessToken(sql, issued.prefix)).toBe(1);
    expect(await authenticateKey(sql, `Bearer ${issued.key}`)).toBeNull();
    const rows = await sql.query(
      "SELECT status, revoked_at IS NOT NULL AS stamped FROM api_keys",
    );
    expect(rows).toEqual([{ status: "revoked", stamped: true }]);
    expect(await sql.query("SELECT 1 FROM api_usage")).toHaveLength(1);
    await sql.$close();
  });

  it("reports zero when no active key has that prefix", async () => {
    const sql = await makeSql(FILES);
    expect(await revokeAccessToken(sql, "tq_live_nope")).toBe(0);
    await sql.$close();
  });
});
