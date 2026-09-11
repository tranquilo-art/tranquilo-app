import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// logic.ts is an ES module; app.ts's own feed-mode filtering isn't exported
// (it stays private inside its top-level IIFE), so the mode definitions
// below reproduce it rather than importing it.
const logic = await import(path.join(ROOT, "src/logic/logic.ts"));

// Pages through the catalogue since /api/items no longer serves it in one
// response. Fixtures need full items, since the modes below run
// matchesQuery() locally (reads title, medium, tags, bio) -- the paging
// helper, not the manifest.
const { resolveApi, fetchAllItems } = await import(
  path.join(ROOT, "lib/catalogue.ts")
);
const API = resolveApi();
const items = await fetchAllItems(API);

function idsOf(list: any[]) {
  return list.map((i) => String(i.id)).sort();
}

// The modes renderFeed() actually distinguishes -- each a pure predicate
// over the full catalogue, exactly what has to become a server-side query
// without changing what comes back.
const modes: Record<string, any[]> = {};

// Category browsing, including "All".
const categories = Array.from(
  new Set(items.map((i: any) => i.category)),
).sort();
modes["category:All"] = items;
for (const c of categories) {
  modes[`category:${c}`] = items.filter((i: any) => i.category === c);
}

// Search. Terms chosen for the things most likely to regress when this moves
// to Postgres: diacritic folding, CJK, multi-field matching, partial words.
const SEARCH_TERMS = [
  "cezanne",
  "Cézanne",
  "monet",
  "rembrandt",
  "vermeer",
  "buddha",
  "landscape",
  "portrait",
  "still life",
  "唐",
  "gold",
  "silk",
  "bronze",
  "qing",
  "ming",
  "van gogh",
  "self-portrait",
  "zzzznomatch",
];
for (const q of SEARCH_TERMS) {
  modes[`search:${q}`] = items.filter((i: any) => logic.matchesQuery(i, q));
}

// Artist filter -- every artist with more than one work, since those are the
// ones where a wrong result set is visible.
const byArtist: Record<string, any[]> = {};
for (const i of items) {
  if (!logic.isRealArtist(i.artist)) continue;
  byArtist[i.artist] ||= [];
  byArtist[i.artist].push(i);
}
for (const [artist, list] of Object.entries(byArtist)) {
  if (list.length > 1) modes[`artist:${artist}`] = list;
}

// Facets, as Discover's rule-based shelves use them.
for (const field of ["timeframe", "palette", "media_type", "region_primary"]) {
  for (const value of Array.from(new Set(items.map((i: any) => i[field])))
    .filter(Boolean)
    .sort()) {
    modes[`facet:${field}=${value}`] = items.filter(
      (i: any) => i[field] === value,
    );
  }
}

const fixture = {
  captured_at: new Date().toISOString().slice(0, 10),
  source: API,
  item_count: items.length,
  note:
    "Sets, not sequences -- feed order is randomised per " +
    "session by shuffled(). A server-side implementation must return the same " +
    "MEMBERSHIP for each mode; ordering is verified separately by invariants.",
  modes: Object.fromEntries(
    Object.entries(modes).map(([k, v]) => [
      k,
      { count: v.length, ids: idsOf(v) },
    ]),
  ),
};

process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
