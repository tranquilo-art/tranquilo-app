// Page through the entire catalogue over real HTTP. Earned its place after
// an earlier cursor implementation shipped that never advanced (every page
// returned the same rows -- an infinite scroll loop), missed by both a
// fixture comparison (exercises filtering, not paging) and a SQL-level
// page-through (built from the same datetime just read out of the row).
// The bug lived in the boundary neither crossed: the pg driver truncates to
// milliseconds via Date.toISOString() while Postgres stores microseconds,
// so `created_at > cursor` was true for the very row the cursor pointed at.
//
// The invariant is set equality, not page count: paging must yield exactly
// the set the unpaginated endpoint returns, each item once -- holds
// regardless of catalogue size or limit, so it never needs re-baselining.
//
// Run:  node scripts/verify_pagination.mts
//       node scripts/verify_pagination.mts --api http://localhost:3000/api/items
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveApi, fetchManifest } = await import(
  path.join(__dirname, "../lib/catalogue.ts")
);

const API = resolveApi();

// The baseline is the manifest, not an unpaginated fetch: it's the
// authoritative complete live set by construction, far smaller gzipped,
// and the same list the client orders the feed from -- if paging and the
// manifest disagree, the feed is wrong in a way a visitor would see.
const manifest = await fetchManifest(API);
const expected = new Set<string>(manifest.map((i: any) => String(i.id)));

const LIMIT = 100;
const MAX_PAGES = 500; // a stuck cursor must terminate, not spin
const seen = new Set<string>();
const duplicates: string[] = [];
let cursor: string | null = null;
let pages = 0;
let stuck: string | null = null;

while (pages < MAX_PAGES) {
  const url: string = `${API}?limit=${LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res: Response = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const body: any = await res.json();
  pages++;

  for (const item of body.items) {
    const id = String(item.id);
    if (seen.has(id)) duplicates.push(id);
    seen.add(id);
  }
  if (!body.next_cursor) break;
  // The exact failure mode from the bug above: a cursor that repeats itself.
  if (body.next_cursor === cursor) {
    stuck = cursor;
    break;
  }
  cursor = body.next_cursor;
}

const missing = [...expected].filter((id) => !seen.has(id));
const extra = [...seen].filter((id) => !expected.has(id));

console.log(`Paging ${API}`);
console.log(`  manifest baseline: ${expected.size} items`);
console.log(
  `  paged: ${seen.size} unique across ${pages} page(s) of ${LIMIT}\n`,
);

const problems = [];
if (stuck) problems.push(`cursor stopped advancing (repeated ${stuck})`);
if (pages >= MAX_PAGES)
  problems.push(
    `hit the ${MAX_PAGES}-page ceiling -- cursor is not terminating`,
  );
if (duplicates.length)
  problems.push(
    `${duplicates.length} duplicate(s): ${duplicates.slice(0, 4).join(", ")}`,
  );
if (missing.length)
  problems.push(
    `${missing.length} never returned: ${missing.slice(0, 4).join(", ")}`,
  );
if (extra.length)
  problems.push(
    `${extra.length} not in the baseline: ${extra.slice(0, 4).join(", ")}`,
  );

if (!problems.length) {
  console.log("  Paging returns exactly the manifest's set, each item once.");
  process.exit(0);
}
for (const p of problems) console.log(`  FAIL: ${p}`);
process.exit(1);
