// /api/boards end to end against real Postgres (PGlite).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, startSession } from "../lib/auth.ts";
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { makeSql } from "./helpers/pg.ts";

type Sql = {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  $close(): Promise<void>;
};

const db = vi.hoisted(() => ({ sql: null as unknown as Sql }));
vi.mock("../lib/db.ts", () => ({ getSql: () => db.sql }));
vi.mock("../lib/sentry.ts", () => ({
  Sentry: {},
  reportError: vi.fn(),
  reportProblem: vi.fn(),
}));

const { default: handler } = await import("../lib/boards-api.ts");

const FILES = [
  "001_items_schema.sql",
  "003_items_harmonization.sql",
  "004_items_rejected_state.sql",
  "005_items_search.sql",
  "006_items_region_alt.sql",
  "008_items_place_of_origin.sql",
  "017_items_shuffle_key.sql",
  "018_items_vocab.sql",
  "031_items_delisted_state.sql",
  "067_user_accounts.sql",
  "068_boards.sql",
];

const auth = TRANQUILO_CONFIG.auth as { enabled: boolean };
const boardsConfig = TRANQUILO_CONFIG.boards as {
  max_items_per_board: number;
};
const DEFAULT_MAX = boardsConfig.max_items_per_board;

interface Reply {
  statusCode: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let melCookie: string;
let otherCookie: string;

async function signedInCookie(email: string): Promise<string> {
  const rows = await db.sql.query(
    "INSERT INTO users (email) VALUES ($1) RETURNING id",
    [email],
  );
  const token = await startSession(db.sql, Number(rows[0].id));
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(async () => {
  db.sql = await makeSql(FILES);
  auth.enabled = true;
  boardsConfig.max_items_per_board = DEFAULT_MAX;
  for (const n of [1, 2, 3]) {
    await db.sql.query(
      "INSERT INTO items (id, source, native_id, category) VALUES ($1, 'met', $2, 'Painting')",
      [`met:${n}`, String(n)],
    );
  }
  melCookie = await signedInCookie("mel@example.org");
  otherCookie = await signedInCookie("other@example.org");
});

afterEach(async () => {
  await db.sql.$close();
});

async function call(
  method: string,
  action: string,
  body: unknown = {},
  cookie: string | null = melCookie,
): Promise<Reply> {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  await handler(
    {
      method,
      query: { action },
      body,
      headers: cookie ? { cookie } : {},
    } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res as Reply;
}

async function myBoardId(cookie = melCookie): Promise<number> {
  const reply = await call("GET", "list", {}, cookie);
  return (reply.body.boards as { id: number }[])[0].id;
}

describe("/api/boards", () => {
  it("is not found while auth is switched off", async () => {
    auth.enabled = false;
    expect((await call("GET", "list")).statusCode).toBe(404);
  });

  it("never lets a response be cached", async () => {
    expect((await call("GET", "list")).headers["cache-control"]).toBe(
      "no-store",
    );
  });

  it("requires a signed-in session", async () => {
    expect((await call("GET", "list", {}, null)).statusCode).toBe(401);
    expect(
      (await call("GET", "list", {}, `${SESSION_COOKIE}=forged`)).statusCode,
    ).toBe(401);
  });

  it("rejects an unknown action and a wrong method", async () => {
    expect((await call("GET", "explode")).statusCode).toBe(400);
    expect((await call("POST", "list")).statusCode).toBe(405);
    expect((await call("GET", "add")).statusCode).toBe(405);
  });

  it("lists the account's default board", async () => {
    const reply = await call("GET", "list");
    expect(reply.statusCode).toBe(200);
    expect(reply.body.boards).toEqual([
      { id: expect.any(Number), name: "Saved", itemIds: [] },
    ]);
  });

  it("asks a free account to upgrade for a second board", async () => {
    await call("GET", "list");
    const reply = await call("POST", "create", { name: "Blues" });
    expect(reply.statusCode).toBe(403);
    expect(reply.body.error).toBe("upgrade_required");
  });

  it("adds, lists and removes an item", async () => {
    const boardId = await myBoardId();
    expect(
      (await call("POST", "add", { boardId, itemId: "met:2" })).statusCode,
    ).toBe(200);
    let boards = (await call("GET", "list")).body.boards as {
      itemIds: string[];
    }[];
    expect(boards[0].itemIds).toEqual(["met:2"]);
    expect(
      (await call("POST", "remove", { boardId, itemId: "met:2" })).statusCode,
    ).toBe(200);
    boards = (await call("GET", "list")).body.boards as { itemIds: string[] }[];
    expect(boards[0].itemIds).toEqual([]);
  });

  it("answers 404 for an unknown item and for another account's board", async () => {
    const mine = await myBoardId();
    const theirs = await myBoardId(otherCookie);
    expect(
      (await call("POST", "add", { boardId: mine, itemId: "met:404" }))
        .statusCode,
    ).toBe(404);
    for (const [action, body] of [
      ["add", { boardId: theirs, itemId: "met:1" }],
      ["remove", { boardId: theirs, itemId: "met:1" }],
      ["rename", { boardId: theirs, name: "Mine" }],
      ["delete", { boardId: theirs }],
    ] as const) {
      expect((await call("POST", action, body)).statusCode).toBe(404);
    }
    expect((await call("GET", "list", {}, otherCookie)).body.boards).toEqual([
      { id: theirs, name: "Saved", itemIds: [] },
    ]);
  });

  it("answers 409 when a board is full", async () => {
    boardsConfig.max_items_per_board = 1;
    const boardId = await myBoardId();
    await call("POST", "add", { boardId, itemId: "met:1" });
    const reply = await call("POST", "add", { boardId, itemId: "met:2" });
    expect(reply.statusCode).toBe(409);
    expect(reply.body.error).toBe("board_full");
  });

  it.each([
    ["a missing board id", { itemId: "met:1" }],
    ["a non-numeric board id", { boardId: "1; DROP", itemId: "met:1" }],
    ["a negative board id", { boardId: -1, itemId: "met:1" }],
  ])("rejects %s", async (_name, body) => {
    expect((await call("POST", "add", body)).statusCode).toBe(400);
  });

  it("renames, and rejects an empty name", async () => {
    const boardId = await myBoardId();
    expect(
      (await call("POST", "rename", { boardId, name: "Blues" })).statusCode,
    ).toBe(200);
    expect(
      (await call("POST", "rename", { boardId, name: " " })).statusCode,
    ).toBe(400);
    const boards = (await call("GET", "list")).body.boards as {
      name: string;
    }[];
    expect(boards[0].name).toBe("Blues");
  });

  it("imports a local collection and hands back what it could not save", async () => {
    const reply = await call("POST", "import", {
      itemIds: ["met:1", "met:3", "12345", "met:404"],
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.body.added).toBe(2);
    expect((reply.body.skipped as string[]).sort()).toEqual([
      "12345",
      "met:404",
    ]);
  });

  it.each([
    ["not a list", { itemIds: "met:1" }],
    ["a list with a non-string", { itemIds: ["met:1", 2] }],
  ])("rejects an import that is %s", async (_name, body) => {
    expect((await call("POST", "import", body)).statusCode).toBe(400);
  });

  it("rejects an import far larger than a board can hold", async () => {
    boardsConfig.max_items_per_board = 2;
    const itemIds = Array.from({ length: 50 }, (_, i) => `met:${i}`);
    expect((await call("POST", "import", { itemIds })).statusCode).toBe(413);
  });
});
