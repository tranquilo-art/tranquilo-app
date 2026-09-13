/* Does pinning actually protect what it names? Against real PostgreSQL,
 * deliberately -- the pin filter lives in SQL, and img-eviction.test.ts
 * drives eviction through a JS double that reimplements it, bug included,
 * so it can't see this.
 *
 * The defect: cache_key is `source:id:tier`, and Commons native ids contain
 * colons, so split_part(cache_key, ':', 2) returns "File" for every live
 * Commons key. Harmless today only because PINNED_IDS holds Met numerics
 * that never collide with "File" -- but IMG_PINNED_IDS is env-configurable,
 * and then it fails in both directions, which these two tests cover.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSql } from "./helpers/pg.ts";

const CAP = 1000;
const OVER = 950; // above the 90% high-water mark, so eviction runs

let sql: any, deleted: any;
const del = async (key: string) => {
  deleted.push(key);
};

let reloadCounter = 0;

/** Re-imports under a fresh query string so it re-reads IMG_PINNED_IDS,
 *  which it resolves at import time -- an ESM module cache is keyed by
 *  specifier, so a plain re-import returns the already-evaluated module. */
function withPinned(ids: string | null) {
  if (ids === null) delete process.env.IMG_PINNED_IDS;
  else process.env.IMG_PINNED_IDS = ids;
  const specifier = `../lib/img-eviction.ts?reload=${reloadCounter++}`;
  return import(specifier);
}

beforeEach(async () => {
  sql = await makeSql([
    "010_img_fetch_state.sql",
    "011_img_cache_entries.sql",
    "025_img_cache_native_id.sql",
    "009_blob_usage_tracker_schema.sql",
  ]);
  deleted = [];
  await sql.query(
    "INSERT INTO blob_usage_tracker (id, total_bytes) VALUES (1, $1) " +
      "ON CONFLICT (id) DO UPDATE SET total_bytes = $1",
    [OVER],
  );
});
afterEach(async () => {
  if (sql) await sql.$close();
  await withPinned(null); // never leak the env var into another file
});

/** age in seconds: larger is colder, so it is chosen for eviction sooner. */
const entry = (key: string, bytes: number, age: number) =>
  sql(
    "INSERT INTO img_cache_entries (cache_key, source, tier, bytes, requests, last_seen, admitted_at) " +
      "VALUES ($1, split_part($1, ':', 1), 'display', $2, 3, now() - ($3 || ' seconds')::interval, now())",
    [key, bytes, String(age)],
  );

describe("pinning an id that contains colons", () => {
  it("protects it, even when it is the coldest thing in the cache", async () => {
    const commons = "commons:File:A Colorful Spring.jpg:display";
    await entry(commons, 400, 99999); // by far the coldest
    await entry("met:9999999:display", 400, 10); // much warmer

    const evict = await withPinned("File:A Colorful Spring.jpg");
    const out = await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });

    expect(out.evicted).toBeGreaterThan(0); // it did evict something
    expect(deleted).not.toContain(commons); // just not the pinned one
    expect(deleted).toContain("met:9999999:display");
  });
});

describe('pinning the literal "File"', () => {
  it("does not silently protect every Commons object at once", async () => {
    // With a naive split, "File" matches every live Commons key, all become
    // unevictable, and the storage breaker trips on a cache that's mostly
    // Commons -- caching quietly stops rather than an image going missing.
    await entry("commons:File:One.jpg:display", 400, 99999);
    await entry("commons:File:Two.jpg:display", 400, 99998);

    const evict = await withPinned("File");
    const out = await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });

    expect(out.evicted).toBeGreaterThan(0);
    expect(deleted.length).toBeGreaterThan(0);
  });
});

describe("what pinning already does, which must not regress", () => {
  it("still protects a plain numeric id", async () => {
    const evict = await withPinned(null);
    const pinned = `met:${evict.PINNED_IDS[0]}:display`;
    await entry(pinned, 400, 99999);
    await entry("met:9999999:display", 400, 10);
    await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });
    expect(deleted).not.toContain(pinned);
  });

  it("covers BOTH tiers of a pinned item", async () => {
    // PINNED_IDS holds ids rather than cache keys, so pinning a hero
    // protects both its display and lightbox objects.
    const evict = await withPinned(null);
    const id = evict.PINNED_IDS[0];
    await entry(`met:${id}:display`, 400, 99999);
    await sql.query(
      "INSERT INTO img_cache_entries (cache_key, source, tier, bytes, requests, last_seen) " +
        "VALUES ($1, 'met', 'lightbox', 400, 3, now() - interval '99999 seconds')",
      [`met:${id}:lightbox`],
    );
    await entry("met:9999999:display", 400, 10);
    await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });
    expect(deleted.filter((k: any) => k.includes(id))).toEqual([]);
  });

  it("does not pin an unrelated id that merely shares a prefix", async () => {
    const evict = await withPinned("1234");
    await entry("met:12345:display", 400, 99999);
    await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });
    expect(deleted).toContain("met:12345:display");
  });
});

describe("the dry run agrees with the real pass", () => {
  it("previews the same victims it would actually take", async () => {
    // Both queries carry their own copy of the pin filter -- if only one is
    // fixed, a dry run reports choices the real pass wouldn't make, which
    // defeats dry-run's job of verifying this destructive operation before arming it.
    await entry("commons:File:Cold.jpg:display", 400, 99999);
    await entry("met:9999999:display", 400, 10);

    const evict = await withPinned("File:Cold.jpg");
    const preview = await evict.evictIfNeeded(sql, del, {
      cap: CAP,
      force: true,
      dryRun: true,
    });
    expect(deleted).toEqual([]);
    const wouldTake = preview.would_evict.map((r: any) => r.cache_key);

    await evict.evictIfNeeded(sql, del, { cap: CAP, force: true });
    expect(wouldTake).toEqual(deleted);
  });
});
