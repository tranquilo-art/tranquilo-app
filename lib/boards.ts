// Saved-art boards for signed-in accounts. See sql/068_boards.sql.
//
// Every query is scoped by user_id, so a board id from another account
// behaves exactly like one that does not exist. Only items the feed would
// show can be saved or listed. boardLimit() is the one place a paid plan
// changes how many boards an account may have.

import { TRANQUILO_CONFIG } from "./config.generated.ts";
import type { QuerySql } from "./img-store.ts";
import { LIVE_ITEMS_WHERE } from "./items-sql.ts";

const DEFAULT_BOARD_NAME = "Saved";
const LIVE_ITEMS = `(SELECT id FROM items ${LIVE_ITEMS_WHERE})`;
const MAX_NAME_LENGTH = 80;

export interface Board {
  id: number;
  name: string;
  itemIds: string[];
}

export type CreateResult =
  | { ok: true; board: Board }
  | { ok: false; reason: "limit" | "invalid" };

export type AddResult = "ok" | "not_found" | "full";

function boardsConfig() {
  return TRANQUILO_CONFIG.boards as {
    free_boards: number;
    max_items_per_board: number;
  };
}

export function boardLimit(_userId: number): number {
  return boardsConfig().free_boards;
}

export function cleanBoardName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}

const LIST_SQL =
  "SELECT b.id, b.name, " +
  "  COALESCE(array_agg(i.id ORDER BY bi.seq) FILTER (WHERE i.id IS NOT NULL), '{}') AS item_ids " +
  "FROM boards b " +
  "LEFT JOIN board_items bi ON bi.board_id = b.id " +
  `LEFT JOIN ${LIVE_ITEMS} i ON i.id = bi.item_id ` +
  "WHERE b.user_id = $1 GROUP BY b.id ORDER BY b.id";

const ENSURE_DEFAULT_SQL =
  "INSERT INTO boards (user_id, name) SELECT $1, $2 " +
  "WHERE NOT EXISTS (SELECT 1 FROM boards WHERE user_id = $1)";

export async function listBoards(
  sql: QuerySql,
  userId: number,
): Promise<Board[]> {
  await sql.query(ENSURE_DEFAULT_SQL, [userId, DEFAULT_BOARD_NAME]);
  const rows = (await sql.query(LIST_SQL, [userId])) as {
    id: string | number;
    name: string;
    item_ids: string[];
  }[];
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    itemIds: r.item_ids,
  }));
}

export async function createBoard(
  sql: QuerySql,
  userId: number,
  name: unknown,
): Promise<CreateResult> {
  const clean = cleanBoardName(name);
  if (!clean) return { ok: false, reason: "invalid" };
  const rows = (await sql.query(
    "INSERT INTO boards (user_id, name) SELECT $1, $2 " +
      "WHERE (SELECT count(*) FROM boards WHERE user_id = $1) < $3 " +
      "RETURNING id, name",
    [userId, clean, boardLimit(userId)],
  )) as { id: string | number; name: string }[];
  if (!rows.length) return { ok: false, reason: "limit" };
  return {
    ok: true,
    board: { id: Number(rows[0].id), name: rows[0].name, itemIds: [] },
  };
}

export async function renameBoard(
  sql: QuerySql,
  userId: number,
  boardId: number,
  name: unknown,
): Promise<boolean> {
  const clean = cleanBoardName(name);
  if (!clean) return false;
  const rows = (await sql.query(
    "UPDATE boards SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING id",
    [boardId, userId, clean],
  )) as unknown[];
  return rows.length > 0;
}

export async function deleteBoard(
  sql: QuerySql,
  userId: number,
  boardId: number,
): Promise<boolean> {
  const rows = (await sql.query(
    "DELETE FROM boards WHERE id = $1 AND user_id = $2 RETURNING id",
    [boardId, userId],
  )) as unknown[];
  return rows.length > 0;
}

const ADD_SQL =
  "INSERT INTO board_items (board_id, item_id) " +
  `SELECT b.id, i.id FROM boards b JOIN ${LIVE_ITEMS} i ON i.id = $3 ` +
  "WHERE b.id = $1 AND b.user_id = $2 " +
  "  AND (SELECT count(*) FROM board_items WHERE board_id = b.id) < $4 " +
  "ON CONFLICT (board_id, item_id) DO NOTHING RETURNING item_id";

const ADD_MISS_SQL =
  "SELECT " +
  "  EXISTS (SELECT 1 FROM board_items bi JOIN boards b ON b.id = bi.board_id " +
  "    WHERE b.id = $1 AND b.user_id = $2 AND bi.item_id = $3) AS saved, " +
  `  EXISTS (SELECT 1 FROM boards b JOIN ${LIVE_ITEMS} i ON i.id = $3 ` +
  "    WHERE b.id = $1 AND b.user_id = $2) AS addable";

export async function addItem(
  sql: QuerySql,
  userId: number,
  boardId: number,
  itemId: unknown,
): Promise<AddResult> {
  if (typeof itemId !== "string" || !itemId) return "not_found";
  const params = [boardId, userId, itemId];
  const rows = (await sql.query(ADD_SQL, [
    ...params,
    boardsConfig().max_items_per_board,
  ])) as unknown[];
  if (rows.length) return "ok";
  const [miss] = (await sql.query(ADD_MISS_SQL, params)) as {
    saved: boolean;
    addable: boolean;
  }[];
  if (miss.saved) return "ok";
  return miss.addable ? "full" : "not_found";
}

export async function removeItem(
  sql: QuerySql,
  userId: number,
  boardId: number,
  itemId: unknown,
): Promise<boolean> {
  if (typeof itemId !== "string") return false;
  const rows = (await sql.query(
    "DELETE FROM board_items bi USING boards b " +
      "WHERE bi.board_id = b.id AND b.id = $1 AND b.user_id = $2 AND bi.item_id = $3 " +
      "RETURNING bi.item_id",
    [boardId, userId, itemId],
  )) as unknown[];
  return rows.length > 0;
}

const IMPORT_SQL =
  "WITH input AS (" +
  "  SELECT item_id, min(ord) AS ord FROM unnest($3::text[]) WITH ORDINALITY AS t(item_id, ord) " +
  "  GROUP BY item_id" +
  "), fresh AS (" +
  "  SELECT input.item_id, input.ord FROM input " +
  `  JOIN ${LIVE_ITEMS} i ON i.id = input.item_id ` +
  "  WHERE NOT EXISTS (SELECT 1 FROM board_items WHERE board_id = $1 AND item_id = input.item_id)" +
  ") " +
  "INSERT INTO board_items (board_id, item_id) " +
  "SELECT b.id, fresh.item_id FROM fresh JOIN boards b ON b.id = $1 AND b.user_id = $2 " +
  "ORDER BY fresh.ord " +
  "LIMIT GREATEST(0, $4 - (SELECT count(*) FROM board_items WHERE board_id = $1)) " +
  "RETURNING item_id";

// Saves a browser's local collection into the account's first board. Returns
// the ids it did not save (unknown, hidden, or past the size limit), so the
// browser can keep those rather than lose them.
export async function importItems(
  sql: QuerySql,
  userId: number,
  itemIds: string[],
): Promise<{ added: number; skipped: string[] }> {
  const [board] = await listBoards(sql, userId);
  const wanted = [...new Set(itemIds.filter((id) => typeof id === "string"))];
  const inserted = (await sql.query(IMPORT_SQL, [
    board.id,
    userId,
    wanted,
    boardsConfig().max_items_per_board,
  ])) as unknown[];
  const saved = new Set((await listBoards(sql, userId))[0].itemIds);
  return {
    added: inserted.length,
    skipped: wanted.filter((id) => !saved.has(id)),
  };
}
