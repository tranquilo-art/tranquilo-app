#!/usr/bin/env node
//
// Apply a reviewed vibe-tag batch to items.vibe_tags.
//
// TRA-274 Phase 3. The reviewed batch file IS the input -- a human has
// already edited it directly (corrected a tag, deleted an entry to skip
// it), so this writes exactly what's in the file, nothing re-derived.
// Same "no second copy to drift" discipline as artscroll-poc's own
// apply_tea_voice_batch.py.
//
// Every id must resolve to a live item and every tag must be in the
// closed vocabulary, or the WHOLE batch is refused -- re-validated here
// independently of check_vibe_tag_batch.mts (see lib/vibe-tag-batch.ts's
// planApply(), shared by neither script's own trust of the other having
// run), since a script that writes should never assume a check ran
// first. Writes an audit file (every row's previous vibe_tags value)
// before the update, so a bad batch can be undone exactly.
//
//   node scripts/apply_vibe_tag_batch.mts <path/to/vibe_tag_candidates_*.json>             # dry run
//   node scripts/apply_vibe_tag_batch.mts <path/to/vibe_tag_candidates_*.json> --commit

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { planApply } from "../lib/vibe-tag-batch.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_DIR = path.join(ROOT, "data/reference/vibe-tag-audits");

const file = process.argv[2];
const COMMIT = process.argv.includes("--commit");
if (!file) {
  console.error(
    "usage: apply_vibe_tag_batch.mts <path/to/vibe_tag_candidates_*.json> [--commit]",
  );
  process.exit(2);
}

for (const l of fs
  .readFileSync(path.join(ROOT, ".env.local"), "utf8")
  .split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const batchPath = path.resolve(file);
  const batch = JSON.parse(fs.readFileSync(batchPath, "utf8"));
  const candidates = batch.candidates || [];
  console.log(
    `${candidates.length} candidate(s) in ${path.relative(ROOT, batchPath)}`,
  );

  if (!candidates.length) {
    console.log("Nothing to apply.");
    return;
  }

  const ids = candidates.map((c: any) => c.id);
  const rows = await sql.query(
    `SELECT id, vibe_tags, review_status FROM items WHERE id = ANY($1)`,
    [ids],
  );
  const byId = new Map(rows.map((r: any) => [r.id, r]));

  const { plan, problems } = planApply(candidates, byId);
  if (problems.length) {
    console.log(`\nRefusing the whole batch -- ${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    console.log(
      "\nRun check_vibe_tag_batch.mts and fix these in the batch file itself.",
    );
    process.exit(1);
  }

  const withVibe = plan.filter((p) => p.vibeTags.length > 0).length;
  const noVibe = plan.length - withVibe;
  console.log(
    `${withVibe} item(s) get a real vibe tag, ${noVibe} get [] (reviewed, none applied).`,
  );

  if (!COMMIT) {
    console.log("\nDRY RUN -- nothing written. Re-run with --commit.");
    return;
  }

  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  const auditPath = path.join(
    AUDIT_DIR,
    `${path.basename(batchPath, ".json")}.applied.json`,
  );
  fs.writeFileSync(
    auditPath,
    `${JSON.stringify(
      {
        applied_at: new Date().toISOString(),
        source_batch: path.relative(ROOT, batchPath),
        rows: plan.map((p) => ({
          id: p.id,
          previous_vibe_tags: p.previous,
          new_vibe_tags: p.vibeTags,
        })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `audit written: ${plan.length} row(s) recorded in ${path.relative(ROOT, auditPath)}`,
  );

  let updated = 0;
  for (const p of plan) {
    const res = await sql.query(
      `UPDATE items SET vibe_tags = $1 WHERE id = $2 RETURNING 1`,
      [p.vibeTags, p.id],
    );
    updated += res.length;
  }
  console.log(`${updated} row(s) updated.`);
}

main().catch((e) => {
  console.error("FATAL", e?.message || e);
  process.exit(1);
});
