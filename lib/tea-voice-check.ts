// Pre-flight checks for a Tea Voice batch, run before it reaches human
// review. Catches classes of mechanical fault that never need a human to
// spot:
//
//   * a citation link built from a guessed accession number that
//     resolves to a real page showing the wrong object -- it still looks
//     like a working citation.
//   * a caption that only parses if the reader has already seen a
//     different one (e.g. one opening "It wasn't only dancers"). The
//     feed is randomly ordered, so that's the ordinary case, not the
//     exception.
//
// Review time is the cost that scales worst here. Catching mechanical
// faults before review turns a reviewer's pass into judgement rather
// than proofreading, which is the part that actually needs a human.
//
// ERRORS are factual and should block a batch. WARNINGS are stylistic and only
// inform: a caption is a piece of writing, and a checker that fails a batch
// over sentence length would be routed around within a week.

// Hosts we serve items from. A link to one of these is a claim about THIS
// object and must match the stored url; anything else is third-party grounding
// and is none of this checker's business.
const INSTITUTION_HOSTS = [
  "metmuseum.org",
  "clevelandart.org",
  "si.edu",
  "americanart.si.edu",
  "europeana.eu",
  "commons.wikimedia.org",
];

// Openers that only make sense if the reader has just seen another item.
// Deliberately a short, specific list: a broad one would flag "This is a
// laundry", which points at the artwork in front of the reader and is fine.
const SEQUENCE_PATTERNS = [
  /\bit\s+wasn'?t\s+only\b/i,
  /\bas\s+(?:we|you)\s+(?:saw|noted|mentioned)\b/i,
  /\b(?:unlike|like)\s+the\s+(?:previous|last|earlier|other)\b/i,
  /\bthe\s+(?:previous|last|earlier)\s+(?:one|print|picture|work|caption)\b/i,
  /\bhere\s+too\b/i,
  /\bagain\s+here\b/i,
  /\bthe\s+other\s+(?:one|print|picture|work)\b/i,
];

const MAX_WORDS = 120; // well past a normal caption's length is wall text
const MAX_SENTENCE_WORDS = 45; // "wall texty" tracks sentence length most

function hostOf(url: any): any {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_e) {
    return null;
  }
}

function isInstitutionUrl(url: any): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return INSTITUTION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// Paths on an institution host that are scholarship, not object records.
// An essay cited across institutions is good grounding; an object page for a
// different object is the batch-09 fabrication. Anything not listed here stays
// strict -- a false positive costs a drafter one edit, a false negative ships
// a wrong link as a fact. See tests/tea-voice-check.test.ts.
const NON_OBJECT_PATH_PREFIXES = [
  "/essays",
  "/met-publications",
  "/toah",
  "/learn",
  "/articles",
  "/stories",
  "/blog",
  "/research",
  "/exhibitions",
  "/about",
];

function isObjectPageUrl(url: any): boolean {
  if (!isInstitutionUrl(url)) return false;
  let path: any;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch (_e) {
    return false;
  }
  return !NON_OBJECT_PATH_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

/** Any link to an institution OBJECT page must be the stored url, exactly. */
function checkLinks(item: any, urls: any): any[] {
  const out: any[] = [];
  const stored = item?.url || "";
  for (const url of urls || []) {
    if (!isObjectPageUrl(url)) continue; // third-party or essay grounding
    if (!stored) {
      out.push({
        level: "warning",
        message: `no stored url for ${item.source}:${
          item.native_id
        } -- cannot verify ${url}`,
      });
      continue;
    }
    if (url !== stored) {
      out.push({
        level: "error",
        message: `link does not match the stored url. wrote ${url}, stored ${
          stored
        } -- a link to the wrong object looks like a working citation`,
      });
    }
  }
  return out;
}

/** Captions must stand alone; the feed order is random. */
function checkCrossReferences(caption: any): any[] {
  const text = String(caption || "");
  for (const re of SEQUENCE_PATTERNS) {
    if (re.test(text)) {
      return [
        {
          level: "error",
          message: `reads as if the reader has seen another item (${(text.match(
            re,
          ) || [""])[0].trim()}) -- the feed is randomly ordered`,
        },
      ];
    }
  }
  return [];
}

/** Volume must not loosen grounding. */
function checkClaims(claims: any): any[] {
  const out: any[] = [];
  (claims || []).forEach((c: any, i: number) => {
    if (!c?.source_url) {
      out.push({
        level: "error",
        message: `claim ${i + 1} has no source_url: ${String(
          c?.text || "",
        ).slice(0, 60)}`,
      });
    }
  });
  return out;
}

/** Wall text, as a warning. */
function checkReadability(caption: any): any[] {
  const out: any[] = [];
  const text = String(caption || "").trim();
  if (!text) return out;

  const words = text.split(/\s+/).length;
  if (words > MAX_WORDS) {
    out.push({
      level: "warning",
      message: `caption is long (${words} words, batch 09 ran 45-80)`,
    });
  }
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const n = s.split(/\s+/).length;
    if (n > MAX_SENTENCE_WORDS) {
      out.push({
        level: "warning",
        message: `one sentence runs ${n} words: "${s.slice(0, 70)}..."`,
      });
    }
  }
  return out;
}

/** Everything, for one drafted item. */

// Hosts SEEN returning 403 to us, recorded as found, so a citation to
// one reaches review as a dead link rather than costing a click to
// discover. Narrower than the never-direct-fetch rule (which is about
// not making requests at all).
const REFUSING_HOSTS = ["artuk.org"];

function checkRefusingHosts(claims: any): any[] {
  const out: any[] = [];
  for (const c of claims || []) {
    const host = hostOf(c?.source_url);
    if (!host) continue;
    if (REFUSING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
      out.push({
        level: "warning",
        message:
          `${c.source_url} is on a host that has returned 403 to us. A citation ` +
          `that does not open is worse than none -- ground it elsewhere`,
      });
    }
  }
  return out;
}

function checkItem(draft: any, item?: any): any[] {
  const urls: any[] = [];
  const caption = draft?.caption_tea || "";
  const linkRe = /https?:\/\/[^\s)"'\]]+/g;
  let m: RegExpExecArray | null = linkRe.exec(caption);
  while (m) {
    urls.push(m[0]);
    m = linkRe.exec(caption);
  }
  (draft.tea_voice_claims || []).forEach((c: any) => {
    if (c.source_url) urls.push(c.source_url);
  });
  (draft.links || []).forEach((u: any) => {
    urls.push(u);
  });

  return ([] as any[])
    .concat(checkLinks(item, urls))
    .concat(checkCrossReferences(caption))
    .concat(checkClaims(draft.tea_voice_claims))
    .concat(checkReadability(caption))
    .concat(checkRefusingHosts(draft.tea_voice_claims));
}

export {
  checkClaims,
  checkCrossReferences,
  checkItem,
  checkLinks,
  checkReadability,
  checkRefusingHosts,
  INSTITUTION_HOSTS,
  MAX_SENTENCE_WORDS,
  MAX_WORDS,
  REFUSING_HOSTS,
};
