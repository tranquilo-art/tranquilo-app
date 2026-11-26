// Signed-in account endpoints behind one function, dispatched on ?area=.
// vercel.json rewrites /api/auth and /api/boards here; the handlers live in
// lib/auth-api.ts and lib/boards-api.ts.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import authHandler from "../lib/auth-api.ts";
import boardsHandler from "../lib/boards-api.ts";

const AREAS: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<void>
> = {
  auth: authHandler,
  boards: boardsHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const area = AREAS[String(req.query?.area ?? "")];
  if (!area) {
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 404;
    res.json({ error: "Not found" });
    return;
  }
  await area(req, res);
}
