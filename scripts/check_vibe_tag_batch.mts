#!/usr/bin/env node
//
// Check a mined vibe-tag batch before a human reviews it.
//
// TRA-274 Phase 3. The batch file is produced by artscroll-poc's (private,
// separate repo) python/ingest/mine_vibe_tags.py -- it lives wherever that
// repo is checked out locally, so this takes an arbitrary path, same as
// check_tea_voice_batch.mts does for its own drafts.
//
// The reviewed file IS the input to apply_vibe_tag_batch.mts -- a human
// edits this JSON directly (correct a tag, or delete a candidate entry
// entirely to skip it), the same "no second copy to drift" discipline
// apply_tea_voice_batch.py's own header documents for its batches. This
// script only catches what doesn't need a human's judgement -- the actual
// checks live in lib/vibe-tag-batch.ts, tested there.
//
// Batch format: JSON object { candidates: [{ id, native_id, primary_vibe,
// secondary_vibes, confidence_reason, ... }] } -- see
// mine_vibe_tags.py's own output shape.
//
//   node scripts/check_vibe_tag_batch.mts <path/to/vibe_tag_candidates_*.json>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { checkCandidate, findDuplicateIds } from "../lib/vibe-tag-batch.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = process.argv[2];
if (!file) {
  console.error(
    "usage: check_vibe_tag_batch.mts <path/to/vibe_tag_candidates_*.json>",
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

const batch = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const candidates = batch.candidates || [];

if (!candidates.length) {
  console.log("0 candidates in this batch -- nothing to check.");
  process.exit(0);
}

// The stored row is the authority, fetched fresh -- same reasoning as
// check_tea_voice_batch.mts: the whole point of checking is that the
// batch's own claims cannot be trusted yet.
const ids = candidates.map((c: any) => c.id);
const rows = await sql.query(
  `SELECT id, native_id, title, review_status, vibe_tags FROM items WHERE id = ANY($1)`,
  [ids],
);
const byId = new Map(rows.map((r: any) => [r.id, r]));
const dupes = findDuplicateIds(candidates);

let errors = 0;
let warnings = 0;
for (const c of candidates) {
  const item = byId.get(c.id);
  const label = item
    ? item.title?.slice(0, 44) || "(untitled)"
    : "(no matching item)";
  console.log(`\n${c.id}  ${label}`);

  const findings = checkCandidate(c, item, dupes.has(c.id));
  for (const f of findings) {
    console.log(
      `  ${f.level === "error" ? "ERROR  " : "warning"} ${f.message}`,
    );
    if (f.level === "error") errors++;
    else warnings++;
  }
  if (!findings.length) console.log("  ok");
}

console.log(
  `\n${candidates.length} candidate(s): ${errors} error(s), ${warnings} warning(s)`,
);
if (errors) {
  console.log(
    "Errors are factual and block the batch. Fix (in the batch file itself) before a human reviews it.",
  );
  process.exit(1);
}
