#!/usr/bin/env node
//
// Apply the ULAN name merges to items.artist.
//
// Our catalogue holds one artist under several spellings, and `artist` is
// compared by exact string in four places (declusterOrder, ?artist=, the
// facet pool, the byline), so every one of them is wrong for a split
// artist. search_text is GENERATED ALWAYS from artist, so it regenerates
// itself with no separate step.
//
// What's lost is the source's exact spelling -- mitigated since every item
// links to its own object page, where the institution's wording is
// authoritative. --commit writes an audit file naming every row changed and
// its previous value, before the update runs, so the merge can be undone
// exactly.
//
//   node scripts/merge_artist_names.mts             # dry run
//   node scripts/merge_artist_names.mts --commit

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = path.join(ROOT, "data/reference/ulan-artists.json");
const AUDIT = path.join(ROOT, "data/reference/artist-merge-audit.json");
const COMMIT = process.argv.includes("--commit");
const USE_ULAN = process.argv.includes("--ulan-names");

const diacritics = (s: string) =>
  (s.normalize("NFD").match(/[\u0300-\u036f]/g) || []).length;
const bare = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Most-used spelling wins, except when two spellings differ only in
// accents -- there, counting would entrench a typo ("Edouard Manet" beating
// "Édouard Manet"), so the accented form wins outright.
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
  const sameNameBetterAccents = sorted.find(
    (r: any) =>
      bare(r.artist) === bare(top.artist) &&
      diacritics(r.artist) > diacritics(top.artist),
  );
  return (sameNameBetterAccents || top).artist;
}

for (const line of fs
  .readFileSync(path.join(ROOT, ".env.local"), "utf8")
  .split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const { merges } = JSON.parse(fs.readFileSync(STORE, "utf8"));
  const groups = (merges || []).filter((g: any) => g.ourNames.length > 1);
  console.log(`${groups.length} merge group(s) from ULAN\n`);

  const plan = [];
  for (const g of groups) {
    const rows = await sql(
      `SELECT artist, count(*)::int n FROM items
        WHERE artist = ANY($1) AND review_status NOT IN ('quarantined','rejected')
        GROUP BY 1 ORDER BY 2 DESC`,
      [g.ourNames],
    );
    if (!rows.length) continue;

    // ULAN is authoritative on grouping, not on display -- its preferred
    // form is a cataloguing convention, often worse to read (drops accents,
    // hyphens, capitalises particles). The canonical name is ours: the
    // spelling shown most often, ties to more diacritics then longer.
    // --ulan-names switches to ULAN's preference instead.
    const canonical =
      USE_ULAN && g.preferredName ? g.preferredName : ourChoice(rows);
    if (!canonical) continue;
    const total = rows.reduce((a, r) => a + r.n, 0);
    const changing = rows.filter((r) => r.artist !== canonical);
    plan.push({
      ulan_id: g.subjectId,
      canonical,
      total,
      alreadyCorrect: total - changing.reduce((a, r) => a + r.n, 0),
      changing: changing.map((r) => ({ from: r.artist, items: r.n })),
      newCanonical: !g.ourNames.includes(canonical),
    });
  }

  plan.sort((a, b) => b.total - a.total);
  const rowsChanging = plan.reduce(
    (a, p) => a + p.changing.reduce((s, c) => s + c.items, 0),
    0,
  );
  const newNames = plan.filter((p) => p.newCanonical);

  console.log(`${plan.length} group(s) present in the catalogue`);
  console.log(`${rowsChanging} row(s) would have their artist rewritten\n`);

  for (const p of plan.slice(0, 12)) {
    console.log(
      `  ${p.canonical}   (${p.total} items)${p.newCanonical ? "   <- NEW byline, not a spelling we use" : ""}`,
    );
    for (const c of p.changing)
      console.log(`      ${String(c.items).padStart(3)}  ${c.from}`);
  }
  if (plan.length > 12)
    console.log(`  ... and ${plan.length - 12} more groups`);

  if (newNames.length) {
    console.log(
      `\n${newNames.length} group(s) adopt a canonical name we do NOT currently use.`,
    );
    console.log(
      "   Every item in those groups gets a byline no visitor has seen before:",
    );
    for (const p of newNames.slice(0, 8)) {
      console.log(
        `      ${p.canonical}   <- ${p.changing.map((c) => c.from).join(" / ")}`,
      );
    }
  }

  if (!COMMIT) {
    console.log("\nDRY RUN -- nothing written. Re-run with --commit.");
    return;
  }

  // Audit before the update: a merge that can't be undone shouldn't run
  // against thousands of rows.
  const before: {
    source: string;
    native_id: string;
    from: string;
    to: string;
  }[] = [];
  for (const p of plan) {
    for (const c of p.changing) {
      const rows = await sql(
        `SELECT source, native_id FROM items WHERE artist = $1`,
        [c.from],
      );
      rows.forEach((r) => {
        before.push({
          source: r.source,
          native_id: r.native_id,
          from: c.from,
          to: p.canonical,
        });
      });
    }
  }
  fs.writeFileSync(
    AUDIT,
    `${JSON.stringify(
      {
        applied_at: new Date().toISOString(),
        source: "Getty ULAN ulan_rel_0126 (ODC-BY 1.0)",
        rows: before,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `\naudit written: ${before.length} row(s) recorded in ${path.relative(ROOT, AUDIT)}`,
  );

  let updated = 0;
  for (const p of plan) {
    for (const c of p.changing) {
      const res = await sql(
        `UPDATE items SET artist = $1 WHERE artist = $2 RETURNING 1`,
        [p.canonical, c.from],
      );
      updated += res.length;
    }
  }
  console.log(`${updated} row(s) updated. search_text regenerates itself.`);
}

main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(1);
});
