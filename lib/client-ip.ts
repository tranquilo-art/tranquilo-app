// The one place a request's client IP is derived, for every rate limiter.
// IPv6 clients are keyed by their /64 prefix.

import { isIP } from "node:net";

type HeaderValue = string | string[] | undefined;

interface RequestWithClientIp {
  headers?: Record<string, HeaderValue>;
  socket?: { remoteAddress?: string | null } | null;
}

type Runtime = "vercel" | "aws" | "other";

function runtime(): Runtime {
  if (process.env.VERCEL) return "vercel";
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return "aws";
  return "other";
}

function headerValue(value: HeaderValue): string {
  return String(Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

function stripPort(address: string, alwaysHasPort: boolean): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (bracketed) return bracketed[1];
  if (alwaysHasPort) {
    const cut = address.lastIndexOf(":");
    return cut === -1 ? address : address.slice(0, cut);
  }
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(address);
  return ipv4WithPort ? ipv4WithPort[1] : address;
}

function hextets(ipv6: string): number[] | null {
  let text = ipv6;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...tail,
  ];
  const values = groups.map((group) => Number.parseInt(group, 16));
  return values.length === 8 && values.every((v) => v >= 0 && v <= 0xffff)
    ? values
    : null;
}

function normalize(raw: string, alwaysHasPort = false): string | null {
  const address = stripPort(raw.trim(), alwaysHasPort).split("%")[0];
  const family = isIP(address);
  if (family === 4) return address;
  if (family !== 6) return null;
  const groups = hextets(address);
  if (!groups) return null;
  const mappedPrefix =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mappedPrefix) {
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join(".");
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(":")}::/64`;
}

function lastForwardedHop(forwarded: HeaderValue): string | null {
  const hops = (
    Array.isArray(forwarded) ? forwarded.join(",") : (forwarded ?? "")
  )
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.length ? normalize(hops[hops.length - 1]) : null;
}

export function clientIp(
  req: RequestWithClientIp | null | undefined,
): string | null {
  const headers = req?.headers;
  const where = runtime();

  if (where === "aws") {
    const viewer = normalize(
      headerValue(headers?.["cloudfront-viewer-address"]),
      true,
    );
    if (viewer) return viewer;
  }
  if (where === "vercel") {
    for (const name of ["x-vercel-forwarded-for", "x-real-ip"]) {
      const value = headerValue(headers?.[name]);
      const ip = value ? normalize(value.split(",")[0]) : null;
      if (ip) return ip;
    }
  }

  const forwarded = lastForwardedHop(headers?.["x-forwarded-for"]);
  if (forwarded) return forwarded;

  const socketAddress = req?.socket?.remoteAddress;
  return socketAddress ? normalize(socketAddress) : null;
}
