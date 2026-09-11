// The backup was throwing away timestamp precision before a restore ever
// ran. Postgres stores TIMESTAMPTZ to microseconds, but `SELECT *` +
// JSON.stringify() handed back a JS Date, and Date.toISOString() emits
// only three decimal places -- verified against the real backup, where
// every created_at ends in exactly 3 decimals. human_reviewed_at is
// TIMESTAMPTZ too and truncated identically, and is the column with the
// weakest chance of being reconstructible from anywhere else.
//
// Uses to_char(... AT TIME ZONE 'UTC', ...) rather than ::text, which
// renders in the session's TimeZone -- fine while Neon defaults to UTC,
// but silently wrong if a session ever ran differently. The output shape
// stays the same (ISO 8601, T separator, trailing Z) with six decimals
// instead of three, so a diff across the change shows digits appearing,
// not a reformatting.

import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyMicrosecondColumns,
  backupSelectSql,
  MICROSECOND_COLUMNS,
} from "../lib/backup-format.ts";

// Exactly what lib/cron/db-backup.ts does: run the query, then move the
// aliased values onto their real names. Tested together since separately
// neither is the behaviour that matters.
async function backupRows(database: any) {
  const r = await database.query(backupSelectSql());
  return applyMicrosecondColumns(r.rows);
}

// One instant with a non-zero microsecond component that ALSO has non-zero
// digits past millisecond -- .123456 truncates to .123, so the last three
// digits are the whole test.
const PRECISE = "2026-08-11 12:34:56.123456+00";

let db: any;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE items (
      source TEXT NOT NULL,
      native_id TEXT NOT NULL,
      title TEXT,
      human_reviewed_at TIMESTAMPTZ,
      harmonized_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (source, native_id)
    )`);
  await db.query(
    `INSERT INTO items (source, native_id, title, created_at, human_reviewed_at, harmonized_at)
     VALUES ('met', '1', 'precise', $1, $1, $1), ('met', '2', 'null review', $1, NULL, $1)`,
    [PRECISE],
  );
});

describe("the backup query", () => {
  it("names every microsecond-bearing column it overrides", () => {
    // If a TIMESTAMPTZ column is added and not added here, it silently
    // reverts to the truncating path. harmonized_at was missed on the
    // first pass, since that pass grepped only the base schema file and
    // this column is added later by a harmonization migration -- the live
    // table is the authority on its own shape, not the file that created it.
    expect(MICROSECOND_COLUMNS).toEqual([
      "created_at",
      "human_reviewed_at",
      "harmonized_at",
    ]);
  });

  it("covers every timestamp column the restore writes", () => {
    // A hand-maintained snapshot of restore_from_backup.py's own COLUMNS
    // list, now that ingestion lives in its own branch/repo. Any *_at
    // column it restores must be overridden here, or the backup truncates it.
    const RESTORE_COLUMNS_AT_FIELDS = [
      "created_at",
      "human_reviewed_at",
      "harmonized_at",
    ];
    expect(RESTORE_COLUMNS_AT_FIELDS.length).toBeGreaterThan(0);
    for (const col of RESTORE_COLUMNS_AT_FIELDS) {
      expect(MICROSECOND_COLUMNS, `${col} truncates to milliseconds`).toContain(
        col,
      );
    }
  });

  it("still selects every column, so a new one is backed up automatically", () => {
    // A column missing from a backup is unrecoverable, far worse than one
    // with wrong sub-millisecond digits.
    expect(backupSelectSql()).toMatch(/SELECT\s+\*/i);
  });

  it("keeps the deterministic ordering the old query had", () => {
    expect(backupSelectSql()).toMatch(/ORDER BY native_id ASC/);
  });
});

describe("microsecond precision", () => {
  it("survives into the backup rows", async () => {
    const row = (await backupRows(db)).find((x: any) => x.native_id === "1");
    expect(row.created_at).toBe("2026-08-11T12:34:56.123456Z");
    expect(row.human_reviewed_at).toBe("2026-08-11T12:34:56.123456Z");
    expect(row.harmonized_at).toBe("2026-08-11T12:34:56.123456Z");
  });

  it("survives JSON.stringify, which is what actually writes the file", async () => {
    // The old bug lived here, not in the query: a JS Date only loses its
    // microseconds at serialisation time.
    const written = JSON.parse(JSON.stringify(await backupRows(db)));
    for (const row of written) {
      expect(String(row.created_at).match(/\.(\d+)Z$/)?.[1]).toHaveLength(6);
    }
  });

  it("is what the OLD query lost, demonstrated rather than asserted", async () => {
    const r = await db.query("SELECT * FROM items ORDER BY native_id ASC");
    const asWritten = JSON.parse(JSON.stringify(r.rows));
    expect(
      String(asWritten[0].created_at).match(/\.(\d+)Z$/)?.[1],
    ).toHaveLength(3);
    expect(asWritten[0].created_at).toBe("2026-08-11T12:34:56.123Z"); // .123456 lost
  });

  it("round-trips back into a TIMESTAMPTZ column with no drift", async () => {
    const row = (await backupRows(db)).find((x: any) => x.native_id === "1");
    await db.query(
      `INSERT INTO items (source, native_id, created_at) VALUES ('met', 'restored', $1)`,
      [row.created_at],
    );
    const check = await db.query(
      `SELECT (created_at = (SELECT created_at FROM items WHERE native_id = '1')) AS same
         FROM items WHERE native_id = 'restored'`,
    );
    expect(check.rows[0].same).toBe(true);
  });
});

describe("the aliased columns", () => {
  it("never reach the file", async () => {
    // A leaked `created_at__us` would be a column restore_from_backup.py
    // doesn't know about, surfacing as a confusing coverage failure elsewhere.
    const written = JSON.parse(JSON.stringify(await backupRows(db)));
    for (const row of written) {
      for (const key of Object.keys(row)) expect(key).not.toMatch(/__us$/);
    }
  });

  it("leaves column order unchanged, so backups stay diffable", async () => {
    const plain = await db.query("SELECT * FROM items ORDER BY native_id ASC");
    const fixed = await backupRows(db);
    expect(Object.keys(fixed[0])).toEqual(Object.keys(plain.rows[0]));
  });
});

describe("NULL handling", () => {
  it('leaves a NULL timestamp as null, not as the string "null"', async () => {
    // A formatting helper that stringified first would write "null" and
    // restore it as a parse error or a valid-looking date.
    const row = (await backupRows(db)).find((x: any) => x.native_id === "2");
    expect(row.human_reviewed_at).toBeNull();
  });
});

describe("timezone independence", () => {
  it("writes UTC even when the session TimeZone is not UTC", async () => {
    await db.exec("SET TimeZone = 'America/Sao_Paulo'");
    try {
      const row = (await backupRows(db)).find((x: any) => x.native_id === "1");
      expect(row.created_at).toBe("2026-08-11T12:34:56.123456Z");
    } finally {
      await db.exec("SET TimeZone = 'UTC'");
    }
  });
});
