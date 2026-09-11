// "All" opened on the same five artworks every session -- not a shuffle
// bug, but HERO_IDS hard-coding a small hand-picked set ahead of the
// random tail, reasoning that held when the catalogue was a few hundred
// items and a random tail was a real risk. At thousands of items the cost
// inverted: the mechanism meant to guarantee a good first impression
// reliably produced a stale one. Selection is pure and lives here so it
// can be tested without a browser; whether heroes show at all is a
// per-visitor decision in app.js, exercised by hero-rotation.spec.mts.
import { describe, expect, it } from "vitest";
import { HERO_COUNT, pickHeroes } from "../src/logic/logic";

// Shaped like the real pool entries: a key, and the medium that drives variety.
const pool = [
  { key: "met:191811", media_type: "Metalwork" },
  { key: "met:436528", media_type: "Painting" },
  { key: "met:261941", media_type: "Photograph" },
  { key: "met:438821", media_type: "Painting" },
  { key: "met:437397", media_type: "Painting" },
  { key: "cleveland:110180", media_type: "Painting" },
  { key: "met:252468", media_type: "Stone Sculpture" },
  { key: "cleveland:325449", media_type: "Photograph" },
  { key: "met:13875", media_type: "Textile" },
  { key: "cleveland:104361", media_type: "Print/Drawing" },
];

// Deterministic stand-in for Math.random, so a failure is reproducible.
function seeded(seed: any) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe("pickHeroes", () => {
  it("returns the requested number", () => {
    expect(pickHeroes(pool, HERO_COUNT, seeded(1))).toHaveLength(HERO_COUNT);
  });

  it("never repeats an item", () => {
    for (let s = 1; s < 40; s++) {
      const keys = pickHeroes(pool, HERO_COUNT, seeded(s)).map((h) => h.key);
      expect(new Set(keys).size, `seed ${s}`).toBe(keys.length);
    }
  });

  it("varies between sessions", () => {
    const a = pickHeroes(pool, HERO_COUNT, seeded(1))
      .map((h) => h.key)
      .join();
    const b = pickHeroes(pool, HERO_COUNT, seeded(99))
      .map((h) => h.key)
      .join();
    expect(a).not.toBe(b);
  });

  it("avoids two consecutive items of the same medium", () => {
    // The original five were ordered for tonal variety across mediums; a
    // rotation opening on four paintings in a row would be a worse first
    // impression than the fixed set it replaced.
    for (let s = 1; s < 40; s++) {
      const picked = pickHeroes(pool, HERO_COUNT, seeded(s));
      for (let i = 1; i < picked.length; i++) {
        expect(picked[i].media_type, `seed ${s} position ${i}`).not.toBe(
          picked[i - 1].media_type,
        );
      }
    }
  });

  it("still fills the run when variety cannot be satisfied", () => {
    // A pool of one medium can't alternate; the count wins and the
    // adjacency constraint yields, the same trade declusterOrder makes.
    const monotone = Array.from({ length: 6 }, (_, i) => ({
      key: `met:${i}`,
      media_type: "Painting",
    }));
    expect(pickHeroes(monotone, HERO_COUNT, seeded(3))).toHaveLength(
      HERO_COUNT,
    );
  });
});

describe("pool edge cases", () => {
  it("returns everything when the pool is smaller than the count", () => {
    const small = pool.slice(0, 3);
    expect(pickHeroes(small, HERO_COUNT, seeded(1))).toHaveLength(3);
  });

  it("returns nothing for an empty pool rather than throwing", () => {
    // No heroes is a valid state -- what a returning visitor gets.
    expect(pickHeroes([], HERO_COUNT, seeded(1))).toEqual([]);
    expect(pickHeroes(null, HERO_COUNT, seeded(1))).toEqual([]);
  });

  it("does not mutate the pool it was given", () => {
    // The pool is a module-level constant; mutating it would make every
    // later call depend on every earlier one.
    const before = pool.map((p) => p.key).join();
    pickHeroes(pool, HERO_COUNT, seeded(7));
    expect(pool.map((p) => p.key).join()).toBe(before);
  });
});

describe("keys are source-qualified", () => {
  it("keeps source and native_id together", () => {
    // A bare id no longer identifies one artwork now that the same id can
    // exist across collections.
    for (const h of pickHeroes(pool, HERO_COUNT, seeded(2))) {
      expect(h.key).toMatch(/^[a-z]+:.+/);
    }
  });
});
