// Getty ULAN -- artist identity and name variants, so "Rembrandt van Rijn",
// "Rijn, Rembrandt van" and "Rembrandt" resolve to one person instead of
// splitting a Tea Voice cluster, the artist facet, and the feed's
// de-clustering. Licence is ODC-BY 1.0 (attribution required), unlike
// Wikidata's CC0.
//
// TERM.out is tab-delimited, 13 columns, no header:
//   col 3  = preferred flag (Y preferred, I inverted/index form, NA alternate)
//   col 10 = subject id
//   col 11 = term text

const TERM_COLS = 13;
const COL_PREFERRED = 2;
const COL_SUBJECT = 9;
const COL_TERM = 10;

function parseTermRow(line: any): any {
  if (!line) return null;
  const parts = String(line).split("\t");
  if (parts.length < TERM_COLS) return null;
  const subjectId = (parts[COL_SUBJECT] || "").trim();
  const term = (parts[COL_TERM] || "").trim();
  if (!subjectId || !term) return null;
  return {
    subjectId: subjectId,
    term: term,
    preferred: parts[COL_PREFERRED] === "Y",
  };
}

// Conservative on purpose: case, accents, punctuation and a trailing
// parenthetical are noise, but word order is NOT -- a token-sorting matcher
// once merged Dai Jin, Ma Lin and Lü Ji into one artist. Fusing two artists
// is worse than failing to merge them, since it looks like a success.
function normalise(name: any): string {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "") // trailing parenthetical only
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIndex(terms: any): any {
  const byNorm = new Map(); // normalised term -> Set(subjectId)
  const bySubject = new Map(); // subjectId -> { preferredName, variants[] }
  (terms || []).forEach((t: any) => {
    if (!t) return;
    const key = normalise(t.term);
    if (!key) return;
    if (!byNorm.has(key)) byNorm.set(key, new Set());
    byNorm.get(key).add(t.subjectId);

    let rec = bySubject.get(t.subjectId);
    if (!rec) {
      rec = { preferredName: null, variants: [] };
      bySubject.set(t.subjectId, rec);
    }
    if (rec.variants.indexOf(t.term) === -1) rec.variants.push(t.term);
    if (t.preferred) rec.preferredName = t.term;
  });
  return { byNorm: byNorm, bySubject: bySubject };
}

// Two different people can carry the same term -- there is more than one
// Rembrandt in ULAN. Choosing one silently would fuse two artists in our
// catalogue, so an ambiguous name reports every candidate and NO subjectId,
// leaving nothing for a merge step to act on by accident.
function lookup(index: any, name: any): any {
  const ids = index.byNorm.get(normalise(name));
  if (!ids?.size) return null;
  const list = Array.from(ids);
  if (list.length > 1) return { ambiguous: true, subjectIds: list };
  const rec = index.bySubject.get(list[0]) || {};
  return {
    subjectId: list[0],
    preferredName: rec.preferredName || null,
    variants: rec.variants || [],
  };
}

// Which of OUR artist names are the same person. Groups of one are dropped --
// a "merge" of a single spelling is not a merge, and emitting it would bury
// the real ones.
function groupBySubject(index: any, ourNames: any): any[] {
  const bySubject = new Map();
  (ourNames || []).forEach((name: any) => {
    const hit = lookup(index, name);
    if (!hit || hit.ambiguous) return;
    let g = bySubject.get(hit.subjectId);
    if (!g) {
      g = {
        subjectId: hit.subjectId,
        preferredName: hit.preferredName,
        variants: hit.variants,
        ourNames: [],
      };
      bySubject.set(hit.subjectId, g);
    }
    if (g.ourNames.indexOf(name) === -1) g.ourNames.push(name);
  });
  return Array.from(bySubject.values());
}

export { buildIndex, groupBySubject, lookup, normalise, parseTermRow };
