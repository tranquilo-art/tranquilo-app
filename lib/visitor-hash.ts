// Daily keyed hash of the client IP, so no raw address is stored.

import { createHash, createHmac } from "node:crypto";

const KEY_LABEL = "visitor-hash-v1";
const UNKEYED_LABEL = "visitor-hash-v1-unkeyed";
const KEY_LENGTH = 16;

// Unkeyed fallback is brute-forceable; it only keeps limits active.
let warnedUnkeyed = false;

function failsSafeWithoutSecret(): boolean {
  return (
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.VERCEL_ENV === "production"
  );
}

export function visitorKey(
  ip: string | null,
  secret: string | undefined = process.env.ITEMS_CURSOR_SECRET,
  now: Date = new Date(),
): string | null {
  if (!ip) return null;
  const day = now.toISOString().slice(0, 10);
  if (secret) {
    const key = createHmac("sha256", secret).update(KEY_LABEL).digest();
    return createHmac("sha256", key)
      .update(`${day}|${ip}`)
      .digest("hex")
      .slice(0, KEY_LENGTH);
  }
  if (!failsSafeWithoutSecret()) return null;
  if (!warnedUnkeyed) {
    warnedUnkeyed = true;
    console.warn(
      "ITEMS_CURSOR_SECRET is not set; rate limits are keyed by an unkeyed IP hash",
    );
  }
  return createHash("sha256")
    .update(`${UNKEYED_LABEL}|${day}|${ip}`)
    .digest("hex")
    .slice(0, KEY_LENGTH);
}
