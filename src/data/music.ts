// Tranquilo ambient music data.
//
// Retired from the load path -- music buckets now live in Postgres
// (sql/023_music_buckets.sql/024_music_buckets_seed.sql); app.js fetches
// them and hands them to <tranquilo-music-toggle> as a property. This
// file stays as a frozen reference for each track's sourcing/
// verification notes and as tests/data-schema.test.ts's fixture. Edit
// the seed SQL to actually change what plays; editing this file changes
// nothing a visitor hears.
//
// CATEGORY_TO_MUSIC_BUCKET is kept here too even though the live schema
// derives it from each bucket's own `category` column -- this frozen
// copy predates that simplification, and tests/data-schema.test.ts's
// integrity check keeps the two from silently disagreeing.
//
// Buckets hold { label, track, credit, creditUrl, license }; `track` is
// a direct audio URL or null if unsourced. A null-track bucket doesn't
// fade to silence -- whatever's already playing keeps playing until a
// bucket with a real track is reached (never a substitution).
//
// Bucket names are the original pre-rebrand, medium-based category set
// -- a naming coincidence, not a dependency: `item.category` has since
// been renamed twice while these 5 bucket names never needed to change,
// since "music mood" is deliberately its own layer.
import type { Category } from "../types/Item";
import type { MusicBucket, MusicBucketKey } from "../types/MusicBucket";

export const MUSIC_BUCKETS: Record<MusicBucketKey, MusicBucket> = {
  paintings: {
    label: "Paintings",
    category: "Paintings & Portraits",
    track:
      "https://archive.org/download/OpenGoldbergVariations/Kimiko%20Ishizaka%20-%20J.S.%20Bach-%20-Open-%20Goldberg%20Variations%2C%20BWV%20988%20%28Piano%29%20-%2001%20Aria.mp3",
    credit:
      "J.S. Bach, “Aria” (Goldberg Variations, BWV 988) — performed by Kimiko Ishizaka",
    creditUrl: "https://archive.org/details/OpenGoldbergVariations",
    license: "CC0 1.0 Universal",
  },
  "sculpture-decorative-arts": {
    label: "Sculpture & Decorative Arts",
    category: "Sculpture & Objects",
    // Still unsourced -- genuinely the hardest bucket (spans ancient
    // bronze through Asian ceramics through European decorative arts).
    // No candidate felt like more than a stretch, so left silent rather
    // than force a fit.
    track: null,
    credit: null,
    creditUrl: null,
    license: null,
  },
  "prints-drawings": {
    label: "Prints & Drawings",
    category: "Works on Paper",
    // Bach's Well-Tempered Clavier Prelude No. 1, same verified-CC0
    // project family as Paintings' Goldberg Aria (Kimiko Ishizaka /
    // Open Well-Tempered Clavier, released CC0 explicitly), chosen for
    // contrast against the fuller texture already anchoring Paintings.
    track:
      "https://archive.org/download/bach-well-tempered-clavier-book-1/Kimiko%20Ishizaka%20-%20Bach-%20Well-Tempered%20Clavier%2C%20Book%201%20-%2001%20Prelude%20No.%201%20in%20C%20major%2C%20BWV%20846.mp3",
    credit:
      'J.S. Bach, "Prelude No. 1 in C major" (Well-Tempered Clavier, Book 1, BWV 846) — performed by Kimiko Ishizaka',
    creditUrl: "https://archive.org/details/bach-well-tempered-clavier-book-1",
    license: "CC0 1.0 Universal",
  },
  "asian-art": {
    label: "Asian Art",
    // null, not pending: the current taxonomy has no Asian-art category
    // to assign this bucket, and CATEGORY_TO_MUSIC_BUCKET below is
    // already exhaustive without it.
    category: null,
    // TODO: source a verified CC0/public-domain recording. Kept as a
    // named bucket in case an item-level override is worth adding later.
    track: null,
    credit: null,
    creditUrl: null,
    license: null,
  },
  photographs: {
    label: "Photographs",
    category: "Photography",
    // Still unsourced. Tranquilo's photography items are Civil War-era
    // style, not period-original audio. One candidate exists -- "When
    // Johnny Comes Marching Home," Paul Althouse, a 1918 Victor recording
    // on archive.org, confirmed pre-1923 and thus federal public domain
    // under the Music Modernization Act -- but archive.org's item page
    // carries no explicit Usage/Rights field asserting it, unlike the
    // Bach/Haydn/Beethoven items below, so it's left for review rather
    // than decided unilaterally.
    track: null,
    credit: null,
    creditUrl: null,
    license: null,
  },
  "arms-armor": {
    label: "Arms & Armor",
    category: "Arms & Armor",
    // Beethoven's Coriolan Overture -- dramatic and tense without being
    // tied to any one region's armor tradition, matching this bucket's
    // globally-sourced span. Public Domain Mark 1.0, sourced via the
    // Musopen Collection's Internet Archive mirror since Musopen's own
    // site blocks automated fetches.
    track:
      "https://archive.org/download/MusopenCollectionAsFlac/Beethoven_CoriolanOverture/LudwigVanBeethoven-CoriolanOverture.mp3",
    credit: 'Ludwig van Beethoven, "Coriolan Overture," Op. 62 — Musopen',
    creditUrl: "https://archive.org/details/MusopenCollectionAsFlac",
    license: "Public Domain Mark 1.0",
  },
};

// Maps each catalogue category to its ambient-music bucket, 1:1. Keyed
// to item.category, so tests/data-schema.test.js's integrity test is the
// tripwire for a missed update if that value changes.
export const CATEGORY_TO_MUSIC_BUCKET: Record<Category, MusicBucketKey> = {
  "Paintings & Portraits": "paintings",
  "Sculpture & Objects": "sculpture-decorative-arts",
  "Works on Paper": "prints-drawings",
  "Photography": "photographs",
  "Arms & Armor": "arms-armor",
};
