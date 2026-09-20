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
//
// The shared decisions and the warmBatch() loop itself live in
// lib/img-warm.ts, not here -- lib/cron/warm-image-cache.ts (a deployed
// Vercel function) needs them too, and scripts/ isn't part of any function
// bundle, so a shared dependency has to live on the lib/ side of that line.
// Re-exported below so existing imports of this module keep working.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sourcesToWarm, warmBatch } from "../lib/img-warm.ts";

export * from "../lib/img-warm.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

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
