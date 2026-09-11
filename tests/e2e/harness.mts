// Shared setup for the functional suite. Everything outbound is stubbed.
// /img/** is not optional: unstubbed, a full run would pull hundreds of
// images through the proxy to Commons, the Met, Cleveland and Smithsonian
// on every CI run, and Commons is under a standing rate-limit hold.
// /api/track is not optional either: unstubbed, every run would write fake
// events into the real events table and corrupt the numbers decisions are
// made from. /api/items is served from a captured fixture so runs are
// deterministic and need no DATABASE_URL.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import * as realApi from "../../api/items.ts";
import { MUSIC_BUCKETS } from "../../src/data/music.ts";
import { SHELVES } from "../../src/data/shelves.ts";

// The three image-stub switches (failImages/serveTallImage/serveWideImage
// below) stash their predicate directly on the Page instance rather than in
// a side map, so the img route handler in stubBackend() can read it back
// without threading extra state through every gotoFeed()/gotoArtwork() call.
declare module "@playwright/test" {
  interface Page {
    __failImages?: (url: string) => boolean;
    __tallImages?: (url: string) => boolean;
    __wideImages?: (url: string) => boolean;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ITEMS = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/e2e-items.json"), "utf8"),
);

// Frozen snapshot of the old js/storylines.js content, matching the shape
// /api/items?shape=storylines/storyline answers with now that the live
// database holds it (sql/020_storylines_seed.sql).
export const STORYLINES = JSON.parse(
  readFileSync(path.join(__dirname, "../fixtures/storylines.json"), "utf8"),
);

// Same reasoning as STORYLINES: shelves/music buckets moved to Postgres too
// (sql/021-024), and src/data/shelves.ts/music.ts are the frozen snapshot
// /api/items?shape=shelves/music answers with instead.

// Storylines reference real catalogue ids and this fixture is a captured
// subset -- redon-apocalypse's twelve chapters are not in it, so that
// storyline renders blank chapters here through no fault of the code.
// Hard-coding STORYLINES[0] would break silently whenever the fixture is
// recaptured; picking one it can actually render keeps the test about the
// behaviour it names. `withSourceNote` narrows further: 8 of 11 storylines
// carry a `source_note`, and the three `structural` ones have nothing to cite.
export function fixtureStoryline({
  withSourceNote,
}: {
  withSourceNote?: boolean;
} = {}) {
  const have = new Set(ITEMS.map((i: any) => String(i.id)));
  const complete = STORYLINES.filter((s: any) =>
    s.items.every((c: any) => have.has(String(c.id))),
  );
  const found =
    withSourceNote === undefined
      ? complete[0]
      : complete.find((s: any) => Boolean(s.source_note) === withSourceNote);
  if (!found)
    throw new Error(
      `no fixture-complete storyline with source_note=${withSourceNote}`,
    );
  return found;
}

// 1x1 transparent PNG. Real bytes, so the <img> fires a genuine `load`
// event; a stubbed 204 would fire `error` instead and send every slide
// down the failure path.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// A real 900x1200 (1:1.33 portrait) solid PNG, for the test needing an
// image with actual tall-aspect-ratio pixels: PNG_1X1 never gets
// width-constrained, so it can't exercise the height-overflow bug this covers.
const TALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAA4QAAASwCAIAAAAsYBNZAAAWYklEQVR4nO3WMQEAIAzAsIEulKAE+cjokxjo2/XuGQ" +
    "AAKOykCgAAZhQAgJIZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQA" +
    "gIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAM" +
    "iYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICM" +
    "GQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImF" +
    "EAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkF" +
    "ACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAA" +
    "AyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAg" +
    "Y0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMm" +
    "YUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNG" +
    "AQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFA" +
    "CAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEA" +
    "yJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgI" +
    "wZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiY" +
    "UQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQ" +
    "UAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEA" +
    "ADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFAC" +
    "BjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAy" +
    "ZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0" +
    "YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYU" +
    "AICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQ" +
    "DImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACA" +
    "jBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJ" +
    "hRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZ" +
    "BQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQ" +
    "AAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUA" +
    "IGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAAD" +
    "JmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBj" +
    "RgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZh" +
    "QAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YB" +
    "AMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAI" +
    "CMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDI" +
    "mFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjB" +
    "kFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhR" +
    "AAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQ" +
    "AgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAA" +
    "MmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIG" +
    "NGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJm" +
    "FACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRg" +
    "EAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQA" +
    "gIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAM" +
    "iYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICM" +
    "GQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImF" +
    "EAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkF" +
    "ACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAA" +
    "AyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAg" +
    "Y0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMm" +
    "YUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNG" +
    "AQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFA" +
    "CAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEA" +
    "yJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgI" +
    "wZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiY" +
    "UQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQ" +
    "UAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEA" +
    "ADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFAC" +
    "BjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAy" +
    "ZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0" +
    "YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYU" +
    "AICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQ" +
    "DImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACA" +
    "jBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJ" +
    "hRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZ" +
    "BQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQ" +
    "AAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUA" +
    "IGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAAD" +
    "JmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBj" +
    "RgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZh" +
    "QAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YB" +
    "AMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAI" +
    "CMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDI" +
    "mFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjB" +
    "kFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhR" +
    "AAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQ" +
    "AgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAA" +
    "MmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIG" +
    "NGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJm" +
    "FACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRg" +
    "EAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQA" +
    "gIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAM" +
    "iYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICM" +
    "GQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImF" +
    "EAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkF" +
    "ACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAA" +
    "AyZhQAgIwZBQAgY0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAg" +
    "Y0YBAMiYUQAAMmYUAICMGQUAIGNGAQDImFEAADJmFACAjBkFACBjRgEAyJhRAAAyZhQAgIwZBQAgY0YBAMiYUQAAMm" +
    "YUAICMGQUAIGNGAQDImFEAADJmFACAjBkFAGAqH5ThCm7wKSV0AAAAAElFTkSuQmCC",
  "base64",
);

// The paired 1200x400 (3:1 landscape) case, proving the fix removes the
// crop rather than just moving it.
const WIDE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAABLAAAAGQCAIAAAAx1w4JAAAI6klEQVR4nO3XQQEAEADAQOSSRBLxxfDYXYJ9N/e5Aw" +
    "AAgJ71OwAAAIA/DCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKE" +
    "MIAAAQZQgBAACiDCEAAECUIQQAAIgyhAAAAFGGEAAAIMoQAgAARBlCAACAKEMIAAAQZQgBAACiDCEAAECUIQQAAIgy" +
    "hAAAAFGGEAAAIMoQAgAARBlCAACA0fQAHWkELqGKH4QAAAAASUVORK5CYII=",
  "base64",
);

export async function stubBackend(
  page: Page,
  { items = ITEMS }: { items?: any[] } = {},
) {
  // The pages carry a hostname guard against analytics; this is a second
  // layer so nothing reaches Cloudflare or PostHog from here even if that
  // guard regresses, since Playwright's fresh context per test once made
  // the suite report itself as real traffic.
  await page.route("**/static.cloudflareinsights.com/**", (route: Route) =>
    route.abort(),
  );
  await page.route("**/cloudflareinsights.com/**", (route: Route) =>
    route.abort(),
  );
  await page.route("**/i.posthog.com/**", (route: Route) => route.abort());

  // /v/{slug} must serve the app, since the feed syncs the URL as you
  // scroll and any reload mid-feed lands on a /v/ URL. Injected at the
  // start of <head>, as api/v/[slug].js does -- injecting at </head> would
  // leave the stylesheet resolving against /v/ and 404ing. Reads
  // dist/index.html since the test server only serves the built output.
  const appHtml = readFileSync(
    path.join(__dirname, "../../dist/index.html"),
    "utf8",
  ).replace("<head>", '<head>\n<base href="/">');
  await page.route("**/v/**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: appHtml }),
  );

  // /s/{id} serves the app the same way, since vercel.json rewrites it into
  // the same handler. A RegExp rather than the glob "**/s/*": Playwright's
  // "**" matches across "/", so that glob also matches any path with an
  // "s/" segment buried in it (e.g. ".../assets/main.js") and would
  // swallow an application asset.
  await page.route(/\/s\/[^/]+$/, (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: appHtml }),
  );

  // The stub emulates the endpoint's shapes, not just its data: the client
  // makes three different requests against /api/items, each structurally
  // different, so a stub answering all three with the same array would
  // crash the client on `body.items`.
  const MANIFEST_FIELDS = [
    "id",
    "source",
    "title",
    "artist",
    "category",
    "timeframe",
    "palette",
    "media_type",
    "region_primary",
    "region_alt",
    "subject_type",
    "storyline_ids",
    "contains_nudity",
    "twist_category",
    // The item's position in the feed order, so a deep link can start
    // the feed AT its target instead of scrolling to it.
    "shuffle_key",
  ];
  const toManifest = (i: any) =>
    Object.fromEntries(MANIFEST_FIELDS.map((f) => [f, i[f]]));

  // The cursor codec is imported from api/items.js rather than
  // reimplemented, since a stub inventing its own encoding can't catch a
  // cursor bug -- this endpoint was once bitten by a truncated timestamp
  // making every page return the same rows.
  // A stable pseudo-random key per item, standing in for the shuffle_key
  // column. Deterministic so a failing run can be reproduced.
  const keyed = items.map((item, n) => ({
    ...item,
    shuffle_key: ((n * 2654435761) % 4294967296) / 4294967296,
  }));
  const byKey = keyed
    .slice()
    .sort(
      (a, b) =>
        a.shuffle_key - b.shuffle_key ||
        String(a.id).localeCompare(String(b.id)),
    );

  await page.route("**/api/items**", (route: Route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const shape = url.searchParams.get("shape");

    // Storylines, dispatched first since they're a different shape
    // entirely, reshaped into the real endpoint's two response shapes.
    if (shape === "storylines") {
      return json(
        STORYLINES.map((s: any) => ({
          id: s.id,
          cover_item_id: s.cover_item_id,
          items: s.items.map((c: any) => ({ id: c.id, position: c.position })),
        })),
      );
    }
    if (shape === "storyline") {
      const found = STORYLINES.find(
        (s: any) => s.id === url.searchParams.get("id"),
      );
      if (!found) {
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "No such storyline" }),
        });
      }
      return json(found);
    }

    // Discover shelves and ambient-music buckets, same reasoning as
    // storylines above, reshaped into the real endpoint's response shapes.
    if (shape === "shelves") {
      return json(
        SHELVES.map((s) =>
          s.type === "hero"
            ? { id: s.id, title: s.title, type: s.type, itemIds: s.itemIds }
            : {
                id: s.id,
                title: s.title,
                type: s.type,
                filter: s.filter,
                minItems: s.minItems,
              },
        ),
      );
    }
    if (shape === "music") {
      return json(MUSIC_BUCKETS);
    }
    // The hero-rotation pool is empty in this stub rather than a fixture,
    // since no e2e spec asserts on hero content specifically; an empty
    // pool means pickHeroes() returns nothing, the same fail-soft path a
    // genuinely empty production pool would take.
    if (shape === "heroes") {
      return json([]);
    }
    // Same reasoning as heroes above: no e2e spec exercises set-of-works
    // content specifically, and app.ts fetches this index unconditionally
    // at startup, so an unstubbed shape here would fail every spec's
    // gotoFeed() rather than just the ones that care about it.
    if (shape === "set_of_works") {
      return json([]);
    }

    // ?ids=a&ids=b, one param per id. getAll(), never a comma split: 41
    // live Commons items have a comma in their native_id, and a comma-split
    // stub would hide exactly the bug the real endpoint had.
    const wanted = url.searchParams.getAll("ids");
    if (wanted.length) {
      const found = keyed.filter((i) => wanted.includes(String(i.id)));
      const foundIds = new Set(found.map((i) => String(i.id)));
      return json({
        items: found,
        missing: wanted.filter((id) => !foundIds.has(id)),
      });
    }

    // How many rows match, without shipping any -- what search's results
    // line reads, replacing counting fetched rows client-side.
    if (shape === "count") {
      const q = url.searchParams.get("q");
      let rows = keyed;
      if (q) {
        const needle = q
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        rows = rows.filter((i) =>
          MANIFEST_FIELDS.concat(["medium", "tags", "bio", "date"])
            .map((f) => String(i[f] ?? ""))
            .join(" ")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .includes(needle),
        );
      }
      for (const facet of [
        "category",
        "timeframe",
        "palette",
        "media_type",
        "source",
        "subject_type",
        "artist",
      ]) {
        const v = url.searchParams.get(facet);
        if (v) rows = rows.filter((i) => String(i[facet] ?? "") === v);
      }
      if (url.searchParams.get("has_storyline") === "1") {
        rows = rows.filter(
          (i) => i.storyline_ids && i.storyline_ids.length > 0,
        );
      }
      return json({ total: rows.length });
    }

    // The catalogue's shape, bounded by distinct values so it's complete in one response.
    if (shape === "facets") {
      const tally = (field: string, min = 0) => {
        const counts = new Map();
        for (const i of keyed) {
          const v = i[field];
          if (v === undefined || v === null || v === "") continue;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        return [...counts.entries()]
          .filter(([, n]) => n >= min)
          .sort(
            (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
          )
          .map(([value, count]) => ({ value, count }));
      };
      return json({
        categories: tally("category"),
        sources: tally("source"),
        artist: tally("artist", 2).slice(0, 50),
        region: tally("region_primary", 10),
        era: tally("timeframe", 10),
        type: tally("media_type", 10),
        color: tally("palette", 10),
        total: keyed.length,
      });
    }

    // Autocomplete. Mirrors the real ordering (type rank, then item count)
    // closely enough to exercise the client's grouping and stale-response guard.
    if (shape === "suggest") {
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      if (q.length < 2) return json({ suggestions: [] });
      const RANK: Record<string, number> = {
        Artist: 0,
        Category: 1,
        Region: 2,
        Era: 3,
        Type: 4,
        Color: 5,
        Medium: 6,
        Tag: 7,
        Title: 8,
      };
      const seen = new Map();
      const add = (value: unknown, type: string) => {
        if (!value) return;
        const key = String(value)
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
        if (!key.includes(q)) return;
        const hit = seen.get(key);
        if (!hit) {
          seen.set(key, { value: String(value).trim(), type, itemCount: 1 });
        } else {
          hit.itemCount++;
          if (RANK[type] < RANK[hit.type]) {
            hit.type = type;
            hit.value = String(value).trim();
          }
        }
      };
      for (const i of keyed) {
        add(i.artist, "Artist");
        add(i.category, "Category");
        add(i.region_primary, "Region");
        add(i.timeframe, "Era");
        add(i.media_type, "Type");
        add(i.palette, "Color");
        add(i.medium, "Medium");
        add(i.title, "Title");
        if (i.tags)
          String(i.tags)
            .split(",")
            .forEach((t) => {
              add(t.trim(), "Tag");
            });
      }
      return json({
        suggestions: [...seen.values()]
          .sort(
            (a, b) =>
              RANK[a.type] - RANK[b.type] ||
              b.itemCount - a.itemCount ||
              String(a.value).localeCompare(String(b.value)),
          )
          .slice(0, 8),
      });
    }

    // Did-you-mean candidates. The client still scores them with
    // findDidYouMean(), so this only has to narrow the field.
    if (shape === "correction") {
      const words = new Set();
      for (const i of keyed) {
        for (const f of [i.title, i.artist, i.medium, i.tags]) {
          String(f ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .split(/[^a-z0-9]+/)
            .forEach((w) => {
              if (w.length >= 3) words.add(w);
            });
        }
      }
      return json({ candidates: [...words] });
    }

    // Server-side search, mirroring matchesQuery()'s substring-over-many-fields
    // behaviour closely enough to exercise the client's handling of it.
    const q = url.searchParams.get("q");
    let rows = byKey;
    if (q) {
      const needle = q
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      rows = rows.filter((i) =>
        MANIFEST_FIELDS.concat(["medium", "tags", "bio", "date"])
          .map((f) => String(i[f] ?? ""))
          .join(" ")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .includes(needle),
      );
    }
    for (const facet of [
      "category",
      "timeframe",
      "palette",
      "media_type",
      "source",
      "subject_type",
    ]) {
      const v = url.searchParams.get(facet);
      if (v) rows = rows.filter((i) => String(i[facet] ?? "") === v);
    }
    const region = url.searchParams.get("region_primary");
    if (region) {
      rows = rows.filter(
        (i) =>
          i.region_primary === region ||
          (Array.isArray(i.region_alt) && i.region_alt.includes(region)),
      );
    }
    const artist = url.searchParams.get("artist");
    if (artist) rows = rows.filter((i) => i.artist === artist);
    if (url.searchParams.get("has_storyline") === "1") {
      rows = rows.filter((i) => i.storyline_ids && i.storyline_ids.length > 0);
    }

    // The shuffle-ordered feed page: seek past the cursor (or the session's
    // start offset), wrap once at the top of the key space, and stop where the
    // session began.
    if (shape === "manifest" && url.searchParams.get("order") === "shuffle") {
      const limit = Number(url.searchParams.get("limit")) || 60;
      const rawCursor = url.searchParams.get("cursor");
      let start: any, afterKey: any, afterId: any, wrapped: any;
      if (rawCursor) {
        const c = realApi.decodeShuffleCursor(rawCursor);
        start = c.start;
        afterKey = c.shuffleKey;
        afterId = c.nativeId;
        wrapped = c.wrapped;
      } else {
        start = Number(url.searchParams.get("start"));
        if (!Number.isFinite(start) || start < 0 || start >= 1) {
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "start must be a number in [0,1)" }),
          });
        }
        afterKey = start;
        afterId = "";
        wrapped = false;
      }
      let window = rows.filter(
        (i) =>
          i.shuffle_key > afterKey ||
          (i.shuffle_key === afterKey && String(i.id) > afterId),
      );
      if (wrapped) window = window.filter((i) => i.shuffle_key < start);
      const page = window.slice(0, limit);
      const last = page[page.length - 1];
      let next: any;
      if (page.length === limit && last) {
        next = realApi.encodeShuffleCursor(
          last.shuffle_key,
          String(last.id),
          start,
          wrapped,
        );
      } else if (!wrapped) {
        next = realApi.encodeShuffleCursor(-1, "", start, true);
      } else {
        next = null;
      }
      return json({ items: page.map(toManifest), next_cursor: next });
    }

    if (shape === "manifest") {
      return json(rows.map(toManifest));
    }

    // A bare request is a 400 in production -- the unpaginated
    // whole-catalogue response is gone. Mirrored here so a
    // regression to fetching everything fails in the suite rather than being
    // quietly served a convenience the real endpoint would refuse.
    if (!url.searchParams.get("limit") && !url.searchParams.get("cursor")) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "This endpoint no longer returns the whole catalogue in one response.",
        }),
      });
    }

    const limit = Number(url.searchParams.get("limit")) || 60;
    return json({ items: rows.slice(0, limit), next_cursor: null });
  });
  await page.route("**/api/track**", (route: Route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route("**/api/subscribe**", (route: Route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  // Images resolve to a 1x1 PNG by default. A test can opt into failure for
  // specific requests via failImages(page, predicate) BEFORE gotoFeed -- see
  // that helper for why this is a switch on the stub rather than an unstub.
  await page.route("**/img/**", (route: Route) => {
    const fail = page.__failImages;
    if (fail?.(route.request().url())) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Image temporarily unavailable" }),
      });
    }
    const tall = page.__tallImages;
    if (tall?.(route.request().url())) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: TALL_PNG,
      });
    }
    const wide = page.__wideImages;
    if (wide?.(route.request().url())) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: WIDE_PNG,
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PNG_1X1,
    });
  });
}

// Waits for the feed to have rendered its slides.
export async function gotoFeed(page: Page, hash = "") {
  await stubBackend(page);
  // Heroes rotate per page load in production, varying slide positions
  // between runs. Pinning the seed makes the opening deterministic without
  // disabling the feature. Only if a spec hasn't chosen its own -- init
  // scripts run in registration order, so an unconditional assignment here
  // would silently overwrite a seed a test set.
  await page.addInitScript(() => {
    if (typeof window.__tranquiloHeroSeed !== "number")
      window.__tranquiloHeroSeed = 1;
  });
  await page.goto(`/index.html${hash}`);
  // Waits for the render to settle, not for slides to exist: the intro
  // slide and hero openers are appended before the first page comes back,
  // so ">1 slide" can be satisfied before any catalogue items load.
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.locator("#feed");
}

// A cold load onto one artwork's own /v/{slug} URL. renderFeed's deep-link
// branch puts the target at slide 0, the only way to open a known item
// without hunting, since the feed otherwise shuffles per session.
export async function gotoArtwork(
  page: Page,
  source: string,
  id: string | number,
) {
  await stubBackend(page);
  await page.goto(`/v/${encodeURIComponent(`${source}-${id}`)}`);
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  return page.locator("#feed .slide").first();
}

// A cold load straight onto a storyline's own URL. Waits for the feed
// first and the overlay second, deliberately: /s/{id} renders the feed and
// opens the storyline on top of it, so a helper that only waited for the
// overlay would pass on a page with nothing underneath.
export async function gotoStoryline(
  page: Page,
  id: string,
  { expectOpen = true }: { expectOpen?: boolean } = {},
) {
  await stubBackend(page);
  await page.goto(`/s/${encodeURIComponent(id)}`);
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );
  if (expectOpen) await page.waitForSelector("#storylineMode.open");
  return page.locator("#storylineMode");
}

// The feed scrolls its own container, which animates (`scroll-behavior:
// smooth`) and self-adjusts (scroll-snap mandatory), so reading scrollTop
// straight after assigning it returns the old value. Assign, then poll
// until the position stops changing.
//
// Waits for the feed to finish an async render: renderFeed() awaits a page
// from the server, so reading slides straight after a click races the
// fetch. Used as: read the counter, do the thing, wait for it to change --
// capturing the counter before the action is the point, since waiting for
// "some render to have happened" can't distinguish a new one from what was
// already on screen.
export async function feedRenderCount(page: Page) {
  return page.evaluate(() => window.__tranquiloFeedRenders || 0);
}

export async function waitForFeedRender(
  page: Page,
  since: number,
  timeout = 10000,
) {
  await page.waitForFunction(
    (n: number) => (window.__tranquiloFeedRenders || 0) > n,
    since,
    { polling: 50, timeout },
  );
  // The recycling window runs on requestAnimationFrame, so the shells exist by
  // the line above but their contents land a frame later.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

// Do something that re-renders the feed, and wait for it to settle.
export async function actAndSettle(page: Page, action: () => Promise<void>) {
  const before = await feedRenderCount(page);
  await action();
  await waitForFeedRender(page, before);
}

export async function scrollToSlide(page: Page, index: number) {
  // The feed is paged, so the target slide may not exist yet: assigning
  // scrollTop past the last loaded slide simply clamps. Walking there
  // (scroll to the current end, wait for growth, repeat) is what a real
  // visitor does and the only way the pager is asked to extend; it gives
  // up when the feed genuinely stops growing.
  for (let guard = 0; guard < 40; guard++) {
    const count = await page.evaluate(
      () => document.querySelectorAll("#feed .slide").length,
    );
    if (count > index) break;
    await page.evaluate(() => {
      const feed = document.getElementById("feed")!;
      feed.scrollTop = feed.scrollHeight;
    });
    const grew = await page
      .waitForFunction(
        (n: number) => document.querySelectorAll("#feed .slide").length > n,
        count,
        { polling: 50, timeout: 3000 },
      )
      .then(
        () => true,
        () => false,
      );
    if (!grew) break;
  }

  await page.evaluate((i: number) => {
    const feed = document.getElementById("feed")!;
    feed.scrollTop = i * feed.clientHeight;
  }, index);

  // Waits for the feed to arrive at the target, not merely stop changing:
  // polling until scrollTop reads the same value twice produced a real
  // ~1-in-5 flake under CPU contention, where the animation hadn't started
  // by the first two polls and stability was mistaken for completion.
  // Tolerance is one third of a slide since scroll-snap doesn't always
  // land on an exact multiple.
  await page.waitForFunction(
    (i: number) => {
      const feed = document.getElementById("feed")!;
      const target = i * feed.clientHeight;
      return Math.abs(feed.scrollTop - target) < feed.clientHeight / 3;
    },
    index,
    { polling: 50, timeout: 10000 },
  );

  // The recycling window updates on requestAnimationFrame.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

// The index the feed is actually resting on, by the same arithmetic the
// recycling window uses.
export function activeIndex(page: Page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed")!;
    return Math.round(feed.scrollTop / feed.clientHeight);
  });
}

// How many slides are actually built, as opposed to present as empty shells.
export function hydratedCount(page: Page) {
  return page.evaluate(
    () =>
      document.querySelectorAll("#feed .slide").length -
      document.querySelectorAll("#feed .slide:empty").length,
  );
}

// Makes the image stub return 503 for requests matching `predicate(url)`.
// Deliberately a switch on the existing stub rather than removing it: an
// unstubbed run would pull hundreds of images through the proxy on every
// CI run against Commons's standing rate-limit hold, and a local 503 is a
// more reproducible simulation of a failure than a real outage anyway.
// Call before gotoFeed(), since slides start loading immediately.
export function failImages(page: Page, predicate: (url: string) => boolean) {
  page.__failImages = predicate;
}

// Makes the image stub return TALL_PNG for requests matching
// `predicate(url)`, since the crop-at-the-top bug only exists for images
// with real portrait-aspect pixels. Call before gotoFeed(), same as failImages().
export function serveTallImage(
  page: Page,
  predicate: (url: string) => boolean,
) {
  page.__tallImages = predicate;
}

// Makes the image stub return WIDE_PNG for requests matching
// `predicate(url)`, covering the non-portrait orientation for the
// containment check -- landscape at this size overflows the same way
// portrait does pre-fix, so this is a second real case, not a control.
// Call before gotoFeed(), same as failImages().
export function serveWideImage(
  page: Page,
  predicate: (url: string) => boolean,
) {
  page.__wideImages = predicate;
}
