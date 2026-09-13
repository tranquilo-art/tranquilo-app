#!/usr/bin/env node
//
// Warm the image cache deliberately, instead of hoping visitors do it --
// organic traffic can't close the cold-item backlog (the arithmetic never
// converges at typical page-view volume), so every cold-image visitor pays
// origin latency instead.
//
// Fetches the origin, transforms and uploads directly (reusing the proxy's
// own transformForTier()) rather than going through /img/, which would spend
// a Vercel invocation per image and pollute the hit/miss counters that are
// supposed to describe visitors, not this pass.
//
// Pacing comes from host_fetch_state.refill_per_sec -- the same sanctioned
// rate visitors share, with a floor so a capacity edit meant for visitor
// bursts can't turn this into a fast crawl. Commons is refused in code,
// since the Wikimedia rate-limit hold is still in force and a loop whose
// whole purpose is fetching images is the easiest way to breach it by
// accident.
//
//   node scripts/warm_image_cache.mts                      # dry run, all sources
//   node scripts/warm_image_cache.mts --source met --limit 50
//   node scripts/warm_image_cache.mts --commit --source met
//
// Dry run by default. Idempotent and resumable: it selects what is still
// cold each time, so an interrupted run just resumes on re-run.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LIVE_ITEMS_AND } from "../lib/items-sql.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Exported so it can be asserted against directly: this used to hand-roll
// its own review_status filter, which drifted from
// lib/items-sql.ts's LIVE_ITEMS_PREDICATE and silently warmed withheld
// items. Sharing the constant means the next withheld state can't drift
// the same way twice.
export function coldItemsSql(): string {
  return `SELECT i.source, i.native_id, i.img, i.full_img, i.title
     FROM items i
     LEFT JOIN img_cache_entries e
       ON e.cache_key = i.source || ':' || i.native_id || ':' || $1
    WHERE i.source = ANY($2)
      AND e.object_key IS NULL
      AND i.img IS NOT NULL
      ${LIVE_ITEMS_AND}
    ORDER BY i.source, i.native_id`;
}

export const HELD_SOURCES = ["commons"]; // Wikimedia rate-limit hold
export const ALL_SOURCES = ["met", "cleveland", "europeana", "smithsonian"];
export const MIN_INTERVAL_MS = 1000;
export const DEFAULT_INTERVAL_MS = 5000; // matches refill_per_sec 0.2

// A loop that fetches from an institution must not fail silently at length
// -- added after a live run failed on every item and kept going, reaching
// Cleveland 12 times before being killed by hand. Same shape of incident as
// the Wikimedia hold (628 consecutive failures with no breaker).
// Consecutive, not lifetime: a few bad images shouldn't stop a healthy run.
export const ERROR_LIMIT = 3;

export function makeBreaker() {
  return {
    consecutive: 0,
    fail: function () {
      this.consecutive++;
    },
    succeed: function () {
      this.consecutive = 0;
    },
    tripped: function () {
      return this.consecutive >= ERROR_LIMIT;
    },
  };
}

// transformForTier returns { buf, contentType }. An earlier version guessed
// at the key (`out.buffer || out.body || out`) and silently fell back to the
// whole object; an unrecognised shape now throws rather than falling through.
export function bufferFrom(out: any) {
  if (out && Buffer.isBuffer(out.buf)) return out.buf;
  if (Buffer.isBuffer(out)) return out;
  throw new Error(
    "transform returned no buffer -- expected { buf, contentType }",
  );
}

export function assertSourceAllowed(source: any) {
  if (HELD_SOURCES.indexOf(String(source || "").toLowerCase()) !== -1) {
    throw new Error(
      `refusing to warm '${source}': the Wikimedia/Commons hold is in force. ` +
        `Remove it from HELD_SOURCES only once that changes.`,
    );
  }
}

export function sourcesToWarm(requested: any) {
  if (!requested) return ALL_SOURCES.slice();
  assertSourceAllowed(requested);
  return [requested];
}

// The host's own sanctioned rate, never faster than the floor.
export function intervalMsFor(hostRow: any) {
  const rate = hostRow && Number(hostRow.refill_per_sec);
  if (!rate || !Number.isFinite(rate) || rate <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(1000 / rate));
}

export function estimate(count: any, intervalMs: any) {
  return {
    requests: count,
    hours: +((count * intervalMs) / 3600000).toFixed(2),
  };
}

// A row existing is not "warm" -- most rows without an object_key were only
// admission bookkeeping for images seen once, and those are what this
// exists to store.
export function needsWarming(entry: any) {
  return !entry?.object_key;
}

// Mirrors api/items.ts's own choice, so the object lands on the key the
// visitor's URL will ask for.
export function originFor(item: any, tier: any) {
  if (!item) return null;
  const url = tier === "lightbox" ? item.full_img || item.img : item.img;
  return url || null;
}

// The actual fetch/transform/S3-write loop, extracted so it has exactly one
// implementation regardless of what invokes it -- runCli() below and
// lib/cron/warm-image-cache.ts both supply their own dependencies and
// stopping conditions rather than each carrying their own copy.
//
// `commit: false` stops after planning -- the same dry-run contract
// runCli() has always had.
export async function warmBatch(opts: {
  sql: any;
  tier: any;
  sources: any;
  limit?: number | null;
  commit: boolean;
  deps?: {
    proxy?: any;
    objectKey?: any;
    store?: any;
    s3?: any;
    identity?: any;
  };
  shouldStop?: () => boolean;
  onProgress?: (line: string) => void;
  sleepMs?: (ms: number) => Promise<void>;
}) {
  const sql = opts.sql;
  const tier = opts.tier;
  const limit = opts.limit ?? null;
  const deps = opts.deps || {};
  const shouldStop = opts.shouldStop || (() => false);
  const log = opts.onProgress || (() => {});
  const sleep =
    opts.sleepMs || ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const cold = await sql.query(coldItemsSql(), [tier, opts.sources]);

  const hosts = await sql.query(
    `SELECT host, source, refill_per_sec FROM host_fetch_state`,
  );
  const byHost: any = {};
  for (const h of hosts) byHost[h.host] = h;

  const work = limit ? cold.slice(0, limit) : cold;
  const perSource: any = {};
  for (const r of work as any[])
    perSource[r.source] = (perSource[r.source] || 0) + 1;

  const intervals = work.map((r: any) => {
    const host: any = (() => {
      try {
        return new URL(originFor(r, tier)).host;
      } catch {
        return null;
      }
    })();
    return intervalMsFor(byHost[host]);
  });
  const slowest = intervals.length
    ? Math.max(...intervals)
    : DEFAULT_INTERVAL_MS;
  const plan = estimate(work.length, slowest);

  log(`cold and warmable: ${work.length} ${JSON.stringify(perSource)}`);
  log(`pace: ${slowest}ms between requests (from host_fetch_state)`);
  log(`estimated: ${plan.hours} hours`);

  if (!opts.commit) {
    return {
      committed: false,
      workLength: work.length,
      // Only the preview needs the actual rows; the committed branch below
      // never returns them, since a real run can be thousands long.
      firstThree: work
        .slice(0, 3)
        .map((r: any) => `${r.source}:${r.native_id}`),
      perSource,
      estimatedHours: plan.hours,
      done: 0,
      failed: 0,
      skipped: 0,
      bytesTotal: 0,
      stoppedEarly: false,
      breakerTripped: false,
    };
  }

  const store = deps.store;
  const cfg = store.configFromEnv();
  if (!cfg.enabled) throw new Error("S3 is not configured -- refusing to run");
  const proxy = deps.proxy;
  const objectKey = deps.objectKey;
  const s3 = deps.s3;
  const identity = deps.identity;

  let done = 0,
    failed = 0,
    skipped = 0,
    bytesTotal = 0,
    stoppedEarly = false,
    breakerTripped = false;
  const breaker = makeBreaker();
  const started = Date.now();

  for (const row of work) {
    if (shouldStop()) {
      stoppedEarly = true;
      break;
    }
    if (breaker.tripped()) {
      log(
        `STOPPED: ${ERROR_LIMIT} consecutive failures. A loop that fetches ` +
          `from an institution must not fail silently at length.`,
      );
      breakerTripped = true;
      break;
    }
    const origin = originFor(row, tier);
    if (!origin) {
      skipped++;
      continue;
    }

    let host = null;
    try {
      host = new URL(origin).host;
    } catch {
      skipped++;
      continue;
    }
    const interval = intervalMsFor(byHost[host]);

    try {
      const res = await fetch(origin, {
        headers: identity.imageFetchHeaders(row.source),
      });
      if (!res.ok) {
        failed++;
        breaker.fail();
        log(`  ${res.status} ${row.source}:${row.native_id}`);
        await sleep(interval);
        continue;
      }
      const raw = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/jpeg";

      const out = await proxy.transformForTier(raw, contentType, tier);
      const body = bufferFrom(out);
      const type = out.contentType || contentType;

      const hash = objectKey.contentHash(body);
      const key = objectKey.objectKeyFor(row.source, row.native_id, tier, hash);
      const put = await s3.putObject(cfg, key, body, type);
      if (!put.ok) {
        failed++;
        breaker.fail();
        log(`  S3 ${put.status} ${row.source}:${row.native_id}`);
        await sleep(interval);
        continue;
      }

      const cacheKey = `${row.source}:${row.native_id}:${tier}`;
      await sql.query(
        `INSERT INTO img_cache_entries (cache_key, source, tier, native_id, requests, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,1,now(),now()) ON CONFLICT (cache_key) DO NOTHING`,
        [cacheKey, row.source, tier, row.native_id],
      );
      await sql.query(store.recordObjectSql(), [cacheKey, key, hash, body.length]);

      done++;
      breaker.succeed();
      bytesTotal += body.length;
      if (done % 25 === 0) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        log(`  ${done}/${work.length} warmed, ${failed} failed, ${mins} min`);
      }
    } catch (err: any) {
      failed++;
      breaker.fail();
      log(
        `  ERR ${row.source}:${row.native_id} -- ${String(err?.message || err)}`,
      );
    }
    await sleep(interval);
  }

  log(
    `warmed ${done}, failed ${failed}, skipped ${skipped}, ` +
      `${(bytesTotal / 1048576).toFixed(1)} MB in ` +
      `${((Date.now() - started) / 60000).toFixed(1)} min`,
  );

  return {
    committed: true,
    workLength: work.length,
    perSource,
    estimatedHours: plan.hours,
    done,
    failed,
    skipped,
    bytesTotal,
    stoppedEarly,
    breakerTripped,
  };
}

// ---------------------------------------------------------------------------
// Everything below runs only when invoked directly.
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runCli();
}

async function runCli() {
  const fs = await import("node:fs");
  // Local-dev convenience only; CI has no .env.local (its credentials come
  // from GitHub Secrets), so this only reads the file when it exists.
  const envLocalPath = path.join(ROOT, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    for (const line of fs.readFileSync(envLocalPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]])
        process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  }

  const { neon } = await import("@neondatabase/serverless");
  const proxy = await import(
    pathToFileURL(path.join(ROOT, "api/img/[source]/[id]/[tier].ts")).href
  );
  const objectKey = await import(
    pathToFileURL(path.join(ROOT, "lib/img-object-key.ts")).href
  );
  const store = await import(
    pathToFileURL(path.join(ROOT, "lib/img-store.ts")).href
  );
  const s3 = await import(pathToFileURL(path.join(ROOT, "lib/img-s3.ts")).href);
  const identity = await import(
    pathToFileURL(path.join(ROOT, "lib/source-identity.ts")).href
  );

  const args = process.argv.slice(2);
  const opt = (name: any, fallback: any) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const COMMIT = args.includes("--commit");
  const SOURCE = opt("source", null);
  const TIER = opt("tier", "display");
  const LIMIT = Number(opt("limit", 0)) || null;

  const sql = neon(process.env.DATABASE_URL!);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\ninterrupted -- finishing the current image");
  });

  const sources = sourcesToWarm(SOURCE);
  console.log(
    "sources:",
    sources.join(", "),
    "| tier:",
    TIER,
    "|",
    COMMIT ? "COMMIT" : "DRY RUN",
  );

  await warmBatch({
    sql,
    tier: TIER,
    sources,
    limit: LIMIT,
    commit: COMMIT,
    deps: { proxy, objectKey, store, s3, identity },
    shouldStop: () => stopping,
    onProgress: (line) => console.log(line),
  })
    .then((result) => {
      if (!result.committed) {
        console.log(
          "\nDRY RUN -- nothing fetched, nothing written. Re-run with --commit.",
        );
        if (result.firstThree.length)
          console.log("first 3:", result.firstThree.join(", "));
      }
    })
    .catch((e: any) => {
      console.error("FATAL", e?.message || e);
      process.exit(1);
    });
}
