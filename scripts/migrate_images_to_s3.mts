// copy every cached image from Vercel Blob into S3.
//
// Runs locally and must: Vercel Hobby caps at 12 functions and api/ is
// already at 12, and the object count won't fit a serverless invocation.
//
//   node scripts/migrate_images_to_s3.mts              # dry run, writes nothing
//   node scripts/migrate_images_to_s3.mts --commit     # actually copies
//   node scripts/migrate_images_to_s3.mts --commit --limit 20
//
// Copies from the Blob object's public URL, never re-fetches from the
// source institution (thousands of origin fetches from one IP is exactly
// how bvpb.mcu.es 429s and the Met bot-challenges us). Reading via the
// public URL is CDN egress, not a Blob Simple Operation, so this costs S3
// PUTs and roughly zero Blob operations -- deleting from Blob afterwards
// does cost one each, hence that being a separate, later, paced pass.
//
// Idempotent by construction: keys are content-addressed, so a crash
// between the PUT and the database write just means the next run re-PUTs
// the same object to the same key and records it -- wasteful, never wrong.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, neonConfig } from "@neondatabase/serverless";
import * as objectKeys from "../lib/img-object-key.ts";
import * as s3 from "../lib/img-s3.ts";
import * as store from "../lib/img-store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
neonConfig.webSocketConstructor = WebSocket;

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i !== -1 && argv[i + 1] ? parseInt(argv[i + 1], 10) : null;
})();

// CONCURRENCY bounds memory (images average 245 KB, so a wide pool adds up)
// and politeness toward the Blob CDN. DB_BATCH is the real win: recording
// one row at a time is ~1,200 Neon round trips vs. roughly a dozen batched.
const CONCURRENCY = 10;
const DB_BATCH = 200;

// .env.local first, then the real environment on top -- S3 credentials live
// in Vercel and shouldn't be written to disk just to run a migration, so
// they're supplied for the length of one command instead.
function env(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (_err) {
    /* no .env.local is fine if the environment carries it all */
  }
  for (const k of [
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "IMG_CDN_BASE_URL",
    "DATABASE_URL",
    "BLOB_READ_WRITE_TOKEN",
  ]) {
    // "[SENSITIVE]" is `vercel env pull`'s placeholder for a sensitive var,
    // not a value -- letting it override a real local value fails baffling
    // and far away.
    const v = process.env[k];
    if (v && v !== "[SENSITIVE]") out[k] = v;
  }
  return out;
}

interface ImgCacheRow {
  cache_key: string;
  source: string;
  native_id: string;
  tier: string;
  bytes: unknown;
}

async function main() {
  const e = env();
  const config = store.configFromEnv(e);
  if (!config.enabled) {
    console.error(
      "S3 is not fully configured in .env.local -- need S3_BUCKET, " +
        "S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, IMG_CDN_BASE_URL",
    );
    process.exit(1);
  }

  const db = new Client(e.DATABASE_URL);
  await db.connect();

  // Only entries actually stored in Blob and not yet in S3 -- bytes IS NULL
  // means seen but never admitted, nothing to copy.
  const { rows } = await db.query<ImgCacheRow>(
    `SELECT cache_key, source, native_id, tier, bytes
       FROM img_cache_entries
      WHERE bytes IS NOT NULL
        AND object_key IS NULL
      ORDER BY cache_key${LIMIT ? ` LIMIT ${LIMIT}` : ""}`,
  );

  console.log(
    `${COMMIT ? "COPYING" : "DRY RUN"} -- ${rows.length} object(s) to migrate`,
  );
  console.log(`  bucket ${config.bucket} (${config.region})`);
  console.log(`  cdn    ${config.cdnBaseUrl}`);
  if (!rows.length) {
    await db.end();
    return;
  }

  // Derive the Blob public base from BLOB_STORE_ID rather than head()ing
  // each object (~1,200 Blob operations against the very quota this
  // migration exists to escape). The proxy writes with
  // addRandomSuffix:false, so a pathname maps deterministically to one
  // blob, and a store's public host is just its id -- not secret, since it
  // appears in every public image URL the site serves.
  const storeId = String(e.BLOB_STORE_ID || "").replace(/^store_/, "");
  if (!storeId) {
    console.error(
      "  BLOB_STORE_ID missing from .env.local -- cannot derive the Blob base",
    );
    await db.end();
    process.exit(1);
  }
  const blobBase = `https://${storeId}.public.blob.vercel-storage.com`;
  console.log(`  blob   ${blobBase}  (derived, 0 Blob operations)\n`);

  const stats = { copied: 0, skipped: 0, failed: 0, bytes: 0 };
  // rows awaiting a batched DB write
  const pending: { cacheKey: string; objectKey: string; hash: string }[] = [];

  async function flush() {
    if (!pending.length || !COMMIT) {
      pending.length = 0;
      return;
    }
    // SPLICE the batch out before awaiting, rather than clearing afterwards
    // -- ten workers share this array, and clearing after the await once
    // discarded 107 objects pushed during it (they were in S3; the database
    // just never heard about them).
    const batch = pending.splice(0, pending.length);
    // One statement, many rows: unnest the arrays and join on cache_key.
    await db.query(
      `UPDATE img_cache_entries AS e
          SET object_key = v.object_key,
              content_hash = v.content_hash,
              object_written_at = now()
         FROM (SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
                 AS t(cache_key, object_key, content_hash)) AS v
        WHERE e.cache_key = v.cache_key`,
      [
        batch.map((p) => p.cacheKey),
        batch.map((p) => p.objectKey),
        batch.map((p) => p.hash),
      ],
    );
  }

  async function migrate(row: ImgCacheRow) {
    // The Blob pathname the object was written under, reproduced exactly,
    // since it addresses objects that already exist.
    const pathname = objectKeys.legacyBlobPathname(
      row.source,
      row.native_id,
      row.tier,
    );
    const url = blobBase ? `${blobBase}/${pathname}` : null;
    if (!url) {
      stats.skipped++;
      return;
    }

    const res = await fetch(url);
    if (!res.ok) {
      stats.failed++;
      console.error(`  MISS ${res.status}  ${row.cache_key}`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = objectKeys.contentHash(buf);
    const objectKey = objectKeys.objectKeyFor(
      row.source,
      row.native_id,
      row.tier,
      hash,
    );
    const contentType = res.headers.get("content-type") || "image/jpeg";

    if (!COMMIT) {
      stats.copied++;
      stats.bytes += buf.length;
      if (stats.copied <= 5) console.log(`  would write ${objectKey}`);
      return;
    }

    const put = await s3.putObject(config, objectKey, buf, contentType);
    if (!put.ok) {
      stats.failed++;
      console.error(`  PUT ${put.status}  ${objectKey}`);
      return;
    }
    stats.copied++;
    stats.bytes += buf.length;
    pending.push({ cacheKey: row.cache_key, objectKey, hash });
    if (pending.length >= DB_BATCH) await flush();
  }

  // Bounded worker pool over a shared cursor.
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const i = next++;
        if (i >= rows.length) return;
        try {
          await migrate(rows[i]);
        } catch (err) {
          stats.failed++;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  ERR ${rows[i].cache_key}: ${message}`);
        }
        if (i % 100 === 0 && i) process.stdout.write(`  ...${i}\n`);
      }
    }),
  );
  await flush();

  console.log(
    `\n  copied ${stats.copied}  failed ${stats.failed}  skipped ${stats.skipped}` +
      `  (${(stats.bytes / 1e6).toFixed(1)} MB)`,
  );
  if (!COMMIT)
    console.log("  dry run -- nothing written. Re-run with --commit.");
  await db.end();
}

await main();
