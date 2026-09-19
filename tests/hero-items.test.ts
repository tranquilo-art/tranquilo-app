// The hero-rotation pool moved from a hardcoded array into Postgres, same
// migration shelves/music/storylines went through. hero_items references
// `items` by (source, native_id) rather than duplicating data -- media_type
// is read live via a join, so a reclassification pass can't leave a stale
// copy. This checks the round trip through that join, against real
// Postgres (PGlite), seeded from the actual migration files.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getHeroPool } from "../lib/hero-items.ts";
import { makeSql } from "./helpers/pg.ts";

type TestSql = {
  query: (
    statement: string,
    parameters?: unknown[],
  ) => Promise<Array<Record<string, unknown>>>;
  $close: () => Promise<void>;
};

type HeroEntry = { source: string; native_id: string; media_type: string };

function insertItem(
  sql: TestSql,
  source: string,
  nativeId: string,
  mediaType: string,
  overrides: Record<string, string> = {},
) {
  const row: Record<string, string> = {
    id: `${source}:${nativeId}`,
    source,
    native_id: nativeId,
    title: `Test ${nativeId}`,
    category: "Painting", // must be set: category != 'Photography' is NULL for a NULL category
    media_type: mediaType,
    ...overrides,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  return sql.query(
    `INSERT INTO items (${cols.join(", ")}) VALUES (${placeholders})`,
    cols.map((c) => row[c]),
  );
}

let sql: TestSql;
beforeAll(async () => {
  sql = await makeSql([
    "001_items_schema.sql",
    "003_items_harmonization.sql",
    "027_hero_items.sql",
    "028_hero_items_seed.sql",
  ]);
  // Only a handful of the seeded (source, native_id) pairs get a matching
  // `items` row -- the point of the "silently drops" test below.
  await insertItem(sql, "met", "191811", "Metalwork");
  await insertItem(sql, "met", "436528", "Painting");
  await insertItem(sql, "cleveland", "110180", "Painting");
});
afterAll(async () => {
  if (sql) await sql.$close();
});

describe("getHeroPool", () => {
  it("resolves each entry's media_type from the live items row, not a stored copy", async () => {
    const pool = (await getHeroPool(sql)) as HeroEntry[];
    const rodin = pool.find(
      (h) => h.source === "met" && h.native_id === "191811",
    );
    expect(rodin).toBeDefined();
    expect(rodin.media_type).toBe("Metalwork");
  });

  it("returns entries ordered by the seed's own position", async () => {
    const pool = (await getHeroPool(sql)) as HeroEntry[];
    const positions = pool.map((h) => `${h.source}:${h.native_id}`);
    expect(positions.indexOf("met:191811")).toBeLessThan(
      positions.indexOf("met:436528"),
    );
  });

  it("silently drops a hero whose item was never inserted (or has since been quarantined)", async () => {
    // The join simply excludes unmatched pairs -- the same fail-soft
    // behavior a real quarantined/rejected hero gets via LIVE_ITEMS_PREDICATE.
    const pool = (await getHeroPool(sql)) as HeroEntry[];
    expect(pool.length).toBe(3);
  });

  it("drops a hero item once it is quarantined, without touching hero_items itself", async () => {
    await sql.query(
      "UPDATE items SET review_status = 'quarantined' WHERE source = 'met' AND native_id = '191811'",
    );
    const pool = (await getHeroPool(sql)) as HeroEntry[];
    expect(pool.find((h) => h.native_id === "191811")).toBeUndefined();
    const stillSeeded = await sql.query(
      "SELECT 1 FROM hero_items WHERE source = 'met' AND native_id = '191811'",
    );
    expect(stillSeeded.length).toBe(1);
    // Restore so this test can't leak state if the runner reorders within a file.
    await sql.query(
      "UPDATE items SET review_status = 'ok' WHERE source = 'met' AND native_id = '191811'",
    );
  });

  it("only ever returns {source, native_id, media_type} -- no full item data", async () => {
    const pool = (await getHeroPool(sql)) as HeroEntry[];
    for (const h of pool) {
      expect(Object.keys(h).sort()).toEqual([
        "media_type",
        "native_id",
        "source",
      ]);
    }
  });
});
