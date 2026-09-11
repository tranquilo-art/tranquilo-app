#!/usr/bin/env node
//
// Derive artist identity from the Getty ULAN dump.
//
// Reads data/reference/raw/TERM.out -- 70 MB, 190 MB zipped, NOT committed --
// and writes the subset that concerns us: the artists actually in our
// catalogue, with their ULAN id, preferred name and every name variant.
//
// Licence: ODC-BY 1.0. Attribution required, unlike Wikidata's CC0.
//
//   node scripts/extract_ulan_artists.mts            # write the subset
//   node scripts/extract_ulan_artists.mts --dry-run  # report, write nothing

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import * as ulan from "../lib/ulan-extract.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const TERM_FILE = path.join(ROOT, "data/reference/raw/TERM.out");
const OUT = path.join(ROOT, "data/reference/ulan-artists.json");
const DRY = process.argv.includes("--dry-run");

async function ourArtists() {
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
        AND coalesce(artist,'') <> ''
        AND artist NOT ILIKE 'unknown%' AND artist NOT ILIKE 'anonymous%'
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  return rows;
}

async function main() {
  if (!fs.existsSync(TERM_FILE)) {
    throw new Error(
      "TERM.out not found. Unzip it from data/reference/raw/ulan_rel_0126.zip",
    );
  }
  const artists = await ourArtists();
  const names = artists.map((a) => a.artist);
  const counts = new Map(artists.map((a) => [a.artist, a.n]));
  console.log(`${names.length} attributed artist names in the catalogue`);

  // Only keep TERM rows whose normalised text is one of ours -- the dump
  // has millions of terms and we care about a few thousand.
  const wanted = new Set(names.map(ulan.normalise));
  const kept = [];
  let scanned = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(TERM_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    scanned++;
    const t = ulan.parseTermRow(line);
    if (t && wanted.has(ulan.normalise(t.term))) kept.push(t);
  }
  console.log(
    `scanned ${scanned.toLocaleString()} terms, kept ${kept.length} matching ours`,
  );

  // A second pass over the matched subjects, so every variant of a matched
  // artist is captured, not just the spellings we happen to use -- those
  // extras let a future ingestion recognise the same hand.
  const subjects = new Set(kept.map((t) => t.subjectId));
  const allTerms = [];
  const rl2 = readline.createInterface({
    input: fs.createReadStream(TERM_FILE, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl2) {
    const t = ulan.parseTermRow(line);
    if (t && subjects.has(t.subjectId)) allTerms.push(t);
  }
  console.log(
    `${subjects.size} ULAN subjects matched, ${allTerms.length} total variants`,
  );

  const index = ulan.buildIndex(allTerms);
  const out: Record<string, any> = {};
  let matched = 0,
    ambiguous = 0,
    missing = 0;
  for (const name of names) {
    const hit = ulan.lookup(index, name);
    if (!hit) {
      missing++;
      continue;
    }
    if (hit.ambiguous) {
      out[name] = {
        name,
        ambiguous: true,
        subjectIds: hit.subjectIds,
        items: counts.get(name),
      };
      ambiguous++;
      continue;
    }
    out[name] = {
      name,
      ulan_id: hit.subjectId,
      preferred_name: hit.preferredName,
      variants: hit.variants,
      items: counts.get(name),
    };
    matched++;
  }

  const groups = ulan
    .groupBySubject(index, names)
    .filter((g) => g.ourNames.length > 1);
  console.log(
    `\nmatched ${matched}, ambiguous ${ambiguous}, not in ULAN ${missing}`,
  );
  console.log(
    `${groups.length} name(s) in our catalogue are the SAME artist under different spellings:\n`,
  );
  for (const g of groups
    .sort(
      (a: any, b: any) =>
        b.ourNames.reduce((s: number, n: any) => s + (counts.get(n) || 0), 0) -
        a.ourNames.reduce((s: number, n: any) => s + (counts.get(n) || 0), 0),
    )
    .slice(0, 25)) {
    const total = g.ourNames.reduce(
      (s: number, n: any) => s + (counts.get(n) || 0),
      0,
    );
    console.log(`  ${g.preferredName || g.subjectId}  (${total} items)`);
    g.ourNames.forEach((n: any) => {
      console.log(`      ${String(counts.get(n)).padStart(3)}  ${n}`);
    });
  }

  if (DRY) {
    console.log("\nDRY RUN -- nothing written.");
    return;
  }
  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ merges: groups, artists: out }, null, 2)}\n`,
  );
  console.log(`\nwritten to ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(1);
});
