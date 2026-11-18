// Size, shape and rate guards for unauthenticated write routes.
import type { QuerySql } from "./img-store.ts";
import { writeRateLimitOrRespond } from "./items-rate-limit.ts";

interface GuardRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface GuardResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  json(body: unknown): unknown;
}

const WRITE_LIMITS = {
  track: { capacity: 120, refill_per_sec: 2, enforce: true },
  subscribe: { capacity: 5, refill_per_sec: 1 / 60, enforce: true },
  submit: { capacity: 5, refill_per_sec: 1 / 120, enforce: true },
};

const EVENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const MAX_PROPS_DEPTH = 3;
const MAX_PROPS_KEYS = 50;
const MAX_PROPS_BYTES = 4096;

function bodyByteLength(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body) ?? "");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// True when the 413 has been sent and the caller must return.
function rejectOversizedBody(
  res: GuardResponse,
  body: unknown,
  maxBytes: number,
): boolean {
  if (bodyByteLength(body) <= maxBytes) return false;
  res.statusCode = 413;
  res.json({ error: "Request body too large" });
  return true;
}

function rejectOverlongField(
  res: GuardResponse,
  body: Record<string, unknown>,
  maxLengths: Record<string, number>,
): boolean {
  for (const [field, max] of Object.entries(maxLengths)) {
    const value = body[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string" || value.length > max) {
      res.statusCode = 400;
      res.json({ error: `${field} is invalid or too long (max ${max})` });
      return true;
    }
  }
  return false;
}

function isValidEventName(value: unknown): value is string {
  return typeof value === "string" && EVENT_NAME_PATTERN.test(value);
}

function withinDepthAndKeys(value: unknown, depth: number): boolean {
  if (value === null || typeof value !== "object") return true;
  if (depth > MAX_PROPS_DEPTH) return false;
  const entries = Object.values(value);
  if (entries.length > MAX_PROPS_KEYS) return false;
  return entries.every((entry) => withinDepthAndKeys(entry, depth + 1));
}

function arePropsBounded(props: unknown): boolean {
  return (
    bodyByteLength(props) <= MAX_PROPS_BYTES && withinDepthAndKeys(props, 1)
  );
}

function writeRateLimited(
  sql: QuerySql | null | undefined,
  req: GuardRequest,
  res: GuardResponse,
  route: keyof typeof WRITE_LIMITS,
): Promise<boolean> {
  return writeRateLimitOrRespond(sql, req, res, route, WRITE_LIMITS[route]);
}

export {
  arePropsBounded,
  isValidEventName,
  rejectOverlongField,
  rejectOversizedBody,
  writeRateLimited,
};
