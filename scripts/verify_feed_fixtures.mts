// Diff the live feed against the captured baseline. `capture_feed_fixtures.mts`
// records what each mode returned before server-side work began; this
// re-derives them against whatever is live now and reports every difference,
// naming the exact mode and items that appeared or vanished.
//
// Deliberately a script rather than a vitest test: the JS suite is offline by
// design and this needs the live API. Not run on every commit -- a migration
// checkpoint.
//
// Run:  node scripts/verify_feed_fixtures.mts
//       node scripts/verify_feed_fixtures.mts --api http://localhost:3000/api/items
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const logic = await import(path.join(ROOT, "src/logic/logic.ts"));

const { resolveApi, fetchAllItems } = await import(
  path.join(ROOT, "lib/catalogue.ts")
);
const API = resolveApi();

interface FixtureMode {
  count: number;
  ids: string[];
}
interface Fixture {
  captured_at: string;
  item_count: number;
  modes: Record<string, FixtureMode>;
}

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(ROOT, "tests/fixtures/feed-modes.json"), "utf8"),
);

// Full items, paged: the mode derivations below call matchesQuery(), which
// reads title, medium, tags and bio -- fields the manifest deliberately omits.
const items = await fetchAllItems(API);

// Same derivations as the capture script. Kept in step by the fact that a
// divergence here shows up as a diff, which is the point.
function derive(): Record<string, any[]> {
  const modes: Record<string, any[]> = {};
  modes["category:All"] = items;
  for (const c of Array.from(
    new Set(items.map((i: any) => i.category)),
  ).sort()) {
    modes[`category:${c}`] = items.filter((i: any) => i.category === c);
  }
  for (const key of Object.keys(fixture.modes)) {
    if (key.startsWith("search:")) {
      const q = key.slice("search:".length);
      modes[key] = items.filter((i: any) => logic.matchesQuery(i, q));
    } else if (key.startsWith("artist:")) {
      const a = key.slice("artist:".length);
      modes[key] = items.filter((i: any) => i.artist === a);
    } else if (key.startsWith("facet:")) {
      const [field, value] = key.slice("facet:".length).split("=");
      modes[key] = items.filter((i: any) => String(i[field]) === value);
    }
  }
  return modes;
}

const live = derive();
const problems: { mode: string; kind: string; detail: string }[] = [];

for (const [mode, expected] of Object.entries(fixture.modes)) {
  const actual = live[mode];
  if (!actual) {
    problems.push({
      mode,
      kind: "mode disappeared",
      detail: "no longer derivable",
    });
    continue;
  }
  const was = new Set(expected.ids);
  const now = new Set(actual.map((i: any) => String(i.id)));
  const gone = [...was].filter((id) => !now.has(id));
  const added = [...now].filter((id) => !was.has(id));
  if (gone.length || added.length) {
    problems.push({
      mode,
      kind: "membership changed",
      detail: `${expected.count} -> ${actual.length}${
        gone.length
          ? `; missing ${gone.length}: ${gone.slice(0, 4).join(", ")}`
          : ""
      }${added.length ? `; new ${added.length}: ${added.slice(0, 4).join(", ")}` : ""}`,
    });
  }
}

// Ordering is randomised, so it is checked as invariants rather than sequence.
// These are the guarantees declusterOrder() makes, and they must survive any
// server-side reimplementation of feed ordering.
function checkInvariants(list: any[], checkCategory: boolean) {
  const violations = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1],
      b = list[i];
    if (logic.isRealArtist(a.artist) && a.artist === b.artist) {
      violations.push(`consecutive same artist at ${i}: ${a.artist}`);
    }
    if (checkCategory && a.category === b.category) {
      violations.push(`consecutive same category at ${i}: ${a.category}`);
    }
  }
  return violations;
}

// A threshold, not an assertion of zero: declusterOrder() is a single
// left-to-right pass, not a solver, and cannot always satisfy the
// no-adjacent-same-artist constraint (particularly at the tail). A
// zero-tolerance check would flag normal behavior as a regression.
const ADJACENCY_BUDGET = 6;
const RUNS = 5;
let worst = 0;
for (let run = 0; run < RUNS; run++) {
  const shuffle = logic.declusterOrder(logic.shuffled(items.slice()), true);
  worst = Math.max(worst, checkInvariants(shuffle, false).length);
}
const tailViolations =
  worst > ADJACENCY_BUDGET
    ? [
        `${worst} same-artist adjacencies across ${RUNS} shuffles (budget ${ADJACENCY_BUDGET})`,
      ]
    : [];

// ---------------------------------------------------------------------------
// The same invariant, over the order a VISITOR actually gets.
// ---------------------------------------------------------------------------
//
// The check above shuffles locally and declusters in one global pass, which
// the client no longer does -- the feed is now ordered server-side by a
// precomputed shuffle_key, paged, and declustered per-page against the
// previous page's trailing item. The local check stays as the baseline the
// paged result is judged against; this walks real pages from the live
// endpoint to measure whether per-page declustering with carry-over holds up.
// Exact equivalence isn't the bar: a 60-item page can't find a swap a
// whole-catalogue pass might find 300 items later, hence the budget.
async function walkPagedFeed(
  start: number,
  { limit = 60, maxPages = 4000 } = {},
) {
  const out: any[] = [];
  let carry: any = null;
  let cursor: string | null = null;
  let pages = 0;

  for (;;) {
    const url: string = `${API}?shape=manifest&order=shuffle&limit=${limit}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : `&start=${start}`
    }`;
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    const body: any = await res.json();
    if (++pages > maxPages) {
      throw new Error(
        `paging did not terminate after ${maxPages} pages -- ` +
          `the wrap is not stopping where the session began`,
      );
    }
    // Same call the client makes, from the same module. A second
    // implementation here would be measuring itself rather than the feed.
    const page: any[] = logic.declusterPageOrder(
      body.items || [],
      carry,
      false,
    );
    if (page.length) {
      carry = page[page.length - 1];
      out.push(...page);
    }
    if (!body.next_cursor) return { order: out, pages };
    if (body.next_cursor === cursor) {
      throw new Error(
        `cursor stopped advancing after ${pages} page(s) -- ` +
          `paging is broken, not finished`,
      );
    }
    cursor = body.next_cursor;
  }
}

let pagedWorst = 0;
let pagedPages = 0;
let pagedCount = 0;
let pagedDupes = 0;
let pagedError: unknown = null;
try {
  for (let run = 0; run < RUNS; run++) {
    const { order, pages } = await walkPagedFeed(Math.random());
    pagedWorst = Math.max(pagedWorst, checkInvariants(order, false).length);
    pagedPages = pages;
    pagedCount = order.length;
    // A session must see each live item exactly once. Counting by the
    // composite source:id, not native_id, since some items share a
    // native_id across sources (met:107208, cleveland:107208).
    const keys = order.map((i) => `${i.source}:${i.id}`);
    pagedDupes = Math.max(pagedDupes, keys.length - new Set(keys).size);
  }
} catch (err) {
  pagedError = err;
}

console.log(`Comparing ${API}`);
console.log(
  `  baseline captured ${fixture.captured_at}, ${fixture.item_count} items`,
);
console.log(
  `  live now: ${items.length} items, ${Object.keys(fixture.modes).length} modes checked\n`,
);

if (!problems.length) {
  console.log(
    "  Membership: every mode returns exactly what it did at baseline.",
  );
} else {
  console.log(`  Membership: ${problems.length} mode(s) changed\n`);
  for (const p of problems)
    console.log(`    [${p.kind}] ${p.mode}\n        ${p.detail}`);
}

console.log(
  tailViolations.length
    ? `\n  Ordering (local baseline): WORSE than baseline -- ${tailViolations[0]}`
    : `\n  Ordering (local baseline): worst of ${RUNS} shuffles had ${worst} same-artist ` +
        `adjacency of ${items.length - 1} pairs (budget ${ADJACENCY_BUDGET}).`,
);

if (pagedError) {
  const message =
    pagedError instanceof Error ? pagedError.message : String(pagedError);
  console.log(`\n  Ordering (server-paged): COULD NOT MEASURE -- ${message}`);
} else {
  console.log(
    `\n  Ordering (server-paged): worst of ${RUNS} sessions had ${pagedWorst} same-artist ` +
      `adjacency of ${Math.max(0, pagedCount - 1)} pairs (budget ${ADJACENCY_BUDGET}), ` +
      `over ~${pagedPages} pages/session.`,
  );
  console.log(
    `  Coverage: ${pagedCount} items per session, ${pagedDupes} duplicate(s) ` +
      `-- a session must see each live item exactly once.`,
  );
  if (pagedWorst > ADJACENCY_BUDGET) {
    console.log(`  OVER BUDGET -- per-page declustering has regressed.`);
  }
  if (pagedDupes > 0) {
    console.log(
      `  DUPLICATES -- the wrap is not stopping where the session began.`,
    );
  }
}

// A changed catalogue is not a regression -- exit non-zero only on
// membership changes, and say so, to avoid mistaking a legitimate
// catalogue edit for a migration bug.
if (problems.length) {
  console.log(
    "\n  NOTE: a mode can also change legitimately -- an item ingested or rejected\n" +
      "  since the baseline moves membership without anything being broken. Check the\n" +
      "  named ids against the catalogue before treating this as a migration fault,\n" +
      "  and re-capture the baseline once the change is confirmed intentional.",
  );
}
// The paged order is a MIGRATION correctness check, so it fails the run --
// unlike a membership change, which can be a legitimate catalogue edit.
const pagedBad =
  !!pagedError || pagedWorst > ADJACENCY_BUDGET || pagedDupes > 0;
process.exit(problems.length || pagedBad ? 1 : 0);
