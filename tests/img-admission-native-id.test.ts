// Every row the write path creates must carry native_id -- a migration
// once added and backfilled the column but never taught the INSERT to
// fill it, so new rows were NULL and a join on (source, native_id) silently
// dropped whatever had been cached since (19 of 22 newly written entries
// were NULL, measured live). The column exists because cache_key can't be
// parsed back apart (native_id itself contains colons), so a NULL column
// reintroduces the same problem in a different hat. These tests go through
// admission.noteRequest() rather than a hand-written INSERT, since the gap
// was between "the column exists" (already tested) and "the live write
// path fills it".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as admission from "../lib/img-admission.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: any;

beforeEach(async () => {
  // 025_img_cache_native_id.sql is the migration that adds the column;
  // running it means this suite also proves that file still applies.
  sql = await makeSql([
    "011_img_cache_entries.sql",
    "025_img_cache_native_id.sql",
  ]);
});
afterEach(async () => {
  if (sql) await sql.$close();
});

async function rowFor(cacheKey: any) {
  const rows = await sql.query(
    "SELECT * FROM img_cache_entries WHERE cache_key = $1",
    [cacheKey],
  );
  return rows[0];
}

describe("noteRequest records native_id", () => {
  it("fills it on the row it creates", async () => {
    await admission.noteRequest(
      sql,
      "met:436535:display",
      "met",
      "display",
      "436535",
    );
    expect((await rowFor("met:436535:display")).native_id).toBe("436535");
  });

  it("keeps a Commons id whole, colons and all", async () => {
    const id = "File:Tansen painting.jpg";
    await admission.noteRequest(
      sql,
      `commons:${id}:display`,
      "commons",
      "display",
      id,
    );
    expect((await rowFor(`commons:${id}:display`)).native_id).toBe(id);
  });

  it("fills it for every tier of the same item, separately", async () => {
    await admission.noteRequest(sql, "met:1:display", "met", "display", "1");
    await admission.noteRequest(sql, "met:1:lightbox", "met", "lightbox", "1");
    expect((await rowFor("met:1:display")).native_id).toBe("1");
    expect((await rowFor("met:1:lightbox")).native_id).toBe("1");
  });

  it("reconstructs its own cache_key from the parts", async () => {
    const id = "File:A, B: C.jpg";
    await admission.noteRequest(
      sql,
      `commons:${id}:display`,
      "commons",
      "display",
      id,
    );
    const bad = await sql.query(
      `SELECT count(*)::int AS n FROM img_cache_entries
        WHERE cache_key <> source || ':' || native_id || ':' || tier`,
    );
    expect(bad[0].n).toBe(0);
  });
});

describe("repeat requests", () => {
  it("do not blank an existing native_id", async () => {
    // The ON CONFLICT path runs on every subsequent view, far more often
    // than the insert -- an unconditional UPDATE from a caller without an
    // id would erase good data on a hot key.
    await admission.noteRequest(sql, "met:2:display", "met", "display", "2");
    await admission.noteRequest(sql, "met:2:display", "met", "display", "2");
    const row = await rowFor("met:2:display");
    expect(row.native_id).toBe("2");
    expect(Number(row.requests)).toBe(2);
  });

  it("backfills a row that predates the column", async () => {
    // The next request for a pre-migration row is a free chance to fill
    // its NULL rather than leaving it for a migration to sweep later.
    await sql.query(
      `INSERT INTO img_cache_entries (cache_key, source, tier, requests, first_seen, last_seen)
       VALUES ('met:3:display', 'met', 'display', 1, now(), now())`,
    );
    expect((await rowFor("met:3:display")).native_id).toBeNull();

    await admission.noteRequest(sql, "met:3:display", "met", "display", "3");
    expect((await rowFor("met:3:display")).native_id).toBe("3");
  });
});

describe("a caller that passes no native_id", () => {
  it("still records the request rather than failing", async () => {
    // An unknown id must degrade to NULL, not throw on the hot path.
    const out = await admission.noteRequest(
      sql,
      "met:4:display",
      "met",
      "display",
    );
    expect(out.reason).not.toBe("error");
    expect((await rowFor("met:4:display")).native_id).toBeNull();
  });
});
