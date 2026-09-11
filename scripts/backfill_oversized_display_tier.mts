#!/usr/bin/env node
// shrink display-tier objects that predate the 1600px/WebP cap
// (transformForTier() in api/img/[source]/[id]/[tier].js) down to what a
// new write would produce today.
//
// Reads existing bytes back out of our own S3 bucket, never the source
// institution -- load-bearing for Commons, which is under a standing hold
// that rules out any server-side re-fetch.
//
// Content-addressed like every write here: downscaled bytes land under a
// new key, so nothing already browser/CDN-cached breaks -- it just keeps
// pointing at the old, larger object, which becomes an orphan rather than
// a corruption. img_cache_entries.object_key updates so the next hit
// resolves at the new key.
//
// Usage:
//   node scripts/backfill_oversized_display_tier.mts            # dry run
//   node scripts/backfill_oversized_display_tier.mts --commit
//   node scripts/backfill_oversized_display_tier.mts --commit --threshold=500000
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import sharp from "sharp";
import * as objectKeys from "../lib/img-object-key.ts";
import * as s3 from "../lib/img-s3.ts";
import * as store from "../lib/img-store.ts";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Mirrors api/img/[source]/[id]/[tier].js exactly -- produces what a fresh
// write would already produce, not a different policy.
const DISPLAY_MAX_DIMENSION = 1600;
const DISPLAY_WEBP_QUALITY = 82;

const COMMIT = process.argv.includes("--commit");
const thresholdArg = process.argv.find((a) => a.startsWith("--threshold="));
const THRESHOLD_BYTES = thresholdArg
  ? Number(thresholdArg.split("=")[1])
  : 1_000_000;

async function main() {
  const cfg = store.configFromEnv();
  if (!cfg.enabled) {
    console.error(
      "S3 is not configured (need S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, IMG_CDN_BASE_URL)",
    );
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL!);

  const rows = await sql`
    SELECT c.cache_key, c.object_key, c.bytes AS old_bytes,
           i.source, i.native_id
    FROM img_cache_entries c
    JOIN items i ON c.cache_key = i.source || ':' || i.native_id || ':' || c.tier
    WHERE c.tier = 'display' AND c.bytes > ${THRESHOLD_BYTES}
    ORDER BY c.bytes DESC
  `;

  console.log(
    `${rows.length} display object(s) over ${THRESHOLD_BYTES} bytes.\n`,
  );

  let shrunk = 0,
    skipped = 0,
    failed = 0,
    totalOldBytes = 0,
    totalNewBytes = 0;

  for (const row of rows) {
    totalOldBytes += Number(row.old_bytes);
    const label = `${row.cache_key} (${row.old_bytes} bytes)`;

    const got = await s3.getObject(cfg, row.object_key);
    if (!got.ok) {
      console.error(`  FAILED to read ${label}: status ${got.status}`);
      failed++;
      continue;
    }

    let newBuf: any, newContentType: any;
    try {
      const webpBuf = await sharp(got.body)
        .resize({
          width: DISPLAY_MAX_DIMENSION,
          height: DISPLAY_MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: DISPLAY_WEBP_QUALITY })
        .toBuffer();
      newBuf = webpBuf;
      newContentType = "image/webp";
    } catch (encodeErr) {
      const message =
        encodeErr instanceof Error ? encodeErr.message : String(encodeErr);
      console.error(
        `  SKIPPED ${label}: Sharp could not decode it (${message})`,
      );
      skipped++;
      continue;
    }

    if (newBuf.length >= Number(row.old_bytes)) {
      // Same guard transformForTier() applies on a fresh write: never store
      // something bigger than what's already there.
      console.log(
        `  SKIPPED ${label}: re-encode (${newBuf.length}b) is not smaller`,
      );
      skipped++;
      totalNewBytes += Number(row.old_bytes);
      continue;
    }

    const hash = objectKeys.contentHash(newBuf);
    const newKey = objectKeys.objectKeyFor(
      row.source,
      row.native_id,
      "display",
      hash,
    );
    totalNewBytes += newBuf.length;

    console.log(`  ${label} -> ${newBuf.length}b (${newKey})`);
    if (!COMMIT) {
      shrunk++;
      continue;
    }

    const put = await s3.putObject(cfg, newKey, newBuf, newContentType);
    if (!put.ok) {
      console.error(`    PUT failed: status ${put.status}`);
      failed++;
      continue;
    }
    const recorded = await store.recordObject(
      sql,
      row.cache_key,
      newKey,
      hash,
      newBuf.length,
    );
    if (!recorded) {
      console.error(
        `    PUT succeeded but recordObject() failed -- object is in S3 under ${newKey} ` +
          `but img_cache_entries still points at the old key. Safe: the old object still serves; ` +
          `re-run this script to retry the bookkeeping (content-addressing means it lands on the ` +
          `same key, not a third copy).`,
      );
      failed++;
      continue;
    }
    shrunk++;
  }

  console.log(
    `\n${COMMIT ? "" : "DRY RUN -- "}${shrunk} would shrink, ${skipped} skipped, ${failed} failed.`,
  );
  console.log(
    `Total: ${totalOldBytes} -> ${totalNewBytes} bytes ` +
      `(${totalOldBytes ? Math.round(100 * (1 - totalNewBytes / totalOldBytes)) : 0}% reduction).`,
  );
  if (!COMMIT) console.log("Re-run with --commit to apply.");
}

await main();
