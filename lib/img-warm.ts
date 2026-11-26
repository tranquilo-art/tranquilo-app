// The image-warming pass's shared decisions and the fetch/transform/S3-write
// loop itself. Extracted out of scripts/warm_image_cache.mts so that
// lib/cron/warm-image-cache.ts (a deployed Vercel function) never imports
// from scripts/ (local-only tooling, not part of the function bundle) --
// scripts/warm_image_cache.mts now re-exports this module for the CLI.
import {
  fetchOriginOnce,
  isAllowedOrigin,
  type OriginResolver,
} from "./img-origin-fetch.ts";
import type { S3Credentials } from "./img-s3.ts";
import type { ImgS3Config, QuerySql } from "./img-store.ts";
import { LIVE_ITEMS_AND } from "./items-sql.ts";

export type WarmTier = "display" | "lightbox";

export interface ColdItemRow {
  source: string;
  native_id: string;
  img: string | null;
  full_img: string | null;
  title: string | null;
}

interface HostFetchRow {
  host: string;
  source: string;
  refill_per_sec: number | string | null;
}

interface TransformOutput {
  buf: Buffer;
  contentType?: string;
}

export interface WarmDeps {
  proxy: {
    transformForTier(
      raw: Buffer,
      contentType: string,
      tier: string,
    ): Promise<TransformOutput | Buffer>;
  };
  objectKey: {
    contentHash(body: Buffer): string;
    objectKeyFor(
      source: string,
      id: string,
      tier: string,
      hash: string,
    ): string;
  };
  store: {
    configFromEnv(): ImgS3Config;
    recordObjectSql(): string;
  };
  s3: {
    putObject(
      config: S3Credentials,
      key: string,
      body: Buffer,
      contentType: string,
    ): Promise<{ ok: boolean; status: number }>;
  };
  resolve?: OriginResolver;
}

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

export const HELD_SOURCES = ["commons"];
export const ALL_SOURCES = ["met", "cleveland", "europeana", "smithsonian"];
export const MIN_INTERVAL_MS = 1000;
export const DEFAULT_INTERVAL_MS = 5000; // matches refill_per_sec 0.2

// A loop fetching from an institution must stop on repeated failures.
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
export function bufferFrom(out: unknown): Buffer {
  if (Buffer.isBuffer(out)) return out;
  const buf = (out as Partial<TransformOutput> | null | undefined)?.buf;
  if (Buffer.isBuffer(buf)) return buf;
  throw new Error(
    "transform returned no buffer -- expected { buf, contentType }",
  );
}

export function assertSourceAllowed(source: string | null | undefined) {
  if (HELD_SOURCES.indexOf(String(source || "").toLowerCase()) !== -1) {
    throw new Error(
      `refusing to warm '${source}': it is in HELD_SOURCES. ` +
        `Remove it from HELD_SOURCES to allow warming.`,
    );
  }
}

export function sourcesToWarm(requested?: string | null) {
  if (!requested) return ALL_SOURCES.slice();
  assertSourceAllowed(requested);
  return [requested];
}

// The host's own sanctioned rate, never faster than the floor.
export function intervalMsFor(
  hostRow?: Partial<Pick<HostFetchRow, "refill_per_sec">> | null,
) {
  const rate = hostRow && Number(hostRow.refill_per_sec);
  if (!rate || !Number.isFinite(rate) || rate <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.round(1000 / rate));
}

export function estimate(count: number, intervalMs: number) {
  return {
    requests: count,
    hours: +((count * intervalMs) / 3600000).toFixed(2),
  };
}

// A row existing is not "warm" -- most rows without an object_key were only
// admission bookkeeping for images seen once, and those are what this
// exists to store.
export function needsWarming(entry?: { object_key?: string | null } | null) {
  return !entry?.object_key;
}

// Mirrors api/items.ts's own choice, so the object lands on the key the
// visitor's URL will ask for.
export function originFor(
  item: Partial<Pick<ColdItemRow, "img" | "full_img">> | null | undefined,
  tier: string,
): string | null {
  if (!item) return null;
  const url = tier === "lightbox" ? item.full_img || item.img : item.img;
  return url || null;
}

// The actual fetch/transform/S3-write loop, extracted so it has exactly one
// implementation regardless of what invokes it -- scripts/warm_image_cache.mts's
// runCli() and lib/cron/warm-image-cache.ts both supply their own dependencies
// and stopping conditions rather than each carrying their own copy.
//
// `commit: false` stops after planning -- the same dry-run contract the CLI
// has always had.
export async function warmBatch(opts: {
  sql: QuerySql;
  tier: WarmTier;
  sources: string[];
  limit?: number | null;
  commit: boolean;
  deps?: Partial<WarmDeps>;
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

  const cold = (await sql.query(coldItemsSql(), [
    tier,
    opts.sources,
  ])) as ColdItemRow[];

  const hosts = (await sql.query(
    `SELECT host, source, refill_per_sec FROM host_fetch_state`,
  )) as HostFetchRow[];
  const byHost: Record<string, HostFetchRow> = {};
  for (const h of hosts) byHost[h.host] = h;

  const work = limit ? cold.slice(0, limit) : cold;
  const perSource: Record<string, number> = {};
  for (const r of work) perSource[r.source] = (perSource[r.source] || 0) + 1;

  const intervals = work.map((r) => {
    const host = ((): string | null => {
      try {
        return new URL(originFor(r, tier) as string).host;
      } catch {
        return null;
      }
    })();
    return intervalMsFor(byHost[host ?? ""]);
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
      committed: false as const,
      workLength: work.length,
      // Only the preview needs the actual rows; the committed branch below
      // never returns them, since a real run can be thousands long.
      firstThree: work.slice(0, 3).map((r) => `${r.source}:${r.native_id}`),
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

  const { store, proxy, objectKey, s3, resolve } = deps as WarmDeps;
  const cfg = store.configFromEnv();
  if (!cfg.enabled) throw new Error("S3 is not configured -- refusing to run");

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

    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      skipped++;
      continue;
    }
    if (!isAllowedOrigin(row.source, tier, origin)) {
      skipped++;
      log(`  DISALLOWED ${row.source}:${row.native_id}`);
      continue;
    }
    const interval = intervalMsFor(byHost[host]);

    try {
      const { buf: raw, contentType } = await fetchOriginOnce(
        origin,
        row.source,
        tier,
        resolve,
      );

      const out = await proxy.transformForTier(raw, contentType, tier);
      const body = bufferFrom(out);
      const type = (!Buffer.isBuffer(out) && out.contentType) || contentType;

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
      await sql.query(store.recordObjectSql(), [
        cacheKey,
        key,
        hash,
        body.length,
      ]);

      done++;
      breaker.succeed();
      bytesTotal += body.length;
      if (done % 25 === 0) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        log(`  ${done}/${work.length} warmed, ${failed} failed, ${mins} min`);
      }
    } catch (err) {
      failed++;
      breaker.fail();
      log(
        `  ERR ${row.source}:${row.native_id} -- ${String((err instanceof Error && err.message) || err)}`,
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
    committed: true as const,
    workLength: work.length,
    firstThree: [] as string[],
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
