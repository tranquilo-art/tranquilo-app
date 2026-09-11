#!/usr/bin/env node
//
// Freeze the artist name -> canonical name mapping. A one-time merge fixed
// the catalogue as it stood; ingestion needs the same rule applied to
// arriving items, or the next pull re-splits every artist just merged.
//
// The mapping is frozen, not recomputed: the canonical name is chosen from
// what the catalogue already holds, which moves as items arrive, so a live
// computation would let a byline change under a visitor mid-push. Re-run
// this deliberately when a refresh is wanted.
//
//   node scripts/build_artist_canonical_map.mts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ULAN = path.join(ROOT, "data/reference/ulan-artists.json");
const OUT = path.join(ROOT, "data/reference/artist-canonical.json");

for (const l of fs
  .readFileSync(path.join(ROOT, ".env.local"), "utf8")
  .split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const sql = neon(process.env.DATABASE_URL!);

// The same rule as scripts/merge_artist_names.mts, kept identical -- if the
// two drift, ingestion writes one name and the merge writes another.
const diacritics = (s: string) =>
  (s.normalize("NFD").match(/[̀-ͯ]/g) || []).length;
const bare = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function ourChoice(rows: any[]) {
  const sorted = rows
    .slice()
    .sort(
      (a: any, b: any) =>
        b.n - a.n ||
        diacritics(b.artist) - diacritics(a.artist) ||
        b.artist.length - a.artist.length,
    );
  const top = sorted[0];
  const better = sorted.find(
    (r: any) =>
      bare(r.artist) === bare(top.artist) &&
      diacritics(r.artist) > diacritics(top.artist),
  );
  return (better || top).artist;
}

interface ArtistInfo {
  ambiguous?: boolean;
  ulan_id: string;
  variants?: string[];
}

const { artists } = JSON.parse(fs.readFileSync(ULAN, "utf8")) as {
  artists: Record<string, ArtistInfo>;
};

// Grouped from `artists` (every name that matched ULAN unambiguously), not
// from `merges` (only subjects still split at extraction time) -- a
// previously-split artist collapses to one spelling once canonicalisation
// works, so `merges` silently drops it on a later extraction, and a rebuild
// sourced from `merges` alone would un-map it the moment the fix succeeded.
// Grouping by ulan_id keeps its protection regardless.
const byId = new Map<
  string,
  { ourNames: Set<string>; variants: Set<string> }
>();
for (const [name, info] of Object.entries(artists)) {
  if (info.ambiguous) continue; // no single subject to canonicalise toward
  let g = byId.get(info.ulan_id);
  if (!g) {
    g = { ourNames: new Set(), variants: new Set() };
    byId.set(info.ulan_id, g);
  }
  g.ourNames.add(name);
  for (const v of info.variants || []) g.variants.add(v);
}

const map: Record<string, string> = {};
let groups = 0;

for (const g of byId.values()) {
  const ourNames = [...g.ourNames];
  const rows = await sql.query(
    `SELECT artist, count(*)::int n FROM items
      WHERE artist = ANY($1) AND review_status NOT IN ('quarantined','rejected')
      GROUP BY 1`,
    [ourNames],
  );
  const canonical = rows.length ? ourChoice(rows) : null;
  if (!canonical) continue;
  groups++;
  // Every variant ULAN knows for this subject maps to the canonical form,
  // not just spellings we currently hold -- an unseen variant is exactly
  // what the next pull will deliver.
  for (const v of g.variants) map[v] = canonical;
  for (const n of ourNames) map[n] = canonical;
}

fs.writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`);
console.log(`${groups} group(s) -> ${Object.keys(map).length} name(s) mapped`);
console.log(`written to ${path.relative(ROOT, OUT)}`);
console.log(
  `\nspot check: "Rijn, Rembrandt van" -> ${map["Rijn, Rembrandt van"]}`,
);
console.log(`spot check: "Edouard Manet"       -> ${map["Edouard Manet"]}`);
