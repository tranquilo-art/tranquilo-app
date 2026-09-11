// Shelves and music buckets moved from hardcoded arrays into Postgres,
// same migration storylines went through. Runs against PGlite -- real
// Postgres, in-process, seeded from the actual seed files rather than a
// hand-copied fixture, so a change to schema or seed data is exercised here.
//
// Cross-checking a hero shelf's itemIds or a music category against the
// live catalogue is data-schema.test.ts's job, not this file's -- this
// only checks that seeded rows round-trip through lib/shelves.ts/lib/music.ts
// in the shape the client expects.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMusicBuckets } from "../lib/music.ts";
import { getShelves } from "../lib/shelves.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: any;
let SHELVES: any[];
let MUSIC_BUCKETS: Record<string, any>;
beforeAll(async () => {
  sql = await makeSql([
    "021_shelves.sql",
    "022_shelves_seed.sql",
    "023_music_buckets.sql",
    "024_music_buckets_seed.sql",
  ]);
  SHELVES = await getShelves(sql);
  MUSIC_BUCKETS = await getMusicBuckets(sql);
});
afterAll(async () => {
  if (sql) await sql.$close();
});

describe("shelves actually loaded from the seed migration", () => {
  it("seeded at least one shelf of each type", () => {
    expect(SHELVES.some((s) => s.type === "hero")).toBe(true);
    expect(SHELVES.some((s) => s.type === "rule")).toBe(true);
  });

  it("preserves seed order (position), not insertion or alphabetical order", () => {
    expect(SHELVES.map((s) => s.id)).toEqual([
      "storylines",
      "painted-by-themselves",
      "pets-in-art",
      "merry-company",
      "creature-curiosities",
      "old-world-portraiture",
      "birdwatching",
    ]);
  });

  it("every hero shelf has an itemIds array, including mixed numeric/string (Commons filename) ids", () => {
    const birdwatching = SHELVES.find((s) => s.id === "birdwatching");
    expect(Array.isArray(birdwatching.itemIds)).toBe(true);
    expect(birdwatching.itemIds).toContain(140408);
    expect(birdwatching.itemIds).toContain("File:A Colorful Spring.jpg");
  });

  it("the storylines shelf seeds with an empty itemIds array, computed client-side instead", () => {
    const storylines = SHELVES.find((s) => s.id === "storylines");
    expect(storylines.itemIds).toEqual([]);
  });

  it("the one rule shelf carries its filter and minItems, not itemIds", () => {
    const ruleShelf = SHELVES.find((s) => s.type === "rule");
    expect(ruleShelf.itemIds).toBeUndefined();
    expect(ruleShelf.filter).toEqual({
      category: "Paintings & Portraits",
      region_primary: "Europe",
      subject_type: "portrait",
    });
    expect(ruleShelf.minItems).toBe(10);
  });

  it("a hero shelf carries itemIds, not filter/minItems", () => {
    const heroShelf = SHELVES.find((s) => s.id === "merry-company");
    expect(heroShelf.filter).toBeUndefined();
    expect(heroShelf.minItems).toBeUndefined();
  });
});

describe("music buckets actually loaded from the seed migration", () => {
  it("seeded all 6 buckets, keyed by bucket key", () => {
    expect(Object.keys(MUSIC_BUCKETS).sort()).toEqual([
      "arms-armor",
      "asian-art",
      "paintings",
      "photographs",
      "prints-drawings",
      "sculpture-decorative-arts",
    ]);
  });

  it("a sourced bucket carries its track/credit/creditUrl/license", () => {
    const paintings = MUSIC_BUCKETS.paintings;
    expect(paintings.category).toBe("Paintings & Portraits");
    expect(paintings.track).toMatch(/^https:\/\/archive\.org/);
    expect(paintings.credit).toContain("Bach");
    expect(paintings.license).toBe("CC0 1.0 Universal");
  });

  it("an unsourced bucket has a null track without erroring", () => {
    expect(MUSIC_BUCKETS["sculpture-decorative-arts"].track).toBeNull();
  });

  it("asian-art has no category, by design -- a real, permanent orphan", () => {
    expect(MUSIC_BUCKETS["asian-art"].category).toBeNull();
  });

  it("every non-null category is unique across buckets (the 1:1 relationship the old CATEGORY_TO_MUSIC_BUCKET map used to state separately)", () => {
    const categories = Object.values(MUSIC_BUCKETS)
      .map((b: any) => b.category)
      .filter((c): c is string => c !== null);
    expect(new Set(categories).size).toBe(categories.length);
  });
});
