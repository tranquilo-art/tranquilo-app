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

function getOrigin(req: VercelRequest): string {
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]) || "https";
  const host =
    firstHeaderValue(req.headers["x-forwarded-host"]) || req.headers.host;
  return `${proto}://${host}`;
}

export { firstHeaderValue, getOrigin };
