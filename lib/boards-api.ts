// Saved-art boards for the signed-in account, dispatched on ?action=:
//   GET  list                     { boards: [{ id, name, itemIds }] }
//   POST create {name}            403 upgrade_required past the plan's limit
//   POST rename {boardId, name}
//   POST delete {boardId}
//   POST add    {boardId, itemId} 409 board_full past the size limit
//   POST remove {boardId, itemId}
//   POST import {itemIds}         { added, skipped } into the first board
//
// Another account's board answers 404, like one that does not exist.
// Answers 404 while [auth].enabled is false. See lib/boards.ts.
//
// Required env vars: DATABASE_URL.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authEnabled, resolveSession, sessionTokenFromCookie } from "./auth.ts";
import {
  addItem,
  cleanBoardName,
  createBoard,
  deleteBoard,
  importItems,
  listBoards,
  removeItem,
  renameBoard,
} from "./boards.ts";
import { TRANQUILO_CONFIG } from "./config.generated.ts";
import { getSql } from "./db.ts";
import { reportError } from "./sentry.ts";

const METHODS: Record<string, string> = {
  list: "GET",
  create: "POST",
  rename: "POST",
  delete: "POST",
  add: "POST",
  remove: "POST",
  import: "POST",
};

const NEEDS_BOARD = new Set(["rename", "delete", "add", "remove"]);

function reply(res: VercelResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.json(body);
}

function boardIdFrom(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

function importLimit(): number {
  return (
    (TRANQUILO_CONFIG.boards as { max_items_per_board: number })
      .max_items_per_board * 2
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!authEnabled()) return reply(res, 404, { error: "Not found" });

  const action = String(req.query?.action ?? "");
  const method = METHODS[action];
  if (!method) return reply(res, 400, { error: "Unknown action" });
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return reply(res, 405, { error: "Method not allowed" });
  }

  const sql = getSql();
  if (!sql) return reply(res, 503, { error: "Boards are unavailable" });
  const body = req.body || {};

  try {
    const user = await resolveSession(
      sql,
      sessionTokenFromCookie(req.headers?.cookie),
    );
    if (!user) return reply(res, 401, { error: "Sign in required" });
    const { userId } = user;

    if (action === "list") {
      return reply(res, 200, { boards: await listBoards(sql, userId) });
    }

    if (action === "create") {
      const result = await createBoard(sql, userId, body.name);
      if (result.ok) return reply(res, 201, { board: result.board });
      return result.reason === "limit"
        ? reply(res, 403, { error: "upgrade_required" })
        : reply(res, 400, { error: "Invalid name" });
    }

    if (action === "import") {
      const ids = body.itemIds;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
        return reply(res, 400, { error: "itemIds must be a list of ids" });
      }
      if (ids.length > importLimit()) {
        return reply(res, 413, { error: "Too many items" });
      }
      return reply(res, 200, await importItems(sql, userId, ids));
    }

    const boardId = NEEDS_BOARD.has(action) ? boardIdFrom(body.boardId) : null;
    if (boardId === null) return reply(res, 400, { error: "Invalid boardId" });

    let found: boolean;
    if (action === "rename") {
      if (!cleanBoardName(body.name)) {
        return reply(res, 400, { error: "Invalid name" });
      }
      found = await renameBoard(sql, userId, boardId, body.name);
    } else if (action === "delete") {
      found = await deleteBoard(sql, userId, boardId);
    } else if (action === "add") {
      const result = await addItem(sql, userId, boardId, body.itemId);
      if (result === "full") return reply(res, 409, { error: "board_full" });
      found = result === "ok";
    } else {
      found = await removeItem(sql, userId, boardId, body.itemId);
    }
    return found
      ? reply(res, 200, { ok: true })
      : reply(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("boards: unexpected error", err);
    await reportError(err);
    reply(res, 500, { error: "Unexpected server error" });
  }
}
