#!/usr/bin/env node
//
// Re-encode display objects that predate the display transform. These are
// legacy pass-throughs cached before the resize-to-1600px+webp-q82
// transform existed, copied byte-for-byte by the S3 migration; since the
// transform only runs on a cache miss, an existing entry never gets one and
// stays oversized permanently.
//
// Safe against live traffic via content-addressing: the re-encoded bytes
// hash differently, landing on a new key while the old one stays in place,
// so every immutable browser-cached response keeps resolving. Reads only
// from our own S3 bucket, never Commons, so the Wikimedia rate-limit hold
// stays untouched.
//
//   node scripts/reencode_oversized_images.mts                  # dry run
//   node scripts/reencode_oversized_images.mts --commit
//   node scripts/reencode_oversized_images.mts --min-bytes 512000 --commit
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as objectKey from "../lib/img-object-key.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

export const DEFAULT_MIN_BYTES = 1024 * 1024; // 1 MB
// Proportional, not absolute, since a saving too small isn't worth a new
// object, a row update and an orphaned predecessor.
export const MIN_SAVING_FRACTION = 0.1;

export function isCandidate(entry: any, minBytes: any) {
  if (!entry?.bytes) return false;
  if ("object_key" in entry && !entry.object_key) return false;
  return Number(entry.bytes) > minBytes;
}

export function shouldReplace(beforeBytes: any, afterBytes: any) {
  if (!afterBytes || afterBytes >= beforeBytes) return false;
  return (beforeBytes - afterBytes) / beforeBytes >= MIN_SAVING_FRACTION;
}

export function summarise(results: any) {
  const objects = results.length;
  const savedBytes = results.reduce(
    (a: any, r: any) => a + (r.before - r.after),
    0,
  );
  const before = results.reduce((a: any, r: any) => a + r.before, 0);
  return {
    objects,
    savedBytes,
    pct: before ? +((100 * savedBytes) / before).toFixed(1) : 0,
  };
}

export function keyFor(source: any, nativeId: any, tier: any, hash: any) {
  return objectKey.objectKeyFor(source, nativeId, tier, hash);
}

// Only runs when invoked directly (`node scripts/reencode_oversized_images.mts`),
// not when imported for its pure functions.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  runCli();
}

async function runCli() {
  const fs = await import("node:fs");
  for (const line of fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }

  const { neon } = await import("@neondatabase/serverless");
  const proxy = await import(
    pathToFileURL(path.join(ROOT, "api/img/[source]/[id]/[tier].ts")).href
  );
  const store = await import(
    pathToFileURL(path.join(ROOT, "lib/img-store.ts")).href
  );
  const s3 = await import(pathToFileURL(path.join(ROOT, "lib/img-s3.ts")).href);

  const args = process.argv.slice(2);
  const optOf = (n: any, d: any) => {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? d : args[i + 1];
  };
  const COMMIT = args.includes("--commit");
  const MIN_BYTES = Number(optOf("min-bytes", DEFAULT_MIN_BYTES));
  const LIMIT = Number(optOf("limit", 0)) || null;

  const sql = neon(process.env.DATABASE_URL!);
  const cfg = store.configFromEnv();
  const kb = (n: any) => `${(n / 1024).toFixed(0)} kB`;

  async function main() {
    // Config is checked in the COMMIT path only -- a dry run is a database
    // question, and demanding S3 credentials for it would make the safe
    // mode harder to run than the dangerous one.
    let rows = await sql(
      `SELECT cache_key, source, native_id, tier, object_key, content_hash, bytes
         FROM img_cache_entries
        WHERE tier = 'display' AND bytes > $1 AND object_key IS NOT NULL
        ORDER BY bytes DESC`,
      [MIN_BYTES],
    );
    if (LIMIT) rows = rows.slice(0, LIMIT);

    console.log(
      `candidates over ${kb(MIN_BYTES)}:`,
      rows.length,
      "|",
      COMMIT ? "COMMIT" : "DRY RUN",
    );
    if (!rows.length) return;

    if (!COMMIT) {
      let total = 0;
      for (const r of rows.slice(0, 10)) {
        console.log(
          `  ${kb(r.bytes).padStart(8)}  ${r.source}:${String(r.native_id).slice(0, 50)}`,
        );
      }
      for (const r of rows) total += Number(r.bytes);
      console.log(
        `  ... ${rows.length} objects, ${(total / 1048576).toFixed(1)} MB total`,
      );
      console.log(
        "\nDRY RUN -- nothing fetched, nothing written. Re-run with --commit.",
      );
      return;
    }

    if (!cfg.enabled || !cfg.cdnBaseUrl) {
      throw new Error(
        "S3 is not configured locally. This needs S3_BUCKET, S3_REGION, " +
          "S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and IMG_CDN_BASE_URL in " +
          ".env.local -- they currently live only in Vercel. Do not paste them " +
          "into a chat; copy them from the Vercel dashboard.",
      );
    }

    const results = [];
    let skipped = 0,
      failed = 0;

    for (const r of rows) {
      try {
        // From OUR bucket via the CDN. Never from the institution.
        const res = await fetch(store.cdnUrlFor(cfg.cdnBaseUrl, r.object_key));
        if (!res.ok) {
          failed++;
          console.log(`  GET ${res.status} ${r.cache_key}`);
          continue;
        }
        const before = Buffer.from(await res.arrayBuffer());
        const contentType = res.headers.get("content-type") || "image/jpeg";

        const out = await proxy.transformForTier(
          before,
          contentType,
          "display",
        );
        const after = out.buf || out.buffer || before;
        const afterType = out.contentType || contentType;

        if (!shouldReplace(before.length, after.length)) {
          skipped++;
          console.log(
            `  skip  ${kb(before.length)} -> ${kb(after.length)}  ${r.cache_key}`,
          );
          continue;
        }

        const hash = objectKey.contentHash(after);
        const key = keyFor(r.source, r.native_id, "display", hash);
        const put = await s3.putObject(cfg, key, after, afterType);
        if (!put.ok) {
          failed++;
          console.log(`  PUT ${put.status} ${r.cache_key}`);
          continue;
        }

        // Only after the new object is definitely there -- if this fails the
        // row still points at the old object, which is correct and still serves.
        await sql(store.recordObjectSql(), [
          r.cache_key,
          key,
          hash,
          after.length,
        ]);

        results.push({ before: before.length, after: after.length });
        console.log(
          `  ok    ${kb(before.length)} -> ${kb(
            after.length,
          )}  (${afterType})  ${r.cache_key}`,
        );
      } catch (err) {
        failed++;
        console.log(
          `  ERR   ${r.cache_key} -- ${String(((err as any) && (err as any).message) || err)}`,
        );
      }
    }

    const s = summarise(results);
    console.log(
      `\nre-encoded ${s.objects} objects, saved ${(
        s.savedBytes / 1048576
      ).toFixed(1)} MB (${s.pct}%), ${skipped} skipped, ${failed} failed`,
    );
    console.log(
      "Old objects are left in place deliberately -- immutable responses " +
        "already in browser caches still resolve to them.",
    );
  }

  await main().catch((e: any) => {
    console.error("FATAL", e?.message || e);
    process.exit(1);
  });
}
