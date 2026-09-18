// Image caching layer. Every feed/lightbox image request for a live
// item passes through here instead of hitting the source institution's
// CDN directly on every pageview.
//
// Two tiers, both cached in Vercel Blob (or S3, see Phase 6 below):
//   display  -- the existing feed thumbnail, cached as-is. Origin: the
//               item's `img` URL.
//   lightbox -- resized from the item's true original (`full`/`full_img`)
//               to a capped ~2200px/q82 WebP via sharp. The true,
//               uncapped original is never cached or served, only
//               referenced as the outbound link.
//
// Storage: Vercel Blob, not Cloudflare R2 (R2 needs a card with no hard
// spending cap, an unacceptable risk pre-revenue). Blob's Hobby free
// tier hard-locks further access once the allowance is exceeded until
// the next 30-day cycle -- it does not bill overage, so the circuit
// breaker below exists to stay under that ceiling proactively.
//
// Design: redirect-based, not stream-through-function -- on a cache hit
// this handler never touches image bytes, it 302s to the object's own
// public URL, ~3x more cost-efficient per Vercel's own docs.
//
// Route: /img/:source/:id/:tier, three literal segments rather than a
// catch-all -- this project's framework-less /api convention only
// resolves single dynamic segments, not [...path].js.
//
// Cache key / pathname: img-cache/{source}/{id}/{tier}, deterministic
// (put()'s addRandomSuffix: false), so a corrected source URL self-heals
// under the same key on the next request.
//
// Required env vars: BLOB_READ_WRITE_TOKEN, DATABASE_URL,
// BLOB_USAGE_SOFT_CAP_BYTES (optional).
import { del as rawDel, head as rawHead, put as rawPut } from "@vercel/blob";
// Wrapped rather than counted at call sites, so a new call site can't
// go uncounted. Failures count too -- Vercel bills either way.
import { makeCountedBlobOps, recordBlobOp } from "../../../../lib/blob-ops.ts";
import { getSql } from "../../../../lib/db.ts";

const { put, head, del } = makeCountedBlobOps({
  put: rawPut,
  head: rawHead,
  del: rawDel,
  record: (op: any) => recordBlobOp(getSql(), op),
});

import sharp from "sharp";
import * as admission from "../../../../lib/img-admission.ts";
import * as eviction from "../../../../lib/img-eviction.ts";
import * as guard from "../../../../lib/img-fetch-guard.ts";
import * as objectKeys from "../../../../lib/img-object-key.ts";
import * as s3 from "../../../../lib/img-s3.ts";
import * as store from "../../../../lib/img-store.ts";
import { rateLimitOrRespond } from "../../../../lib/img-visitor-rate-limit.ts";
// Imported as a module object, not destructured -- a destructured
// binding is captured at require time, which vi.mock() in
// tests/img-proxy.test.ts can't intercept.
import * as sentry from "../../../../lib/sentry.ts";
import * as identity from "../../../../lib/source-identity.ts";

const TIERS = ["display", "lightbox"] as const;
type ImgTier = (typeof TIERS)[number];

function isImgTier(value: unknown): value is ImgTier {
  return value === "display" || value === "lightbox";
}

// The single most load-bearing rule in the caching design: which tiers
// may be shed to the source origin.
//   display   origin IS the web derivative (0.1-0.5MB) -- redirecting is
//             byte-identical to what we'd cache. Free to shed.
//   lightbox  origin is the ORIGINAL -- 20MB on Commons, 52.9MB for a
//             Cleveland TIFF. Redirecting hands the visitor ~100x more
//             data and makes the heaviest possible museum request. Never shed.
const SHEDDABLE_TO_ORIGIN: Record<ImgTier, boolean> = {
  display: true,
  lightbox: false,
};
function canShedToOrigin(tier: ImgTier): boolean {
  return SHEDDABLE_TO_ORIGIN[tier] === true;
}

// Backstop against a pathological origin response -- above the 52.9MB
// worst case actually fetched, so it protects the tier rather than
// breaking it. sharp has its own decode guard (limitInputPixels); this
// is the one on the step before that, which had none.
const MAX_ORIGIN_BYTES = 64 * 1024 * 1024;

// Generous vs. the client's own 8s -- this is the populate path, and
// Vercel Node functions default to a 300s timeout under Fluid Compute.
const ORIGIN_FETCH_TIMEOUT_MS = 20000;
// Was a 429-specific inline retry (up to 3x with backoff); removed
// because retrying sends MORE requests to a source that just asked us
// to stop -- the shape of the Wikimedia incident. The caller now parks
// the whole source for the Retry-After window instead (lib/img-fetch-guard.ts).
// Used when a 429 has no Retry-After header, or an unparseable one.
const ORIGIN_COOLDOWN_DEFAULT_SECONDS = 300;
const CACHE_CONTROL_HEADER = "public, max-age=31536000, immutable"; // images are effectively immutable once ingested/licensed
const LIGHTBOX_MAX_DIMENSION = 2200;
// 82 for WebP rather than JPEG's 85: WebP's quality curve differs, and
// 82 is the usual visual match for JPEG 85 at a smaller size.
const LIGHTBOX_WEBP_QUALITY = 82;
const DISPLAY_WEBP_QUALITY = 82;
// The display tier used to be re-encoded but never resized, so a large
// source derivative was stored at whatever size it arrived (15 objects
// over 1MB in production). 1600 is a judgement call against measured
// frames: comfortably above a 2x phone's need (780px), a mild upscale
// for a 2x laptop (2560px wanted), and clearly under the lightbox's
// 2200px so the lightbox stays worth opening. Applies to new writes
// only -- the cache key encodes neither format nor dimensions.
const DISPLAY_MAX_DIMENSION = 1600;

// Hobby Blob storage limit is 1GB (confirmed against the store's own
// dashboard). Soft cap at 950MB as a margin against any per-object
// overhead Vercel counts that isn't reflected in this table's totals --
// not because reserveUsage() below can race (it can't).
const DEFAULT_USAGE_SOFT_CAP_BYTES = 950 * 1024 * 1024;
const USAGE_WARN_FRACTION = 0.8;

// Only fetch from known source CDNs, never a caller-supplied host --
// with one exception: Europeana aggregates rather than hosts, so its
// lightbox-tier full/full_img legitimately points at whichever
// contributing institution's own domain, different per item and
// impossible to enumerate. Its display tier still goes through
// Europeana's fixed thumbnail proxy and is allowlisted normally; its
// lightbox tier falls back to a scheme-only check (https, well-formed).
const ALLOWED_ORIGIN_HOSTS: Record<string, string[]> = {
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
  // the S3 cache-hit lookup below, regardless of whether the object was
  // already cached.
  npm: ["iiifod.npm.gov.tw"],
  // wellcome.py's IIIF image service host -- confirmed against the
  // adapter's own map_item() (img/full both built from the work's
  // digital location's IIIF base url). Added ahead of the adapter's
  // first real ingestion run, not after, following the lesson recorded
  // above: this allowlist and ingest-time S3 caching are unrelated code
  // paths, so a source can cache cleanly at ingest time while every live
  // image request for it still 400s here until this entry exists.
  wellcome: ["iiif.wellcomecollection.org"],
};

type ImgSource = keyof typeof ALLOWED_ORIGIN_HOSTS;
function isImgSource(value: unknown): value is ImgSource {
  return (
    typeof value === "string" && Object.hasOwn(ALLOWED_ORIGIN_HOSTS, value)
  );
}

function isAllowedOrigin(
  source: unknown,
  tier: ImgTier,
  originUrl: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(originUrl);
  } catch (_e) {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (source === "europeana" && tier === "lightbox") return true;
  if (!isImgSource(source)) return false;
  return ALLOWED_ORIGIN_HOSTS[source].indexOf(parsed.hostname) !== -1;
}

// Translates a cache key (source:id:tier) to a Blob pathname, keeping
// that layout in one place.
async function blobDelete(cacheKey: any) {
  const parts = String(cacheKey).split(":");
  const source = parts[0];
  const tier = parts[parts.length - 1];
  const id = parts.slice(1, -1).join(":");
  return await del(pathnameFor(source, id, tier));
}

function pathnameFor(source: any, id: any, tier: any) {
  // Blob pathnames reject "//" -- Europeana's own ids can contain
  // literal slashes, so collapse any slash in id first. Also collapses
  // ":" now that npm.py's ids do too ("U:15646") -- lib/img-object-key.ts's
  // idSegment()/prefixFor() already sanitize on the same
  // [^A-Za-z0-9._-]+ set for the content-addressed key; this legacy
  // pathname had never needed to, since no source before npm had a
  // character here beyond "/".
  const safeId = id.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `img-cache/${source}/${safeId}/${tier}`;
}

// `status` left unset so the handler counts this as origin_error, not a
// misreported 429 -- nothing is wrong with the source, we're declining
// to hold what it offered.
function tooLargeError(bytes: any) {
  const err: any = new Error(
    `origin response exceeds ${MAX_ORIGIN_BYTES} bytes (${bytes})`,
  );
  err.tooLarge = true;
  return err;
}

async function fetchOriginOnce(url: any, source: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ORIGIN_FETCH_TIMEOUT_MS);
  let r: any,
    err: any,
    declared: number,
    chunks: any[],
    total: number,
    buf: any,
    declaredContentType: any,
    typeErr: any,
    contentType: any;
  try {
    r = await fetch(url, {
      signal: controller.signal,
      headers: identity.imageFetchHeaders(source),
    });
    if (!r.ok) {
      err = new Error(`origin fetch failed with status ${r.status}`);
      err.status = r.status;
      err.retryAfter = r.headers.get("retry-after");
      throw err;
    }
    // Cheap rejection first, from the declared size.
    declared = Number(r.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_ORIGIN_BYTES) {
      throw tooLargeError(declared);
    }

    // The real check follows, streamed: content-length is a claim, not
    // the size, and some institutional servers omit it on chunked
    // responses. Reading in chunks lets an oversized body be abandoned
    // partway instead of fully materialised first.
    chunks = [];
    total = 0;
    for await (const chunk of r.body as any) {
      total += chunk.length;
      if (total > MAX_ORIGIN_BYTES) {
        controller.abort();
        throw tooLargeError(total);
      }
      chunks.push(chunk);
    }
    buf = Buffer.concat(chunks, total);
    declaredContentType = r.headers.get("content-type");
    // A 200 isn't proof of an image -- some institutional servers
    // (Nationalmuseum Sweden's eMuseumPlus, found live) answer a broken
    // asset request with 200 and an HTML error page as the body. Without
    // this, that HTML would sail through sharp's decode failure path and
    // get stored verbatim as if it were the image.
    if (declaredContentType && !/^image\//i.test(declaredContentType)) {
      typeErr = new Error(
        `origin returned a 200 with a non-image content-type (${declaredContentType})`,
      );
      typeErr.status = r.status;
      throw typeErr;
    }
    contentType = declaredContentType || "application/octet-stream";
    return { buf: buf, contentType: contentType };
  } finally {
    clearTimeout(timeout);
  }
}

// Alerts on the TRANSITION into a bad state, not on every occurrence --
// a tripped breaker under load would otherwise fire on every request
// (image_load_failed once fired 14,436 times in two days before dedupe).
// Module-scoped, so it lasts as long as the warm instance; a cold start
// re-alerting is fine. Keyed per-HOST: one source rate-limiting us is
// one condition, however many images are involved.
function hostOf(url: any) {
  try {
    return new URL(url).host;
  } catch (_e) {
    return "unknown-host";
  }
}

const alertedConditions = Object.create(null);
const ALERT_REPEAT_MS = 15 * 60 * 1000;

async function alertOnce(key: any, message: any, extra?: any) {
  const now = Date.now();
  if (alertedConditions[key] && now - alertedConditions[key] < ALERT_REPEAT_MS)
    return;
  alertedConditions[key] = now;
  console.error(`img proxy: ${message}`, extra || "");
  let err: any;
  try {
    err = new Error(`img proxy: ${message}`);
    err.name = "ImgProxyDegraded";
    if (extra) err.context = extra;
    await sentry.reportError(err);
  } catch (_e) {
    // Alerting must never take down the request path it is watching.
  }
}

// Single attempt -- see ORIGIN_COOLDOWN_DEFAULT_SECONDS above for why
// there's no retry loop.
async function fetchOrigin(url: any, source: any) {
  return await fetchOriginOnce(url, source);
}

// Circuit breaker, atomic: the UPDATE's WHERE clause only lets the
// increment through if it stays under the cap, so there's no
// read-then-write race window for concurrent misses to overshoot.
// Fails CLOSED -- if the tracker table or DB is unreachable, this
// returns false (blocks the write) rather than risking overspend.
const RESERVE_USAGE_SQL =
  "UPDATE blob_usage_tracker SET total_bytes = total_bytes + $1 " +
  "WHERE total_bytes + $1 <= $2 RETURNING total_bytes";

async function reserveUsage(bytes: any) {
  const client = getSql();
  if (!client) return false;
  const cap =
    Number(process.env.BLOB_USAGE_SOFT_CAP_BYTES) ||
    DEFAULT_USAGE_SOFT_CAP_BYTES;
  let rows: any, total: number;
  try {
    rows = await client.query(RESERVE_USAGE_SQL, [bytes, cap]);
    if (!rows.length) return false;

    // Warn in-band on the way up -- the daily health-check cron also
    // watches this, but Hobby's minimum cron interval is daily, and
    // usage can cross 80% -> 100% inside a day under real traffic.
    total = Number(rows[0].total_bytes);
    if (total >= cap * USAGE_WARN_FRACTION) {
      await alertOnce(
        "usage-high",
        `Blob usage at ${Math.round((total / cap) * 100)}% of the soft cap (${Math.round(
          total / 1e6,
        )}MB of ${Math.round(cap / 1e6)}MB). At 100% the ` +
          `breaker trips and caching stops silently.`,
        { total_bytes: total, cap_bytes: cap },
      );
    }
    return true;
  } catch (err) {
    await alertOnce(
      "tracker-down",
      "usage tracker unreachable, failing closed -- NOTHING is being cached while this persists",
      { error: String((err && (err as any).message) || err) },
    );
    return false;
  }
}

async function bookShed(writes: any) {
  try {
    await Promise.all(writes);
  } catch (_bookErr) {
    // The visitor already has their image; a failed counter isn't worth a 500.
  }
}

// The tier asymmetry (see SHEDDABLE_TO_ORIGIN) as a plan: display sheds
// to origin directly; lightbox falls back to the cached display blob
// instead, since redirecting to its origin would be the heaviest
// possible museum request.
async function shedPlan(tier: any, lookupDisplayBlob: any) {
  if (canShedToOrigin(tier)) {
    return { kind: "origin" };
  }
  let blob: any;
  try {
    blob = await lookupDisplayBlob();
    return { kind: "display", url: blob.url };
  } catch (_e) {
    return { kind: "unavailable" };
  }
}

async function transformForTier(buf: any, contentType: any, tier: any) {
  let webpBuf: any;
  if (tier === "display") {
    // Measured before building: 19 sampled display images re-encode at
    // WebP q82 for a 66.3% saving (56-75% per source), none got bigger.
    // Guarded anyway in case WebP ever loses to an already-optimised
    // source.
    try {
      webpBuf = await sharp(buf)
        .resize({
          width: DISPLAY_MAX_DIMENSION,
          height: DISPLAY_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: DISPLAY_WEBP_QUALITY })
        .toBuffer();
      if (webpBuf.length < buf.length) {
        return { buf: webpBuf, contentType: "image/webp" };
      }
    } catch (_encodeErr) {
      // A source can serve something sharp can't decode (SVG, an exotic
      // TIFF) -- storing the original is correct, not a failure.
    }
    return { buf: buf, contentType: contentType };
  }

  if (tier === "lightbox") {
    // WebP rather than JPEG, ~30% smaller at equivalent quality; this
    // tier already goes through sharp so it's an encoder swap.
    return {
      buf: await sharp(buf)
        .resize({
          width: LIGHTBOX_MAX_DIMENSION,
          height: LIGHTBOX_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: LIGHTBOX_WEBP_QUALITY })
        .toBuffer(),
      contentType: "image/webp",
    };
  }

  return { buf: buf, contentType: contentType };
}

// A Met filename with an en dash (U+2013, not a hyphen) once 500'd the
// shed path: HTTP header values can't hold it. encodeURI() would be
// worse -- it also escapes "%", double-encoding the many already-encoded
// Commons URLs. This encodes exactly Node's real rejection set (above
// U+00FF, control chars) and nothing else, idempotently.
function headerSafeLocation(url: any) {
  return String(url).replace(/[^\x20-\xFF]/g, (ch) => encodeURIComponent(ch));
}

// No, whenever S3 is enabled -- if the row carried an object_key the
// hit path above already served it from CloudFront and returned;
// reaching here means there's no key, so Blob has nothing to say either.
// Blob bills OPERATIONS, not storage, and the free tier's 10,000 has
// been exhausted from exactly this kind of redundant head() call.
function shouldConsultBlob(s3Config: any) {
  return !s3Config?.enabled;
}

// No, whenever S3 is enabled -- reserveUsage() tracks Blob storage
// specifically, and with S3 configured the PUT below never touches
// Blob, so charging it against that budget would track a spend that
// never happened.
function shouldCheckBlobBudget(s3Config: any) {
  return !s3Config?.enabled;
}

// Always true. This used to only treat BlobNotFoundError as a miss --
// wrong for every other failure mode. A paused Blob store (which
// happened, after 798 legacy rows spent the free tier's Simple
// Operations budget) raises BlobAccessError instead, and the old check
// rethrew it as a 500 for an image the miss path could have redirected
// to the museum for. A cache is an optimisation; one that can take the
// page down with it is worse than no cache.
function isCacheMissError(_headErr?: any) {
  return true;
}

export default async function handler(req: any, res: any) {
  const source = req.query.source;
  const id = req.query.id;
  const tier = req.query.tier;
  const originUrl = req.query.origin;

  if (!source || !id || !isImgTier(tier)) {
    res.statusCode = 400;
    res.json({
      error: `Expected /img/:source/:id/:tier with tier in ${TIERS.join("|")}`,
    });
    return;
  }
  // Deliberately NOT validated here. `origin` is only ever needed to fetch
  // the source ourselves on a cache miss (see isAllowedOrigin() below,
  // checked right before the miss path begins) -- every display-tier item
  // is cached on ingestion, so a hit is the overwhelmingly common case and
  // must never depend on this source being in the allowlist. It used to be
  // checked here unconditionally, which meant one missing allowlist entry
  // (npm's) 400'd every one of that source's requests even though the
  // objects were already sitting in S3, correctly cached.

  // Per visitor IP, checked before even a cache-hit lookup -- see
  // lib/img-visitor-rate-limit.ts for why this is a hand-rolled token
  // bucket rather than @vercel/firewall's checkRateLimit.
  if (await rateLimitOrRespond(getSql(), req, res)) return;

  // Serves a miss WITHOUT fetching the origin ourselves -- the same
  // image reaches the visitor, it just doesn't come through us, so
  // museum load stops scaling with our traffic. Tier-dependent per
  // SHEDDABLE_TO_ORIGIN above; lightbox falls back to the cached
  // display blob (warm for ~71% of items) before failing honestly.
  async function shedToVisitor(reason: any) {
    res.setHeader("X-Tranquilo-Shed", reason);

    // Only what the RESPONSE depends on is awaited here -- display
    // needs nothing further, lightbox needs one Blob head(). Everything
    // else is bookkeeping, moved below the response (the cache-hit
    // path's pattern, now applied to the path that takes 90% of misses).
    const plan = await shedPlan(tier, () =>
      head(pathnameFor(source, id, "display")),
    );
    if (plan.kind === "origin") {
      redirectToOrigin();
      await bookShed([
        ...shedWrites(reason),
        guard.bumpShedReason(sqlClient, source, tier, "origin-handoff"),
      ]);
      return;
    }
    if (plan.kind === "display") {
      res.statusCode = 302;
      res.setHeader("Location", headerSafeLocation(plan.url));
      // Short TTL: a degraded substitute must not outlive the condition
      // that caused it.
      res.setHeader("Cache-Control", "public, max-age=120");
      res.end();
      await bookShed(shedWrites(reason));
      return;
    }
    res.statusCode = 503;
    res.setHeader("Retry-After", "60");
    res.setHeader("Cache-Control", "no-store");
    res.json({ error: "Image temporarily unavailable", reason: reason });
    await bookShed(shedWrites(reason));
  }

  // Counts ALL FOUR shed paths (img_cache_stats.shed counts only three
  // pre-fetch ones -- see sql/013_img_shed_stats.sql).
  function shedWrites(reason: any) {
    return [
      guard.bumpStat(sqlClient, source, tier, "shed"),
      guard.bumpShedReason(sqlClient, source, tier, reason),
    ];
  }

  function redirectToOrigin() {
    res.statusCode = 302;
    res.setHeader("Location", headerSafeLocation(originUrl));
    res.setHeader("Cache-Control", "no-store");
    res.end();
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Fail safe: no store configured means no caching, not a broken
    // image. For lightbox this means the uncapped original renders
    // unresized until Blob is linked -- worse than the capped tier but
    // better than a broken lightbox, and self-resolves per request.
    await alertOnce(
      "blob-unconfigured",
      "BLOB_READ_WRITE_TOKEN is not set -- every image request is hotlinking the source directly",
    );
    redirectToOrigin();
    return;
  }

  const pathname = pathnameFor(source, id, tier);
  const cacheKeyForEntry = `${source}:${id}:${tier}`;
  const s3Config = store.configFromEnv();
  let entry: any,
    resolved: any,
    existing: any,
    sqlClient: any,
    cacheKeyForAdmission: any,
    verdict: any,
    storeResult: any,
    budget: any,
    hostBudget: any,
    cacheKey: any,
    claimed: any,
    origin: any,
    status: any,
    cooldown: any,
    transformed: any,
    outBuf: any,
    outContentType: any,
    allowed: any,
    s3Location: any,
    s3PutFailed: any,
    hash: any,
    objectKey: any,
    putResult: any,
    written: any,
    evicted: any;

  try {
    // Phase 6: ask the database first, not Blob. If a row carries an
    // object key it's in S3, served via CloudFront with NO Blob head()
    // -- the hottest path in the project stops touching Blob's
    // operation meter entirely. Trusting the key without an existence
    // check rests on it being written only after a successful PUT, on
    // objects being immutable, and on eviction being retired -- revisit
    // if deletion ever returns. Rows with no key (everything written
    // before this migration) fall through unchanged below.
    if (s3Config.enabled) {
      entry = await store.touchAndResolve(getSql(), cacheKeyForEntry);
      resolved = store.resolveHit(entry, s3Config);
      if (resolved.from === "cdn") {
        res.statusCode = 302;
        res.setHeader("Location", headerSafeLocation(resolved.url));
        res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
        res.end();
        try {
          await guard.bumpStat(getSql(), source, tier, "hits");
        } catch (_bookErr) {
          // The visitor already has their image.
        }
        return;
      }
    }

    // Skipped entirely once S3 is on -- see shouldConsultBlob().
    if (shouldConsultBlob(s3Config)) {
      try {
        existing = await head(pathname);
        // RESPOND FIRST -- the hit counter and LRU recency stamp below
        // are bookkeeping the visitor doesn't depend on. They used to
        // be awaited before the response, costing two extra Neon round
        // trips on every cache hit.
        res.statusCode = 302;
        res.setHeader("Location", headerSafeLocation(existing.url));
        res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
        res.end();

        try {
          await Promise.all([
            guard.bumpStat(getSql(), source, tier, "hits"),
            admission.touch(getSql(), `${source}:${id}:${tier}`),
          ]);
        } catch (_bookErr) {
          // A failed counter must never surface as a failed request.
        }
        return;
      } catch (headErr) {
        // Any failure here is a miss -- see isCacheMissError() above.
        if (!isCacheMissError(headErr)) throw headErr;
      }
    }

    // ---- Cache miss. Everything below decides whether WE fetch the
    // origin, or the visitor does -- the first point anything here
    // actually needs `origin`, so this is the first point it's validated.
    if (!originUrl || !isAllowedOrigin(source, tier, originUrl)) {
      res.statusCode = 400;
      res.json({ error: "Missing or disallowed origin URL" });
      return;
    }

    sqlClient = getSql();
    await guard.bumpStat(sqlClient, source, tier, "misses");

    // Is this image worth storing? Asked first, since a rejection means
    // no fetch, no token, no origin request from our IP at all.
    cacheKeyForAdmission = `${source}:${id}:${tier}`;
    verdict = await admission.noteRequest(
      sqlClient,
      cacheKeyForAdmission,
      source,
      tier,
      id,
    );
    if (!verdict.admit) {
      // No origin fetch for an unadmitted request, whatever the tier --
      // lightbox used to fetch-and-discard anyway, which defeated the
      // point of raising its admission threshold.
      await shedToVisitor(`not-admitted-${verdict.requests}`);
      return;
    }
    storeResult = verdict.admit;

    // Is this source fetchable right now? A standing hold, an active
    // Retry-After cooldown, or an exhausted budget all mean: don't
    // fetch it ourselves.
    budget = await guard.acquireFetchToken(sqlClient, source);
    if (budget.allowed) {
      // Europeana is 26 institutions behind one source key, so a
      // source-level yes says nothing about the specific host.
      hostBudget = await guard.acquireHostToken(
        sqlClient,
        hostOf(originUrl),
        source,
      );
      if (!hostBudget.allowed) {
        budget = {
          allowed: false,
          reason: hostBudget.reason,
          tokens: hostBudget.tokens,
        };
      }
    }
    if (!budget.allowed) {
      if (budget.reason === "unknown-source") {
        await alertOnce(
          `unknown-source:${source}`,
          `no source_fetch_state row for '${source}' -- it can never be fetched ` +
            `server-side until one exists. See sql/010_img_fetch_state.sql.`,
        );
      }
      await shedToVisitor(budget.reason);
      return;
    }

    // Single-flight: without this, N concurrent viewers of one
    // uncached image produce N origin fetches. Losers shed rather than
    // queue.
    cacheKey = `${source}:${id}:${tier}`;
    claimed = await guard.claimFetch(sqlClient, cacheKey);
    if (!claimed) {
      await shedToVisitor("in-flight");
      return;
    }

    try {
      // Spans carry only catalogue-shape debug data (source, tier, id),
      // never visitor data -- see lib/sentry.ts's scrubEvent().
      origin = await sentry.Sentry.startSpan(
        {
          op: "http.client",
          name: "img-proxy.fetch-origin",
          attributes: { source: source, tier: tier, id: id },
        },
        () => fetchOrigin(originUrl, source),
      );
      await guard.recordOriginOutcome(sqlClient, source, 200, true);
      await guard.recordHostOutcome(sqlClient, hostOf(originUrl), 200, true);
      await guard.bumpStat(sqlClient, source, tier, "origin_ok");
    } catch (fetchErr: any) {
      await guard.releaseFetch(sqlClient, cacheKey);
      status = fetchErr?.status;
      if (status === 429) {
        cooldown = guard.parseRetryAfter(
          fetchErr.retryAfter,
          ORIGIN_COOLDOWN_DEFAULT_SECONDS,
        );
        // Parks the HOST that pushed back, not the whole source --
        // Europeana's 26 institutions share a source key, and pausing
        // all of them for one library's rate limit punished the other
        // 25. Source-level health counters still get written, so
        // reporting stays broad while blocking gets narrow.
        await guard.blockHost(sqlClient, hostOf(originUrl), cooldown, source);
        await guard.recordHostOutcome(sqlClient, hostOf(originUrl), 429, false);
        await guard.recordOriginOutcome(sqlClient, source, 429, false);
        await guard.bumpStat(sqlClient, source, tier, "origin_429");
        await alertOnce(
          `429:${hostOf(originUrl)}`,
          `rate-limited (429) by ${hostOf(originUrl)} -- pausing server-side fetches ` +
            `to that host for ${cooldown}s. Other hosts for this source are ` +
            `unaffected. This is the failure mode that produced the Wikimedia rate-limit hold.`,
          {
            source: source,
            host: hostOf(originUrl),
            cooldown_seconds: cooldown,
          },
        );
      } else {
        await guard.recordOriginOutcome(sqlClient, source, status || 0, false);
        await guard.bumpStat(sqlClient, source, tier, "origin_error");
      }
      await shedToVisitor(status === 429 ? "origin-429" : "origin-error");
      return;
    }

    transformed = await sentry.Sentry.startSpan(
      {
        op: "img.transform",
        name: "img-proxy.transform",
        attributes: {
          source: source,
          tier: tier,
          id: id,
          bytes_in: origin.buf.length,
        },
      },
      () => transformForTier(origin.buf, origin.contentType, tier),
    );
    outBuf = transformed.buf;
    outContentType = transformed.contentType;

    // Not admitted -- serve the bytes already held and store nothing;
    // the budget stays untouched.
    if (!storeResult) {
      await guard.releaseFetch(sqlClient, cacheKey);
      res.statusCode = 200;
      res.setHeader("Content-Type", outContentType);
      res.setHeader("Content-Length", outBuf.length);
      // Short TTL: not in Blob, so a long-lived edge entry would hide
      // that this key is still un-admitted.
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader(
        "X-Tranquilo-Admit",
        `no-${verdict.requests}of${verdict.threshold}`,
      );
      res.end(outBuf);
      return;
    }

    allowed = shouldCheckBlobBudget(s3Config)
      ? await reserveUsage(outBuf.length)
      : true;
    if (!allowed && !canShedToOrigin(tier)) {
      await alertOnce(
        "breaker-tripped",
        "circuit breaker TRIPPED -- Blob is at the soft cap. Serving lightbox from " +
          "memory without caching; display tier is now hotlinking.",
        { source: source, id: id, tier: tier },
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", outContentType);
      res.setHeader("Content-Length", outBuf.length);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.end(outBuf);
      await guard.releaseFetch(sqlClient, cacheKey);
      return;
    }
    if (!allowed) {
      await alertOnce(
        "breaker-tripped",
        "circuit breaker TRIPPED -- Blob is at the soft cap, caching has stopped, and every " +
          "uncached image is now hotlinking the source. This is silent by design: requests " +
          "still return 200.",
        { source: source, id: id, tier: tier },
      );
      res.statusCode = 302;
      res.setHeader("Location", headerSafeLocation(originUrl));
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return;
    }

    // Phase 6: S3 first; Blob is the fallback only when S3 is
    // unconfigured. A working S3 costs zero Blob operations. The key is
    // content-addressed, so re-fetching an unchanged master lands on
    // the same key rather than orphaning a copy.
    s3Location = null;
    s3PutFailed = false;
    if (s3Config.enabled) {
      hash = objectKeys.contentHash(outBuf);
      objectKey = objectKeys.objectKeyFor(source, id, tier, hash);
      putResult = await sentry.Sentry.startSpan(
        {
          op: "http.client",
          name: "img-proxy.s3-put",
          attributes: {
            source: source,
            tier: tier,
            id: id,
            bytes: outBuf.length,
          },
        },
        () => s3.putObject(s3Config, objectKey, outBuf, outContentType),
      );
      if (putResult.ok) {
        s3Location = store.cdnUrlFor(s3Config.cdnBaseUrl, objectKey);
        // Recorded only after the PUT succeeds -- the hit path above
        // trusts the key without an existence check on that ordering.
        await store.recordObject(
          getSql(),
          cacheKeyForEntry,
          objectKey,
          hash,
          outBuf.length,
        );
      } else {
        s3PutFailed = true;
      }
    }

    if (s3Location) {
      res.statusCode = 302;
      res.setHeader("Location", headerSafeLocation(s3Location));
      res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
      res.end();
      await guard.releaseFetch(sqlClient, cacheKey);
      return;
    }

    // S3 attempted and failed -- hotlink to origin rather than falling
    // back to Blob.
    if (s3PutFailed) {
      await alertOnce(
        "s3-put-failed",
        "S3 put failed -- hotlinking to origin instead of caching this image. " +
          "Check AWS credentials/bucket/region.",
        {
          source: source,
          id: id,
          tier: tier,
          status: putResult.status,
          key: objectKey,
        },
      );
      res.statusCode = 302;
      res.setHeader("Location", headerSafeLocation(originUrl));
      res.setHeader("Cache-Control", "no-store");
      res.end();
      await guard.releaseFetch(sqlClient, cacheKey);
      return;
    }

    // S3 not configured at all -- the original Blob write, unchanged.
    written = await put(pathname, outBuf, {
      access: "public",
      addRandomSuffix: false,
      contentType: outContentType,
    });

    res.statusCode = 302;
    res.setHeader("Location", headerSafeLocation(written.url));
    res.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
    res.end();
    await admission.markStored(sqlClient, cacheKey, outBuf.length);
    await guard.releaseFetch(sqlClient, cacheKey);

    // Runs after res.end(), so the visitor is never waiting on it.
    // Disabled by default -- see lib/img-eviction.ts.
    try {
      evicted = await eviction.evictIfNeeded(sqlClient, blobDelete, {
        cap:
          Number(process.env.BLOB_USAGE_SOFT_CAP_BYTES) ||
          DEFAULT_USAGE_SOFT_CAP_BYTES,
      });
      if (evicted.evicted) {
        console.log(
          `img proxy: evicted ${evicted.evicted} object(s), freed ${Math.round(
            evicted.freed / 1e6,
          )}MB`,
        );
      }
    } catch (_evictErr) {
      // Never let cache maintenance surface as a request failure.
    }
  } catch (err) {
    console.error(`img proxy: failed for ${source}:${id}:${tier}`, err);
    await sentry.reportError(err);
    res.statusCode = 502;
    res.json({ error: "Image unavailable" });
  }
}

// Exposed for tests only.
function _resetAlerts() {
  Object.keys(alertedConditions).forEach((k) => {
    delete alertedConditions[k];
  });
}

export {
  _resetAlerts,
  ALERT_REPEAT_MS,
  alertOnce,
  bookShed,
  canShedToOrigin,
  DISPLAY_MAX_DIMENSION,
  fetchOriginOnce,
  headerSafeLocation,
  hostOf,
  isAllowedOrigin,
  isCacheMissError,
  LIGHTBOX_MAX_DIMENSION,
  MAX_ORIGIN_BYTES,
  RESERVE_USAGE_SQL,
  shedPlan,
  shouldCheckBlobBudget,
  shouldConsultBlob,
  TIERS,
  transformForTier,
  USAGE_WARN_FRACTION,
};
