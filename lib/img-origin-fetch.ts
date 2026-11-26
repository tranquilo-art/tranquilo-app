// The one hardened fetch of an institution's image origin, shared by the
// image proxy (api/img) and the cache-warming jobs (lib/img-warm.ts).
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import * as identity from "./source-identity.ts";

export type OriginTier = "display" | "lightbox";

export interface OriginError extends Error {
  status?: number;
  retryAfter?: string | null;
  tooLarge?: boolean;
  refused?: "dns-private" | "dns-failed" | "redirect";
}

// Backstop against a pathological origin response -- above the 52.9MB
// worst case actually fetched, so it protects the tier rather than
// breaking it. sharp has its own decode guard (limitInputPixels); this
// is the one on the step before that, which had none.
export const MAX_ORIGIN_BYTES = 64 * 1024 * 1024;

// Generous vs. the client's own 8s -- this is the populate path, and
// Vercel Node functions default to a 300s timeout under Fluid Compute.
const ORIGIN_FETCH_TIMEOUT_MS = 20000;

// Only fetch from known source CDNs, never a caller-supplied host --
// with one exception: Europeana aggregates rather than hosts, so its
// lightbox-tier full/full_img legitimately points at whichever
// contributing institution's own domain, different per item and
// impossible to enumerate. Its display tier still goes through
// Europeana's fixed thumbnail proxy and is allowlisted normally; its
// lightbox tier falls back to a scheme-only check (https, well-formed).
export const ALLOWED_ORIGIN_HOSTS: Record<string, string[]> = {
  met: ["images.metmuseum.org"],
  smithsonian: ["ids.si.edu"],
  cleveland: ["openaccess-cdn.clevelandart.org"],
  // thumb.wikimedia.org serves Wikimedia's own rendered derivative for
  // anything not already a web-ready JPEG (e.g. TIFF scans).
  commons: ["upload.wikimedia.org", "thumb.wikimedia.org"],
  europeana: ["api.europeana.eu"],
  // npm.py's IIIF image service host, confirmed against real ingested
  // rows' img/full_img values -- this was missing entirely, so every
  // npm request 400'd here as "disallowed origin" before ever reaching
  // the cache lookup, whether or not the object was cached.
  npm: ["iiifod.npm.gov.tw"],
  // wellcome.py's IIIF image service host -- confirmed against the
  // adapter's own map_item() (img/full both built from the work's
  // digital location's IIIF base url). Added ahead of the adapter's
  // first real ingestion run, not after, following the lesson recorded
  // above: this allowlist and ingest-time S3 caching are unrelated code
  // paths, so a source can cache cleanly at ingest time while every live
  // image request for it still 400s here until this entry exists.
  wellcome: ["iiif.wellcomecollection.org"],
  // nga.py's IIIF Image API host (api.nga.gov/iiif/{uuid}), the only
  // image host in NGA's published_images data. Added before the first
  // ingestion run for the same reason as wellcome above.
  nga: ["api.nga.gov"],
  // tepapa.py's media host, confirmed against real ingested rows (img and
  // full_img both). Missed at launch: the display tier was cached at
  // ingest, so only cache misses -- mostly the lightbox -- 400'd.
  tepapa: ["media.tepapa.govt.nz"],
  // mia.py's image cache, which serves both the 800 and full renditions.
  mia: ["1.api.artsmia.org"],
  // aic.py builds img/full from the IIIF host; only the allowlisted
  // widths (843 and 1686 for public-domain works) are served.
  aic: ["www.artic.edu"],
  // tainacan.py reads each museum's own WordPress site, which serves its
  // own uploads; one host per instance in the adapter's INSTANCES. Added
  // before the first ingestion run, as with wellcome above.
  tainacan: [
    "acervo.margs.rs.gov.br",
    "museudoouro.acervos.museus.gov.br",
    "museuregionalcasadosottoni.acervos.museus.gov.br",
  ],
};

type ImgSource = keyof typeof ALLOWED_ORIGIN_HOSTS;
function isImgSource(value: unknown): value is ImgSource {
  return (
    typeof value === "string" && Object.hasOwn(ALLOWED_ORIGIN_HOSTS, value)
  );
}

const WILDCARD_DNS_SUFFIX =
  /\.(nip\.io|sslip\.io|xip\.io|traefik\.me|localtest\.me)$/;
const EMBEDDED_IPV4 = /(^|[.-])\d{1,3}([.-])\d{1,3}\2\d{1,3}\2\d{1,3}([.-]|$)/;

// Rejects IP literals, internal and wildcard-DNS names, ports, credentials.
export function isPublicDnsHost(url: URL): boolean {
  const host = url.hostname.replace(/\.+$/, "");
  if (url.port || url.username || url.password) return false;
  if (host.includes(":") || /^[0-9.]+$/.test(host) || /^\[/.test(host))
    return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (/\.(internal|local|localdomain|lan|home|corp)$/.test(host)) return false;
  if (WILDCARD_DNS_SUFFIX.test(host) || EMBEDDED_IPV4.test(host)) return false;
  return host.includes(".");
}

export function isAllowedOrigin(
  source: unknown,
  tier: OriginTier,
  originUrl: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(originUrl);
  } catch (_e) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.port || parsed.username || parsed.password) return false;
  if (source === "europeana" && tier === "lightbox")
    return isPublicDnsHost(parsed);
  if (!isImgSource(source)) return false;
  return ALLOWED_ORIGIN_HOSTS[source].indexOf(parsed.hostname) !== -1;
}

// `status` left unset so the handler counts this as origin_error, not a
// misreported 429 -- nothing is wrong with the source, we're declining
// to hold what it offered.
function tooLargeError(bytes: number) {
  const err: OriginError = new Error(
    `origin response exceeds ${MAX_ORIGIN_BYTES} bytes (${bytes})`,
  );
  err.tooLarge = true;
  return err;
}

const FORMAT_CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tiff: "image/tiff",
};
const HEADER_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/avif": "image/avif",
  "image/gif": "image/gif",
  "image/tiff": "image/tiff",
};
const MAX_ORIGIN_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function sniffContentType(buf: Buffer): string | null {
  const ascii = (from: number, to: number) =>
    buf.subarray(from, to).toString("latin1");
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^(avif|avis)/.test(ascii(8, 12)))
    return "image/avif";
  if (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*")
    return "image/tiff";
  return null;
}

function looksLikeMarkup(buf: Buffer): boolean {
  return buf.subarray(0, 512).toString("utf8").trimStart().startsWith("<");
}

// Content type from the body's detected format, never the origin's header.
async function detectRasterContentType(
  declaredContentType: string | null,
  buf: Buffer,
): Promise<string | null> {
  if (looksLikeMarkup(buf)) return null;
  try {
    const { format, compression } = await sharp(buf).metadata();
    if (format === "heif")
      return compression === "av1" ? "image/avif" : "image/heif";
    return (format && FORMAT_CONTENT_TYPES[format]) || null;
  } catch (_e) {
    if (!declaredContentType) return sniffContentType(buf);
    const mime = declaredContentType.split(";")[0].trim().toLowerCase();
    return HEADER_CONTENT_TYPES[mime] ?? null;
  }
}

function redirectRefused(reason: string): OriginError {
  const err: OriginError = new Error(`origin redirect refused: ${reason}`);
  err.refused = "redirect";
  return err;
}

export type OriginResolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;

const defaultResolver: OriginResolver = (host) =>
  lookup(host, { all: true, verbatim: true });

const IPV4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(address: string): number {
  return address
    .split(".")
    .reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isPublicIPv4(address: string): boolean {
  const value = ipv4ToInt(address);
  return !IPV4_BLOCKED.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(ipv4ToInt(base) / size);
  });
}

function parseIPv6Groups(address: string): number[] | null {
  let text = address.split("%")[0].toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const v = ipv4ToInt(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${Math.floor(v / 65536).toString(16)}:${(v % 65536).toString(16)}`;
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
  const parsed = groups.map((g) => Number.parseInt(g, 16));
  return parsed.length === 8 && parsed.every((g) => g >= 0 && g <= 0xffff)
    ? parsed
    : null;
}

function embeddedIPv4(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicIPv6(address: string): boolean {
  const g = parseIPv6Groups(address);
  if (!g) return false;
  const zeroPrefix = (n: number) => g.slice(0, n).every((x) => x === 0);
  // ::/96 is IPv4-compatible, ::ffff:0:0/96 IPv4-mapped.
  if (zeroPrefix(6) || (zeroPrefix(5) && g[5] === 0xffff))
    return isPublicIPv4(embeddedIPv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0))
    return isPublicIPv4(embeddedIPv4(g[6], g[7]));
  if (g[0] === 0x2002) return isPublicIPv4(embeddedIPv4(g[1], g[2]));
  if (g[0] < 0x2000 || g[0] > 0x3fff) return false;
  if (g[0] === 0x2001 && g[1] < 0x200) return false;
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false;
  if (g[0] === 0x3fff && g[1] < 0x1000) return false;
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address.split("%")[0]);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

function addressRefused(
  host: string,
  refused: "dns-private" | "dns-failed",
  detail: string,
): OriginError {
  const err: OriginError = new Error(
    `origin address refused: ${host} ${detail}`,
  );
  err.refused = refused;
  return err;
}

const DNS_LOOKUP_TIMEOUT_MS = 3000;

export function lookupWithin(
  host: string,
  resolve: OriginResolver,
  signal: AbortSignal,
  capMs: number,
): Promise<{ address: string }[]> {
  return new Promise((settle, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", fail);
    };
    const fail = () => {
      done();
      reject(addressRefused(host, "dns-failed", "did not resolve in time"));
    };
    if (signal.aborted) return fail();
    timer = setTimeout(fail, capMs);
    signal.addEventListener("abort", fail, { once: true });
    // The lookup cannot be cancelled; both handlers keep a late result handled.
    Promise.resolve()
      .then(() => resolve(host))
      .then(
        (value) => {
          done();
          settle(value);
        },
        (err) => {
          done();
          reject(err);
        },
      );
  });
}

// Narrows, but cannot close, the race between this lookup and the connect.
async function assertPublicResolution(
  url: string,
  resolve: OriginResolver,
  signal: AbortSignal,
  capMs: number,
): Promise<void> {
  const host = new URL(url).hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  let addresses: { address: string }[];
  try {
    addresses = await lookupWithin(host, resolve, signal, capMs);
  } catch (_e) {
    throw addressRefused(host, "dns-failed", "did not resolve");
  }
  if (!addresses.length)
    throw addressRefused(host, "dns-failed", "did not resolve");
  if (!addresses.every((a) => isPublicAddress(a.address)))
    throw addressRefused(
      host,
      "dns-private",
      "resolves to a non-public address",
    );
}

export async function fetchOriginOnce(
  url: string,
  source: string,
  tier: OriginTier = "display",
  resolve: OriginResolver = defaultResolver,
  dnsTimeoutMs: number = DNS_LOOKUP_TIMEOUT_MS,
): Promise<{ buf: Buffer; contentType: string }> {
  if (!isAllowedOrigin(source, tier, url))
    throw redirectRefused("disallowed host");
  return fetchFollowingRedirectsUnchecked(
    url,
    source,
    tier,
    resolve,
    dnsTimeoutMs,
  );
}

export async function fetchFollowingRedirectsUnchecked(
  url: string,
  source: string,
  tier: OriginTier = "display",
  resolve: OriginResolver = defaultResolver,
  dnsTimeoutMs: number = DNS_LOOKUP_TIMEOUT_MS,
): Promise<{ buf: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ORIGIN_FETCH_TIMEOUT_MS);
  try {
    let current = url;
    let r: Response;
    for (let hop = 0; ; hop++) {
      await assertPublicResolution(
        current,
        resolve,
        controller.signal,
        dnsTimeoutMs,
      );
      r = await fetch(current, {
        signal: controller.signal,
        headers: identity.imageFetchHeaders(source),
        redirect: "manual",
      });
      if (!REDIRECT_STATUSES.has(r.status)) break;
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) throw redirectRefused("no location");
      if (hop >= MAX_ORIGIN_REDIRECTS) throw redirectRefused("too many hops");
      const next = new URL(location, current).toString();
      if (!next.startsWith("https:")) throw redirectRefused("not https");
      if (!isAllowedOrigin(source, tier, next))
        throw redirectRefused("disallowed host");
      current = next;
    }
    if (!r.ok) {
      const err: OriginError = new Error(
        `origin fetch failed with status ${r.status}`,
      );
      err.status = r.status;
      err.retryAfter = r.headers.get("retry-after");
      throw err;
    }
    // Cheap rejection first, from the declared size.
    const declared = Number(r.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ORIGIN_BYTES) {
      throw tooLargeError(declared);
    }

    // The real check follows, streamed: content-length is a claim, not
    // the size, and some institutional servers omit it on chunked
    // responses. Reading in chunks lets an oversized body be abandoned
    // partway instead of fully materialised first.
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_ORIGIN_BYTES) {
        controller.abort();
        throw tooLargeError(total);
      }
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks, total);
    const declaredContentType = r.headers.get("content-type");
    // A 200 isn't proof of an image -- some institutional servers
    // (Nationalmuseum Sweden's eMuseumPlus, found live) answer a broken
    // asset request with 200 and an HTML error page as the body. Without
    // this, that HTML would sail through sharp's decode failure path and
    // get stored verbatim as if it were the image.
    const contentType = await detectRasterContentType(declaredContentType, buf);
    if (!contentType) {
      const typeErr: OriginError = new Error(
        `origin returned a 200 that is not a raster image (${declaredContentType ?? "no content-type"})`,
      );
      typeErr.status = r.status;
      throw typeErr;
    }
    return { buf: buf, contentType: contentType };
  } finally {
    clearTimeout(timeout);
  }
}
