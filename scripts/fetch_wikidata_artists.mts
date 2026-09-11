#!/usr/bin/env node
//
// Fetch artist facts from Wikidata for the Tea Voice cluster worklist.
//
// Enforces the two conditions the Wikimedia hold was lifted under: every
// response is written to data/reference/wikidata-artists.json (committed;
// Wikidata is CC0) before the next request, with a miss recorded as an
// answer too so nothing is re-asked; and full compliance with their
// policy via a Wikimedia-shaped User-Agent, one query at a time with a 2s
// gap, Retry-After honoured, and a breaker that opens after 3 consecutive
// errors. The incident behind the hold was a script running 628 consecutive
// failures with no breaker -- this one stops at 3.
//
//   node scripts/fetch_wikidata_artists.mts --names "Edgar Degas,Odilon Redon"
//   node scripts/fetch_wikidata_artists.mts --clusters 5     # top 5 by size
//   node scripts/fetch_wikidata_artists.mts --dry-run
//
// Dry run prints the query and writes nothing, so the SPARQL can be reviewed
// before a single request is made.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import * as wd from "../lib/wikidata-client.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const STORE = path.join(ROOT, "data/reference/wikidata-artists.json");
const BATCH = 20; // names per query: one request answers a whole cluster tier

const args = process.argv.slice(2);
const opt = (n: string, d: any = null) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const DRY = args.includes("--dry-run");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}
function saveStore(store: any) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, `${JSON.stringify(store, null, 2)}\n`);
}

async function namesFromClusters(limit: number) {
  const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]])
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql.query(
    `SELECT artist, count(*)::int n FROM items
      WHERE review_status NOT IN ('quarantined','rejected')
        AND tea_voice_status = 'not_started' AND tea_voice_eligible
        AND coalesce(artist,'') <> ''
        AND artist NOT ILIKE 'unknown%' AND artist NOT ILIKE 'anonymous%'
      GROUP BY 1 HAVING count(*) >= 5 ORDER BY 2 DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.artist);
}

async function runQuery(names: string[], breaker: any) {
  const query = wd.artistQuery(names);
  // POST, not a GET query string, per Wikimedia's own guidance for
  // anything substantial. A network failure must count against the
  // breaker too, caught here rather than left to bubble -- an uncaught
  // throw skipping the error budget is exactly the accounting gap that let
  // a script run 628 consecutive failures.
  let res: any;
  try {
    res = await fetch(wd.ENDPOINT, {
      method: "POST",
      headers: {
        ...wd.requestHeaders(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query }),
      signal: AbortSignal.timeout(70000), // just past their 60s query timeout
    });
  } catch (err) {
    breaker.fail();
    const message = err instanceof Error ? err.message : err;
    console.log(
      `  network error: ${message} (consecutive: ${breaker.consecutive})`,
    );
    return null;
  }

  if (res.status === 429 || res.status === 503) {
    const wait = wd.retryAfterMs(res.headers) ?? 60000;
    console.log(
      `  ${res.status} — service asked us to wait ${(wait / 1000).toFixed(0)}s. Waiting.`,
    );
    breaker.fail();
    await sleep(wait);
    return null;
  }
  if (!res.ok) {
    breaker.fail();
    console.log(
      `  HTTP ${res.status} (consecutive errors: ${breaker.consecutive})`,
    );
    return null;
  }
  breaker.succeed();
  return wd.parseArtists(await res.json());
}

async function main() {
  let names: any;
  if (opt("names", null)) {
    names = opt("names")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
  } else {
    names = await namesFromClusters(Number(opt("clusters", 10)));
  }

  const store = loadStore();
  const todo = wd.namesToFetch(names, store);
  console.log(
    `${names.length} name(s) requested; ${names.length - todo.length} already stored; ${todo.length} to fetch`,
  );
  if (!todo.length) {
    console.log("Nothing to ask Wikimedia for.");
    return;
  }

  if (DRY) {
    console.log("\n--- SPARQL that would be sent ---\n");
    console.log(wd.artistQuery(todo.slice(0, BATCH)));
    console.log("\nDRY RUN — no request made, nothing written.");
    return;
  }

  const breaker = wd.makeBreaker();
  let fetched = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (breaker.tripped()) {
      console.log(
        `\nSTOPPED: ${wd.ERROR_LIMIT} consecutive errors. Not retrying.`,
      );
      break;
    }
    const batch = todo.slice(i, i + BATCH);
    console.log(`\nquery ${Math.floor(i / BATCH) + 1}: ${batch.length} names`);
    const rows = await runQuery(batch, breaker);
    if (rows) {
      const got = new Set(rows.map((r) => r.name));
      const misses = batch.filter((n) => !got.has(n));
      // Written before the next request, so a crash mid-run can't discard
      // what Wikimedia already answered.
      saveStore(wd.mergeStore(loadStore(), rows, misses));
      fetched += rows.length;
      console.log(
        `  ${rows.length} found, ${misses.length} not in Wikidata — saved`,
      );
    }
    if (i + BATCH < todo.length) await sleep(wd.MIN_INTERVAL_MS);
  }
  console.log(
    `\n${fetched} artist(s) stored in data/reference/wikidata-artists.json`,
  );
}

main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(1);
});
