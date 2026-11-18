import { createHash, timingSafeEqual } from "node:crypto";
import type { CronRequest } from "./cron-types.ts";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function isCronAuthorized(req: CronRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers?.authorization;
  if (typeof header !== "string") return false;
  // Hashing equalises lengths so timingSafeEqual never throws.
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
