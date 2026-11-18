// Shared "what origin is this request actually coming in on" helper --
// lives outside /api/ for the usual function-cap reason.
import type { VercelRequest } from "@vercel/node";

// A Node request header can legitimately arrive as string[]. A bare `||`
// on the array case would silently comma-join it into the URL via
// toString() rather than using the first value, the standard reverse-proxy
// convention for these two headers.
function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const PRODUCTION_ORIGIN = "https://tranquilo.art";

function configuredOrigin(): string | null {
  const raw = process.env.CANONICAL_ORIGIN;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function isLocalRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.VERCEL_ENV === "development"
  );
}

function requestOrigin(req: VercelRequest): string {
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) || "https";
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host;
  return `${proto}://${host}`;
}

function getOrigin(req: VercelRequest): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  return isLocalRuntime() ? requestOrigin(req) : PRODUCTION_ORIGIN;
}

export { firstHeaderValue, getOrigin };
