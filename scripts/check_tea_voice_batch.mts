#!/usr/bin/env node
//
// Check a drafted Tea Voice batch before a human sees it.
//
// Mechanical faults -- fabricated links, a caption that assumed feed order --
// never need a human's judgement to catch. Review time is the cost that
// scales worst, so everything catchable is caught here.
//
// Draft format: JSON array, each entry { source, native_id, caption_tea,
// tea_voice_claims: [{ text, source_url }] }.
//
//   node scripts/check_tea_voice_batch.mts review/tea-voice/draft.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import * as check from "../lib/tea-voice-check.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = process.argv[2];
if (!file) {
  console.error("usage: check_tea_voice_batch.mts <draft.json>");
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

const drafts = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const keys = drafts.map((d: any) => `${d.source}:${d.native_id}`);

// The stored url is the authority. Fetched fresh rather than trusted from the
// draft -- the whole point is that the draft's links cannot be believed.
const rows = await sql.query(
  `SELECT source, native_id, title, url FROM items
    WHERE source || ':' || native_id = ANY($1)`,
  [keys],
);
const byKey = new Map(rows.map((r) => [`${r.source}:${r.native_id}`, r]));

let errors = 0,
  warnings = 0;
for (const d of drafts) {
  const key = `${d.source}:${d.native_id}`;
  const item = byKey.get(key);
  if (!item) {
    console.log(`\n${key}\n  ERROR   no such item in the catalogue`);
    errors++;
    continue;
  }
  const found = check.checkItem(d, item);
  if (!found.length) {
    console.log(`\n${key}  ${item.title.slice(0, 44)}\n  ok`);
    continue;
  }
  console.log(`\n${key}  ${item.title.slice(0, 44)}`);
  for (const f of found) {
    console.log(
      `  ${f.level === "error" ? "ERROR  " : "warning"} ${f.message}`,
    );
    if (f.level === "error") errors++;
    else warnings++;
  }
}

console.log(
  `\n${drafts.length} item(s): ${errors} error(s), ${warnings} warning(s)`,
);
if (errors) {
  console.log(
    "Errors are factual and block the batch. Fix before a human reads it.",
  );
  process.exit(1);
}
