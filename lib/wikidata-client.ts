// Wikidata Query Service client -- artist identity cluster research.
//
// Compliant with WDQS's published rules: identifies via
// lib/source-identity.ts's Wikimedia-shaped User-Agent; the breaker
// opens after 3 CONSECUTIVE failures (WDQS allows 30/minute and can
// only ban the whole User-Agent or throttle globally, and we have one
// Wikimedia identity, so an error storm here would cost Commons access
// too); one query at a time with a gap between them; Retry-After is
// honoured when sent.
//
// Wikidata's structured data is CC0, so every result (including a
// confirmed "no such artist") is stored and never re-requested.

import * as identity from "./source-identity.ts";

const ENDPOINT = "https://query.wikidata.org/sparql";
const ERROR_LIMIT = 3; // WDQS allows 30/min; this is deliberately far under
const MIN_INTERVAL_MS = 2000; // one at a time, with air between

function requestHeaders(): any {
  return {
    "User-Agent": identity.WIKIMEDIA_USER_AGENT,
    "Accept": "application/sparql-results+json",
  };
}

// Consecutive, not lifetime. A success means the run is healthy again.
function makeBreaker(): any {
  return {
    consecutive: 0,
    fail: function (this: any) {
      this.consecutive++;
    },
    succeed: function (this: any) {
      this.consecutive = 0;
    },
    tripped: function (this: any) {
      return shouldStop(this.consecutive);
    },
  };
}
function shouldStop(consecutiveErrors: any): boolean {
  return consecutiveErrors >= ERROR_LIMIT;
}

function retryAfterMs(headers: any): any {
  const raw = headers?.get ? headers.get("retry-after") : null;
  if (!raw) return null;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null; // a date form, or nonsense
  return Math.round(secs * 1000);
}

// SPARQL string literals escape backslash and double-quote. An unescaped quote
// does not return nothing -- it is a malformed query, which WDQS counts as an
// ERROR against the budget.
function sparqlString(s: any): string {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Art occupations, since rdfs:label alone matches ANY human with that
// English label (a name-only query once matched the wrong person for
// most names).
//
// Q1028181 painter, Q11569986 printmaker, Q1281618 sculptor,
// Q33231 photographer, Q483501 artist, Q15296811 draughtsperson,
// Q644687 illustrator, Q1925963 graphic artist.
const ART_OCCUPATIONS = [
  "wd:Q1028181",
  "wd:Q11569986",
  "wd:Q1281618",
  "wd:Q33231",
  "wd:Q483501",
  "wd:Q15296811",
  "wd:Q644687",
  "wd:Q1925963",
];

// Facts plus the two citable URLs. The Wikidata item is the fact source; the
// Wikipedia article is where the narrative material lives, which is the half
// that actually makes a Tea Voice caption rather than a wall label.
function artistQuery(names: any): string {
  const values = (names || [])
    .map((n: any) => `"${sparqlString(n)}"@en`)
    .join(" ");
  return [
    "SELECT ?artist ?artistLabel ?artistDescription ?birth ?death",
    "       ?nationalityLabel ?movementLabel ?article WHERE {",
    `  VALUES ?name { ${values} }`,
    `  VALUES ?occupation { ${ART_OCCUPATIONS.join(" ")} }`,
    "  ?artist rdfs:label ?name .",
    "  ?artist wdt:P31 wd:Q5 .", // human: a museum must not match a name
    "  ?artist wdt:P106 ?occupation .", // and an artist: not a badminton player
    "  OPTIONAL { ?artist wdt:P569 ?birth }",
    "  OPTIONAL { ?artist wdt:P570 ?death }",
    "  OPTIONAL { ?artist wdt:P27 ?nationality }",
    "  OPTIONAL { ?artist wdt:P135 ?movement }",
    "  OPTIONAL {",
    "    ?article schema:about ?artist ;",
    "             schema:isPartOf <https://en.wikipedia.org/> .",
    "  }",
    '  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }',
    "}",
  ].join("\n");
}

function year(iso: any): any {
  if (!iso) return null;
  const m = String(iso).match(/^(-?\d{4})/);
  return m ? m[1] : null;
}

// Wikidata returns one row per combination -- an artist with two
// nationalities and two movements arrives as four rows sharing one
// ?artist URI -- so rows are grouped by artist and multi-valued fields
// collected, rather than keeping only the last row seen.
function parseArtists(json: any): any[] {
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows)) return [];

  const byArtist = new Map();
  rows.forEach((b: any) => {
    const v = (k: any) => (b[k]?.value ? b[k].value : null);
    const key = v("artist") || v("artistLabel");
    if (!key) return;

    let rec = byArtist.get(key);
    if (!rec) {
      rec = {
        name: v("artistLabel"),
        wikidata: v("artist"),
        description: v("artistDescription"),
        birth: year(v("birth")),
        death: year(v("death")),
        nationality: [],
        movement: [],
        article: v("article"),
        found: true,
        fetched_at: new Date().toISOString(),
      };
      byArtist.set(key, rec);
    }
    // Later rows may carry a value an earlier one lacked.
    if (!rec.article) rec.article = v("article");
    if (!rec.description) rec.description = v("artistDescription");
    if (!rec.birth) rec.birth = year(v("birth"));
    if (!rec.death) rec.death = year(v("death"));

    const nat = v("nationalityLabel");
    if (nat && rec.nationality.indexOf(nat) === -1) rec.nationality.push(nat);
    const mov = v("movementLabel");
    if (mov && rec.movement.indexOf(mov) === -1) rec.movement.push(mov);
  });

  // Two painters can share a name. A name matching more than one person
  // is recorded as ambiguous with every candidate kept and no facts of
  // its own, rather than silently picking one.
  const byName = new Map();
  Array.from(byArtist.values()).forEach((rec: any) => {
    const list = byName.get(rec.name) || [];
    list.push(rec);
    byName.set(rec.name, list);
  });

  const out: any[] = [];
  byName.forEach((list: any, name: any) => {
    if (list.length === 1) {
      out.push(list[0]);
      return;
    }
    out.push({
      name: name,
      found: true,
      ambiguous: true,
      candidates: list.map((c: any) => ({
        wikidata: c.wikidata,
        description: c.description,
        birth: c.birth,
        death: c.death,
        article: c.article,
      })),
      fetched_at: new Date().toISOString(),
    });
  });
  return out;
}

// Merge, never replace. Overwriting the store would throw away every earlier
// query and make us re-ask Wikimedia for answers we already hold.
function mergeStore(existing: any, rows: any, missNames?: any): any {
  const out = Object.assign({}, existing || {});
  (rows || []).forEach((r: any) => {
    if (r?.name) out[r.name] = r;
  });
  // A miss is an answer too. Without recording it, every run re-queries the
  // names Wikidata has never heard of.
  (missNames || []).forEach((n: any) => {
    if (!out[n])
      out[n] = { name: n, found: false, fetched_at: new Date().toISOString() };
  });
  return out;
}

function namesToFetch(names: any, existing: any): any[] {
  const have = existing || {};
  return (names || []).filter((n: any) => !have[n]);
}

export {
  ART_OCCUPATIONS,
  artistQuery,
  ENDPOINT,
  ERROR_LIMIT,
  MIN_INTERVAL_MS,
  makeBreaker,
  mergeStore,
  namesToFetch,
  parseArtists,
  requestHeaders,
  retryAfterMs,
  shouldStop,
};
