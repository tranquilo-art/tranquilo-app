// Tranquilo pure-logic module -- see tests/logic.test.js. Imported
// directly by every other module that needs it (app.ts included);
// `vite build` bundles it into each page's output the same as any other
// dependency.
import type { Item } from "../types/Item";
import type { Shelf } from "../types/Shelf";

// ---- Artist/order helpers ----

// isRealArtist() prefix-matches rather than testing exact equality with
// "Unknown", since the catalogue spells "no known artist" many different
// ways -- treating only the literal "Unknown" as unknown would render the
// others as clickable artist links, presenting unrelated works as sharing
// an author.
//
// The prefix list lives in shared/vocabulary.json and is duplicated here
// since this module runs in the browser with no build step; python's
// harmonize/attribution.py builds its own list from the same file, and
// tests/data-schema.test.js asserts the two match.
export const UNKNOWN_ARTIST_PREFIXES: string[] = [
  "unknown",
  "anonymous",
  "unidentified",
  "unattributed",
  "not known",
  "no artist",
  "unknow",
  "goryeo-dynasty artist",
];
const UNKNOWN_ARTIST_RE = new RegExp(
  `^\\s*(?:${UNKNOWN_ARTIST_PREFIXES.join("|")})\\b`,
  "i",
);

export function isRealArtist(name: string | null | undefined): boolean {
  if (!name || !String(name).trim()) return false;
  return !UNKNOWN_ARTIST_RE.test(String(name));
}

export function shuffled<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

// Rearranges `arr` (already shuffled) so no two consecutive items share a
// *real* named artist -- "Unknown" is excluded via isRealArtist, since
// treating every "Unknown" as the same artist would make the constraint
// unsatisfiable for artist-sparse categories. When checkCategory is true
// (the "All" tail only), also tries to avoid the same category
// repeating, as a soft preference, not a hard guarantee.
//
// Single left-to-right pass: each fix only pulls a later item forward, so
// it never re-breaks something already fixed.
export function declusterOrder<T extends Pick<Item, "artist" | "category">>(
  arr: readonly T[],
  checkCategory?: boolean,
): T[] {
  const a = arr.slice();
  function violates(x: T, y: T): boolean {
    if (isRealArtist(x.artist) && x.artist === y.artist) return true;
    if (checkCategory && x.category === y.category) return true;
    return false;
  }
  for (let i = 1; i < a.length; i++) {
    if (!violates(a[i - 1], a[i])) continue;
    for (let j = i + 1; j < a.length; j++) {
      if (!violates(a[i - 1], a[j])) {
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
        break;
      }
    }
    // no clean swap found -- leave the (rare, likely small-pool) violation in place
  }
  return a;
}

// declusterOrder() for ONE PAGE of a server-ordered feed, checked against
// the item the previous page ended on -- paging reintroduces the exact
// adjacency declusterOrder() prevents, but only at the seam between pages.
//
// A wrapper, not a reimplementation: `carry` is prepended, the existing
// pass runs over the result, and the carry is sliced back off.
// declusterOrder()'s loop never moves a[0], so the carry acts purely as a
// comparison anchor and comes back out where it went in -- avoiding a
// second implementation of the same rules, which is how the Python/JS
// century bug happened.
//
// Cannot match a single global pass: a page of 60 has only 60 candidates
// to swap with, so a violation a global pass would fix 300 items later is
// left in place. Expected, not a defect --
// scripts/verify_feed_fixtures.mts measures a budget for this reason.
export function declusterPageOrder<T extends Pick<Item, "artist" | "category">>(
  page: readonly T[],
  carry: T | null | undefined,
  checkCategory?: boolean,
): T[] {
  if (!carry) return declusterOrder(page, checkCategory);
  return declusterOrder([carry, ...page], checkCategory).slice(1);
}

// ---- Hero selection ----
//
// "All" used to open on the same five artworks every session, since
// HERO_IDS hard-coded them -- fine when the catalogue held a few hundred
// items, but at thousands of items the mechanism meant to guarantee a good
// first impression reliably produced a stale one. Now picks from a
// curated POOL instead of replaying a fixed list: which five varies per
// session, that they're all good does not.
export const HERO_COUNT = 5;

// Fisher-Yates on a copy. The pool is a module-level constant and shuffling it
// in place would make every call depend on every call before it.
function shuffleWith(arr: any, rand: any) {
  const out = arr.slice();
  let i: number, j: number, t: any;
  for (i = out.length - 1; i > 0; i--) {
    j = Math.floor(rand() * (i + 1));
    t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

// Pick `count` heroes, avoiding two consecutive items of the same medium --
// the original five were ordered for tonal variety, and a rotation that
// opened on four paintings in a row would be a worse first impression.
// Count wins over adjacency: when remaining candidates are all one medium,
// returning fewer than `count` would silently shorten the opening.
export function pickHeroes(pool: any, count: any, rand: any) {
  if (!pool?.length) return [];
  const random = rand || Math.random;
  const shuffled = shuffleWith(pool, random);
  const wanted = Math.min(count, shuffled.length);
  const picked = [];
  let prev: any, idx: number, i: number;
  while (picked.length < wanted) {
    prev = picked.length ? picked[picked.length - 1].media_type : null;
    idx = -1;
    for (i = 0; i < shuffled.length; i++) {
      if (shuffled[i].media_type !== prev) {
        idx = i;
        break;
      }
    }
    // Nothing left of a different medium: take the next one anyway.
    if (idx === -1) idx = 0;
    picked.push(shuffled.splice(idx, 1)[0]);
  }
  return picked;
}

// ---- Feed depth ----
//
// How far into the feed did this visitor actually get, counted in artworks
// rather than a scrollTop/scrollHeight percentage. The percentage metric
// silently broke once recycling and paging made scrollHeight change size
// mid-session, so the same percentage stopped meaning a fixed number of
// artworks. A count stays stable regardless -- "saw 10 artworks" means the
// same thing under any implementation. Deliberately takes no scrollHeight,
// element, or total, so the loaded-size problem can't come back through an
// argument.
export const FEED_DEPTH_MILESTONES = [1, 5, 10, 25, 50, 100];

// Which milestones does `slidesSeen` newly reach, given those already
// reported? Returns all newly-crossed milestones, not just the highest: a
// deep link can land at slide 25 without passing through 5 and 10, and
// every milestone crossed is still true -- reporting only the highest
// would make the funnel non-monotonic.
export function feedDepthMilestones(slidesSeen: any, alreadyFired: any) {
  const fired = alreadyFired || [];
  const out = [];
  let i: number, m: any;
  for (i = 0; i < FEED_DEPTH_MILESTONES.length; i++) {
    m = FEED_DEPTH_MILESTONES[i];
    if (slidesSeen >= m && fired.indexOf(m) === -1) out.push(m);
  }
  return out;
}

// ---- Color math ----

type Rgb = [number, number, number];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function hexToRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h: number, s: number;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  h /= 360;
  s /= 100;
  l /= 100;
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// WCAG relative luminance / contrast ratio, used to keep each derived
// tint safely readable against the text color it'll sit behind.
export function relativeLuminance(rgb: Rgb): number {
  function chan(c: number): number {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
}
export function contrastRatio(rgbA: Rgb, rgbB: Rgb): number {
  const lA = relativeLuminance(rgbA) + 0.05;
  const lB = relativeLuminance(rgbB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

export const TEXT_RGB: Rgb = [241, 240, 246]; // matches --text, shared by feed caption, lightbox and detail modal

export function deriveTint(h: number, s: number): string {
  // Dark, muted "gallery alcove" tone, desaturated and low-lightness, then
  // nudged darker until the text on top clears WCAG AA (4.5:1). No
  // saturation floor: a low input saturation should stay subtle rather
  // than being forced up to a fake minimum.
  const tintS = clamp(s * 0.7, 0, 55);
  let tintL = 20;
  let tintRgb = hslToRgb(h, tintS, tintL);
  while (contrastRatio(tintRgb, TEXT_RGB) < 4.5 && tintL > 4) {
    tintL -= 2;
    tintRgb = hslToRgb(h, tintS, tintL);
  }
  return `rgb(${tintRgb.join(",")})`;
}

// ---- Search matching ----
// Diacritic-insensitive everywhere search touches text ("Cézanne" findable
// by typing a plain "e"). Strips combining marks after NFD decomposition
// rather than mapping accented letters by hand, covering names not
// special-cased.
export function foldDiacritics(s: string): string {
  return s.normalize ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
}
export function normalizeForSearch(s: unknown): string {
  return foldDiacritics(String(s || "")).toLowerCase();
}

// Derives a rough century for each item (from a 4-digit year or an
// "Nth century" phrase in its date/bio) so free-text era queries like
// "17th century" or "ancient" can match without a dedicated field.
//
// Sanity clamp: the \d{3,4}-year fallback has no BCE/CE awareness, so a
// raw BCE year in date/bio text (e.g. "ca. 2300-2000 BCE") produces
// nonsense centuries -- found via a real catalogue audit, not
// hypothetical. Outside a plausible range is treated as no match (null)
// rather than trusted literally.
const MIN_PLAUSIBLE_CENTURY = 1;
const MAX_PLAUSIBLE_CENTURY = 21;
export function computeCentury(
  item: Pick<Item, "date" | "bio">,
): number | null {
  const text = `${item.date || ""} ${item.bio || ""}`;
  // The "Nth century" phrase branch below has no CE/BCE awareness --
  // "13th century BCE" would otherwise parse as century 13 (Medieval)
  // rather than correctly bailing to null, since 13 sails past the
  // plausibility clamp. Discovered against a real Bronze Age sword dated
  // "13th century BCE".
  if (/\bb\.?c\.?(?:e\.?)?\b/i.test(text)) return null;
  const centuryMatch = text.match(/(\d{1,2})(?:st|nd|rd|th)[\s-]*century/i);
  let century: number | null = null;
  if (centuryMatch) {
    century = parseInt(centuryMatch[1], 10);
  } else {
    // Decade and century-marker forms: "1860s", "1470s", "1800s". A form
    // ending in "00" is the century marker (e.g. "1800s" means 1800-1899,
    // the 19th century, not century 18 read as a literal year); anything
    // else is a decade where the year itself is the signal. Must stay
    // identical to core.py's version -- the two have diverged before over
    // Python's \b being Unicode-aware vs. JS's ASCII-only, silently costing
    // every year followed by a CJK character. tests/logic.test.js
    // cross-checks both against the same corpus.
    const decadeMatch = text.match(/\b(\d{1,2})(\d{2})s\b/);
    const yearMatch = text.match(/\b(\d{3,4})\b/);
    if (
      decadeMatch &&
      (!yearMatch || (decadeMatch.index ?? 0) <= (yearMatch.index ?? 0))
    ) {
      century =
        decadeMatch[2] === "00"
          ? parseInt(decadeMatch[1], 10) + 1
          : Math.ceil(parseInt(decadeMatch[1] + decadeMatch[2], 10) / 100);
    } else if (yearMatch) {
      century = Math.ceil(parseInt(yearMatch[1], 10) / 100);
    }
  }
  if (century === null) return null;
  if (century < MIN_PLAUSIBLE_CENTURY || century > MAX_PLAUSIBLE_CENTURY)
    return null;
  return century;
}

export function matchesTimeframe(
  query: string,
  century: number | null | undefined,
): boolean {
  if (century == null) return false;
  if (query.indexOf("ancient") !== -1) {
    return century <= 10;
  }
  const m = query.match(/(\d{1,2})(?:st|nd|rd|th)\s*century/);
  return !!m && century === parseInt(m[1], 10);
}

export function matchesQuery(item: Item, rawQuery: string): boolean {
  const q = normalizeForSearch(rawQuery.trim());
  if (!q) return true;
  if (item.title && normalizeForSearch(item.title).indexOf(q) !== -1)
    return true;
  if (item.artist && normalizeForSearch(item.artist).indexOf(q) !== -1)
    return true;
  if (item.category && normalizeForSearch(item.category).indexOf(q) !== -1)
    return true;
  if (item.medium && normalizeForSearch(item.medium).indexOf(q) !== -1)
    return true;
  if (item.tags && normalizeForSearch(item.tags).indexOf(q) !== -1) return true;
  if (
    item.region_primary &&
    normalizeForSearch(item.region_primary).indexOf(q) !== -1
  )
    return true;
  // Alternates too, for items that genuinely span regions -- findable by
  // either region. region_primary stays the value the detail panel shows;
  // this only widens what matches.
  if (
    Array.isArray(item.region_alt) &&
    item.region_alt.some((r) => r && normalizeForSearch(r).indexOf(q) !== -1)
  )
    return true;
  if (item.timeframe && normalizeForSearch(item.timeframe).indexOf(q) !== -1)
    return true;
  if (item.media_type && normalizeForSearch(item.media_type).indexOf(q) !== -1)
    return true;
  if (item.palette && normalizeForSearch(item.palette).indexOf(q) !== -1)
    return true;
  if (matchesTimeframe(q, item._century)) return true;
  if (item.date && normalizeForSearch(item.date).indexOf(q) !== -1) return true;
  if (item.bio && normalizeForSearch(item.bio).indexOf(q) !== -1) return true;
  return false;
}

// ---- Spell correction ("did you mean") ----
export function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1),
    curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let k = 1; k <= n; k++) {
      const cost = a[i - 1] === b[k - 1] ? 0 : 1;
      curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

// Distance <= 2 always qualifies; longer words get a proportional (25% of
// length) allowance so a long correction isn't capped as tightly as a
// short one. `vocabulary` is passed in so this function has no external
// dependency of its own.
export function findDidYouMean(
  rawQuery: string,
  vocabulary: readonly string[],
): string | null {
  const q = normalizeForSearch(rawQuery.trim());
  if (q.length < 3) return null;
  const maxDist = Math.max(2, Math.ceil(q.length * 0.25));
  let best: string | null = null,
    bestDist = Infinity;
  vocabulary.forEach((word) => {
    if (word === q) return;
    const dist = levenshtein(q, word);
    if (dist <= maxDist && dist < bestDist) {
      bestDist = dist;
      best = word;
    }
  });
  return best;
}

// ---- Concept search (curated map, zero ongoing cost) ----
// Matches on an exact query, or any whitespace-separated token within a
// longer query -- token-boundary rather than raw substring, so "carmor"
// doesn't accidentally match "armor". `conceptMap` is passed in, curated
// elsewhere, so this function has no dependency of its own.
export function matchConcept<T>(
  rawQuery: string,
  conceptMap: Record<string, T>,
): T | null {
  const q = normalizeForSearch(rawQuery.trim());
  if (conceptMap[q]) return conceptMap[q];
  const tokens = q.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    if (conceptMap[tokens[i]]) return conceptMap[tokens[i]];
  }
  return null;
}

// ---- How many cards a shelf rail renders ----
//
// A rule shelf can qualify hundreds of items but only the first few are
// hydrated, and rendering past that drew a blank `<img src="undefined">`
// frame -- capping fixed it. Wrong for the Storylines shelf though: a
// curated, bounded set where the newest entry is the most worth seeing,
// and a cap once silently hid a published thirteenth storyline. So the
// cap applies only to rule-qualified shelves, not a hand-built list.
// Returns a number, not a boolean, to keep the caller free of the policy.
export function shelfRenderLimit(
  shelf: (Pick<Shelf, "type"> & { itemIds?: unknown[] }) | null | undefined,
  qualifyingCount: number,
  hydrateLimit: number,
): number {
  const curated =
    !!shelf && (shelf.type === "hero" || Array.isArray(shelf.itemIds));
  return curated ? qualifyingCount : Math.min(qualifyingCount, hydrateLimit);
}

// ---- Image-load failure dedup ----
// Pulled out of wireArtworkImageState() (app.js) so this decision logic is
// unit-testable without a DOM -- pure functions over a Set and two
// booleans.

// A hard bound on how many failure reports one page load may write. Set
// from evidence: a single client once wrote 707 in one second and 10,476
// in one day, while ordinary browsing days produced zero -- a client with
// an unbounded viewport renders every frame at once and reports all of
// them. 50 sits far above any real session and far below the volumes that
// made a per-source threshold meaningless.
export const IMAGE_FAILURE_REPORT_CAP = 50;

export function shouldLogFailure(
  key: string,
  isManualRetry: boolean,
  reportedFailures: Set<string>,
  cap?: number,
): boolean {
  // Checked first so it also bounds the manual-retry path -- manual retry
  // is exempt from the per-key dedup below, but leaving it exempt from the
  // budget too would make the bound escapable.
  const limit = typeof cap === "number" ? cap : IMAGE_FAILURE_REPORT_CAP;
  if (reportedFailures.size >= limit) return false;
  return isManualRetry || !reportedFailures.has(key);
}

export function shouldSkipAutomaticLoad(
  key: string,
  isManualRetry: boolean,
  reportedFailures: Set<string>,
): boolean {
  return !isManualRetry && reportedFailures.has(key);
}

// ---------------------------------------------------------------------------
// Recycling-window arithmetic
// ---------------------------------------------------------------------------
//
// The feed keeps only a bounded band of slides built; everything else is an
// empty shell. The index arithmetic is where an off-by-one costs a blank
// slide at the viewport edge or one that never releases, so it lives here
// where the offline suite can test it.
//
// Returns the inclusive band [lo, hi], clamped rather than centred: at the
// top/bottom of the feed the band shrinks instead of shifting, which would
// hydrate slides on the far side the user is scrolling away from.
export function recycleWindowFor(
  activeIndex: number,
  total: number,
  radius: number,
): { lo: number; hi: number } {
  if (total <= 0) return { lo: 0, hi: -1 }; // empty: hi < lo
  const active = Math.max(0, Math.min(total - 1, activeIndex));
  return {
    lo: Math.max(0, active - radius),
    hi: Math.min(total - 1, active + radius),
  };
}

// Which indices change state moving from band [prevLo, prevHi] to [lo, hi].
// An empty previous band is hi < lo (the initial 0, -1), so the first call
// hydrates the whole new band and releases nothing. Computed as a delta
// rather than sweeping every slide, which would cost O(catalogue) per
// scroll frame.
export function recycleDelta(
  prevLo: number,
  prevHi: number,
  lo: number,
  hi: number,
): { release: number[]; hydrate: number[] } {
  const release: number[] = [],
    hydrate: number[] = [];
  for (let i = prevLo; i <= prevHi; i++) {
    if (i < lo || i > hi) release.push(i);
  }
  for (let j = lo; j <= hi; j++) {
    if (j < prevLo || j > prevHi) hydrate.push(j);
  }
  return { release, hydrate };
}

// How the intro slide says how big the catalogue is. Always rounds down,
// since "10k+" at 9,914 items would advertise works we don't have; the "+"
// carries the rest honestly. Below 1,000 it prints the exact number, since
// rounding "847" to "0k+" loses everything and gains nothing.
export function roundedWorkCount(n: any) {
  const count = Math.floor(Number(n));
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count < 1000) return String(count);
  return `${Math.floor(count / 1000)}k+`;
}
