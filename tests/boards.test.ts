// Boards: per-account saved-art collections, the free-plan board limit, and
// importing a browser's local collection. See lib/boards.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addItem,
  createBoard,
  deleteBoard,
  importItems,
  listBoards,
  removeItem,
  renameBoard,
} from "../lib/boards.ts";
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { makeSql } from "./helpers/pg.ts";

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

type Sql = {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  $close(): Promise<void>;
};

const boardsConfig = TRANQUILO_CONFIG.boards as {
  free_boards: number;
  max_items_per_board: number;
};
const DEFAULT_MAX = boardsConfig.max_items_per_board;

let sql: Sql;
let mel: number;
let other: number;

async function addUser(email: string): Promise<number> {
  const rows = await sql.query(
    "INSERT INTO users (email) VALUES ($1) RETURNING id",
    [email],
  );
  return Number(rows[0].id);
}

async function addArt(
  id: string,
  over: { review_status?: string; category?: string } = {},
) {
  const [source, native_id] = [
    id.slice(0, id.indexOf(":")),
    id.slice(id.indexOf(":") + 1),
  ];
  await sql.query(
    "INSERT INTO items (id, source, native_id, category, review_status) VALUES ($1, $2, $3, $4, $5)",
    [
      id,
      source,
      native_id,
      over.category ?? "Painting",
      over.review_status ?? "ok",
    ],
  );
}

beforeEach(async () => {
  sql = await makeSql(FILES);
  mel = await addUser("mel@example.org");
  other = await addUser("other@example.org");
  for (const id of ["met:1", "met:2", "met:3", "commons:File:A:B.jpg"]) {
    await addArt(id);
  }
  await addArt("met:rejected", { review_status: "rejected" });
  await addArt("met:delisted", { review_status: "delisted" });
  await addArt("met:photo", { category: "Photography" });
  boardsConfig.max_items_per_board = DEFAULT_MAX;
});

afterEach(async () => {
  await sql.$close();
});

async function defaultBoardId(userId: number): Promise<number> {
  return (await listBoards(sql, userId))[0].id;
}

describe("listBoards", () => {
  it("gives a new account exactly one default board", async () => {
    const first = await listBoards(sql, mel);
    const second = await listBoards(sql, mel);
    expect(first).toHaveLength(1);
    expect(second.map((b) => b.id)).toEqual(first.map((b) => b.id));
    expect(first[0].itemIds).toEqual([]);
  });

  it("shows only the account's own boards", async () => {
    await listBoards(sql, other);
    const mine = await listBoards(sql, mel);
    expect(mine).toHaveLength(1);
    const owners = await sql.query("SELECT DISTINCT user_id FROM boards");
    expect(owners).toHaveLength(2);
  });

  it("lists items in the order they were saved", async () => {
    const board = await defaultBoardId(mel);
    await addItem(sql, mel, board, "met:2");
    await addItem(sql, mel, board, "met:1");
    expect((await listBoards(sql, mel))[0].itemIds).toEqual(["met:2", "met:1"]);
  });

  it("stops listing a saved item once the feed hides it", async () => {
    const board = await defaultBoardId(mel);
    await addItem(sql, mel, board, "met:1");
    await addItem(sql, mel, board, "met:2");
    await sql.query(
      "UPDATE items SET review_status = 'delisted' WHERE id = 'met:1'",
    );
    expect((await listBoards(sql, mel))[0].itemIds).toEqual(["met:2"]);
  });
});

describe("createBoard", () => {
  it("refuses a board past the free plan's limit", async () => {
    await listBoards(sql, mel);
    const result = await createBoard(sql, mel, "Second");
    expect(result).toEqual({ ok: false, reason: "limit" });
    expect(await listBoards(sql, mel)).toHaveLength(boardsConfig.free_boards);
  });

  it("creates up to the limit when the limit allows more", async () => {
    boardsConfig.free_boards = 2;
    try {
      await listBoards(sql, mel);
      const result = await createBoard(sql, mel, "  Blues  ");
      expect(result.ok).toBe(true);
      const names = (await listBoards(sql, mel)).map((b) => b.name);
      expect(names).toContain("Blues");
    } finally {
      boardsConfig.free_boards = 1;
    }
  });

  it.each(["", "   ", "x".repeat(81)])("rejects the name %j", async (name) => {
    boardsConfig.free_boards = 2;
    try {
      expect(await createBoard(sql, mel, name)).toEqual({
        ok: false,
        reason: "invalid",
      });
    } finally {
      boardsConfig.free_boards = 1;
    }
  });
});

describe("ownership", () => {
  it("never lets one account touch another's board", async () => {
    const theirs = await defaultBoardId(other);
    await addItem(sql, other, theirs, "met:1");

    expect(await renameBoard(sql, mel, theirs, "Mine now")).toBe(false);
    expect(await addItem(sql, mel, theirs, "met:2")).toBe("not_found");
    expect(await removeItem(sql, mel, theirs, "met:1")).toBe(false);
    expect(await deleteBoard(sql, mel, theirs)).toBe(false);

    const [board] = await listBoards(sql, other);
    expect(board.id).toBe(theirs);
    expect(board.name).not.toBe("Mine now");
    expect(board.itemIds).toEqual(["met:1"]);
  });
});

describe("addItem / removeItem", () => {
  it("saves a live item once, however many times it is added", async () => {
    const board = await defaultBoardId(mel);
    expect(await addItem(sql, mel, board, "met:1")).toBe("ok");
    expect(await addItem(sql, mel, board, "met:1")).toBe("ok");
    expect((await listBoards(sql, mel))[0].itemIds).toEqual(["met:1"]);
  });

  it.each(["met:rejected", "met:delisted", "met:photo", "met:missing", "1"])(
    "refuses %s, which the feed would not show",
    async (itemId) => {
      const board = await defaultBoardId(mel);
      expect(await addItem(sql, mel, board, itemId)).toBe("not_found");
      expect((await listBoards(sql, mel))[0].itemIds).toEqual([]);
    },
  );

  it("refuses an item once the board is full", async () => {
    boardsConfig.max_items_per_board = 2;
    const board = await defaultBoardId(mel);
    await addItem(sql, mel, board, "met:1");
    await addItem(sql, mel, board, "met:2");
    expect(await addItem(sql, mel, board, "met:3")).toBe("full");
    expect(await addItem(sql, mel, board, "met:1")).toBe("ok");
  });

  it("removes a saved item", async () => {
    const board = await defaultBoardId(mel);
    await addItem(sql, mel, board, "met:1");
    expect(await removeItem(sql, mel, board, "met:1")).toBe(true);
    expect((await listBoards(sql, mel))[0].itemIds).toEqual([]);
  });
});

describe("renameBoard / deleteBoard", () => {
  it("renames with the same name rules as creating", async () => {
    const board = await defaultBoardId(mel);
    expect(await renameBoard(sql, mel, board, " Favourites ")).toBe(true);
    expect((await listBoards(sql, mel))[0].name).toBe("Favourites");
    expect(await renameBoard(sql, mel, board, "")).toBe(false);
  });

  it("deletes a board with its items, and a fresh default replaces the last one", async () => {
    const board = await defaultBoardId(mel);
    await addItem(sql, mel, board, "met:1");
    expect(await deleteBoard(sql, mel, board)).toBe(true);
    const after = await listBoards(sql, mel);
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(board);
    expect(after[0].itemIds).toEqual([]);
  });

  it("removes an account's boards when the account is deleted", async () => {
    await addItem(sql, mel, await defaultBoardId(mel), "met:1");
    await sql.query("DELETE FROM users WHERE id = $1", [mel]);
    expect(
      await sql.query("SELECT * FROM boards WHERE user_id = $1", [mel]),
    ).toEqual([]);
    expect(await sql.query("SELECT * FROM board_items")).toEqual([]);
  });
});

describe("importItems", () => {
  it("saves live items into the default board and hands back the rest", async () => {
    const result = await importItems(sql, mel, [
      "met:1",
      "commons:File:A:B.jpg",
      "met:1",
      "met:rejected",
      "met:photo",
      "12345",
      "met:missing",
    ]);
    expect(result.added).toBe(2);
    expect(result.skipped.sort()).toEqual(
      ["12345", "met:missing", "met:photo", "met:rejected"].sort(),
    );
    expect((await listBoards(sql, mel))[0].itemIds).toEqual([
      "met:1",
      "commons:File:A:B.jpg",
    ]);
  });

  it("is safe to repeat", async () => {
    await importItems(sql, mel, ["met:1", "met:2"]);
    const again = await importItems(sql, mel, ["met:1", "met:2"]);
    expect(again).toEqual({ added: 0, skipped: [] });
    expect((await listBoards(sql, mel))[0].itemIds).toHaveLength(2);
  });

  it("stops at the board's size limit and hands back the overflow", async () => {
    boardsConfig.max_items_per_board = 2;
    const result = await importItems(sql, mel, ["met:1", "met:2", "met:3"]);
    expect(result.added).toBe(2);
    expect(result.skipped).toEqual(["met:3"]);
  });
});
