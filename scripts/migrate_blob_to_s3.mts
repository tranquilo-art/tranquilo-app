#!/usr/bin/env node
// move whatever is still in Vercel Blob into S3, in three phases.
//
//   1. list      enumerate Blob, write the manifest, and stop
//   2. download  fetch each object to ./imgs/ using the manifest
//   3. upload    PUT each into S3 under its FINAL content-addressed key
//
// Separate commands on purpose: listing is cheap and the manifest is the
// durable artifact, downloading is the expensive interruptible part, and
// uploading must resume after a failure without re-downloading.
//
// Needs a real BLOB_READ_WRITE_TOKEN -- a placeholder value returns
// BlobAccessError from `list`, which isn't evidence the store is paused.
// The Blob quota is exhausted and `list` bills against it (one call per
// 1,000 objects); whether `download`'s plain fetch also bills is
// unverified, so check before running it at scale.
//
// The final S3 key is not the Blob pathname -- keys are content-addressed
// (objectKeyFor with contentHash(bytes)), so the name is only knowable
// after the bytes are in hand, which is why renaming happens at upload
// time and a re-download lands on the same key rather than orphaning a copy.
//
// Usage:
//   node scripts/migrate_blob_to_s3.mts list
//   node scripts/migrate_blob_to_s3.mts download
//   node scripts/migrate_blob_to_s3.mts upload            # dry run
//   node scripts/migrate_blob_to_s3.mts upload --commit
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import * as objectKeys from "../lib/img-object-key.ts";
import * as s3 from "../lib/img-s3.ts";
import * as store from "../lib/img-store.ts";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const MANIFEST = "review/blob-migration-manifest.json";
const IMG_DIR = "imgs";
const cmd = process.argv[2];
const COMMIT = process.argv.includes("--commit");

function assertToken() {
  const t = process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!/^vercel_blob_rw_/.test(t)) {
    console.error(
      `BLOB_READ_WRITE_TOKEN does not look like a Vercel Blob token ` +
        `(got ${t.length} chars: ${JSON.stringify(t.slice(0, 12))}).\n` +
        `Pull a real one from the Vercel dashboard before running this.`,
    );
    process.exit(1);
  }
}

// Blob pathnames are "img-cache/<source>/<id>/<tier>.<ext>" -- see
// pathnameFor() in the image route. Parsed rather than guessed so a shape
// change fails loudly here instead of writing objects under a wrong key.
function parseBlobPathname(pathname: string) {
  // No extension: real pathnames are "img-cache/<source>/<id>/<tier>",
  // confirmed against the live store (1,258 of 1,258).
  const m = /^img-cache\/([^/]+)\/(.+)\/([^/]+?)(?:\.[^./]+)?$/.exec(pathname);
  if (!m) return null;
  return { source: m[1], id: m[2], tier: m[3] };
}

interface BlobManifestItem {
  pathname: string;
  url: string;
  size: number;
  source: string | null;
  id: string | null;
  tier: string | null;
  unparsed: boolean;
}

async function doList() {
  assertToken();
  const { list } = await import("@vercel/blob");
  const items: BlobManifestItem[] = [];
  let cursor: any;
  do {
    const page = await list({ prefix: "img-cache/", cursor, limit: 1000 });
    for (const b of page.blobs) {
      const parsed = parseBlobPathname(b.pathname);
      items.push({
        pathname: b.pathname,
        url: b.url,
        size: b.size,
        source: parsed?.source ?? null,
        id: parsed?.id ?? null,
        tier: parsed?.tier ?? null,
        unparsed: !parsed,
      });
    }
    cursor = page.cursor;
  } while (cursor);

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(items, null, 2)}\n`);

  const bytes = items.reduce((a, i) => a + (i.size || 0), 0);
  const unparsed = items.filter((i) => i.unparsed).length;
  console.log(
    `listed ${items.length} object(s), ${(bytes / 1e6).toFixed(1)} MB`,
  );
  if (unparsed)
    console.log(
      `  WARNING: ${unparsed} pathname(s) did not parse -- inspect before uploading`,
    );
  console.log(`manifest written to ${MANIFEST}`);
}

function readManifest(): BlobManifestItem[] {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`no manifest at ${MANIFEST}. Run "list" first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

function localPathFor(item: BlobManifestItem) {
  // Flat, and keyed on the Blob pathname so it is unambiguous and resumable.
  return path.join(IMG_DIR, item.pathname.replace(/\//g, "__"));
}

async function doDownload() {
  const items = readManifest();
  fs.mkdirSync(IMG_DIR, { recursive: true });
  let got = 0,
    skipped = 0,
    failed = 0;
  for (const item of items) {
    const dest = localPathFor(item);
    if (fs.existsSync(dest) && fs.statSync(dest).size === item.size) {
      skipped++;
      continue;
    }
    try {
      // The public blob URL rather than the SDK -- believed to bill as
      // bandwidth rather than a Simple Operation, but unverified; worth
      // confirming before running this at scale on an exhausted quota.
      const res = await fetch(item.url);
      if (!res.ok) {
        console.error(`  ${res.status} ${item.pathname}`);
        failed++;
        continue;
      }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      got++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`  FAILED ${item.pathname}: ${message}`);
      failed++;
    }
    if ((got + skipped + failed) % 100 === 0)
      console.log(`  ${got + skipped + failed}/${items.length}`);
  }
  console.log(
    `downloaded ${got}, already present ${skipped}, failed ${failed}`,
  );
}

async function doUpload() {
  const items = readManifest();
  const cfg = store.configFromEnv();
  if (!cfg.enabled) {
    console.error(
      "S3 is not configured (need S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, IMG_CDN_BASE_URL)",
    );
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL!);

  let planned = 0,
    done = 0,
    missing = 0,
    failed = 0;
  for (const item of items) {
    if (item.unparsed) {
      missing++;
      continue;
    }
    const local = localPathFor(item);
    if (!fs.existsSync(local)) {
      missing++;
      continue;
    }
    const buf = fs.readFileSync(local);

    // The final name. Content-addressed, so it depends on the bytes and can
    // only be computed here -- this is the "rename" step.
    const hash = objectKeys.contentHash(buf);
    const objectKey = objectKeys.objectKeyFor(
      item.source,
      item.id,
      item.tier,
      hash,
    );
    planned++;
    if (!COMMIT) {
      if (planned <= 5) console.log(`  ${item.pathname}\n    -> ${objectKey}`);
      continue;
    }
    const contentType = item.pathname.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
    const put = await s3.putObject(cfg, objectKey, buf, contentType);
    if (!put.ok) {
      console.error(`  PUT failed ${objectKey}: ${put.status}`);
      failed++;
      continue;
    }
    // Recorded only after a successful PUT -- the same ordering the image
    // route relies on when it trusts a key without an existence check.
    await store.recordObject(
      sql,
      `${item.source}:${item.id}:${item.tier}`,
      objectKey,
      hash,
      buf.length,
    );
    done++;
  }
  if (!COMMIT) {
    console.log(
      `\nDRY RUN -- ${planned} object(s) would be uploaded and recorded.`,
    );
    console.log(
      `${missing} not downloaded yet. Re-run with --commit to apply.`,
    );
    return;
  }
  console.log(`uploaded ${done}, missing locally ${missing}, failed ${failed}`);
}

const commands: Record<string, () => Promise<void>> = {
  list: doList,
  download: doDownload,
  upload: doUpload,
};
if (!commands[cmd]) {
  console.error(
    "usage: migrate_blob_to_s3.mts <list|download|upload> [--commit]",
  );
  process.exit(1);
}
await commands[cmd]();
