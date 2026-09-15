// Does the backup actually restore, or do we only believe it does?
// db-backup.ts writes a nightly dump and restore_from_backup.py reads it;
// neither on its own checks that a real backup, into a real Postgres,
// comes out matching what went in. Neon's free tier has no scheduled
// backups at all, so this file is the whole safety net.
//
// PGlite is genuine PostgreSQL compiled to WASM (a mock can't answer this,
// since it would only confirm one reading of the code matches another).
// Rows come from an actual production backup -- backup-sample.json, 17
// rows chosen for shapes that actually break a restore: JSONB, arrays,
// NULL vs empty string, CJK/accented text, ids with commas/colons/leading
// slashes, a non-default review_status, and native_id collisions across sources.
//
// RESTORE_COLUMNS is a hand-maintained snapshot of restore_from_backup.py's
// own COLUMNS list, now that ingestion lives in its own branch/repo --
// update it whenever that script's list changes.
//
// Not covered: the Python script's own execution (PGlite speaks no wire
// protocol, so psycopg can't connect to it) -- what's verified is that
// the backup's content survives a round trip through the real schema and
// column list, where the data-fidelity risks actually live.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SAMPLE = JSON.parse(
  readFileSync(path.join(ROOT, "tests/fixtures/backup-sample.json"), "utf8"),
);

// The columns restore_from_backup.py actually writes -- last synced from
// that script's own COLUMNS list.
const RESTORE_COLUMNS = [
  "id",
  "source",
  "native_id",
  "title",
  "artist",
  "bio",
  "date",
  "medium",
  "credit",
  "tags",
  "title_in_original_language",
  "series",
  "img",
  "full_img",
  "url",
  "license",
  "category",
  "region_primary",
  "region_alt",
  "century",
  "timeframe",
  "media_type",
  "palette",
  "subject_type",
  "accent_color",
  "contains_nudity",
  "caption_tea",
  "caption_basic",
  "tea_voice_status",
  "tea_voice_eligible",
  "tea_voice_claims",
  "cast",
  "cast_context",
  "cast_tier",
  "storyline_ids",
  "set_of_work_id",
  "twist_category",
  "twist_hook",
  "twist_story",
  "twist_confidence",
  "twist_source_url",
  "music_mood",
  "created_at",
  "human_reviewed_at",
  "blur_placeholder",
  "review_status",
  "review_flags",
  "rules_version",
  "harmonized_at",
  "source_type",
  "attribution_type",
  "artist_nationality",
  "artist_lifespan",
  "culture",
  "culture_period",
  "place_of_origin",
  "department",
  "contributor_nationality",
  "photograph_date",
  "palette_hex",
  "phash",
  "img_width",
  "img_height",
  "palette_buckets",
  "palette_contrast_score",
  "vibe_tags",
  "curator_boost",
];
function restoreColumns() {
  return RESTORE_COLUMNS;
}

// JSONB columns need to go in as JSON, not as a string that looks like JSON.
// api/items.ts carries parseJsonbField() specifically because getting this
// wrong ships a stringified blob to the UI and nothing throws.
const JSONB = new Set(["cast", "cast_context", "tea_voice_claims"]);
const _ARRAYS = new Set(["region_alt", "storyline_ids"]);

// Split on semicolons, but NOT inside a $$ ... $$ block -- a naive split
// tears a DO $$ ... END $$ block into fragments that fail with
// "unterminated dollar-quoted string", which looks like a broken schema
// file and isn't.
function splitStatements(sql: any) {
  const out = [];
  let buf = "",
    inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      buf += "$$";
      i++;
      continue;
    }
    if (sql[i] === ";" && !inDollar) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += sql[i];
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

let db: any;
let columns: any;
const schemaFailures: any[] = [];

beforeAll(async () => {
  db = new PGlite();
  columns = restoreColumns();

  // Build the schema from the committed SQL, recording what fails rather
  // than assuming it all applies -- a restore starts by running these
  // files, so a broken one is a broken restore. Every NNN_items_*.sql
  // migration in numeric order, rather than a hand-picked subset that
  // goes stale the moment one is added.
  const files = readdirSync(path.join(ROOT, "sql"))
    .filter((f) => /^\d+_items_/.test(f) && f.endsWith(".sql"))
    .filter((f) => f !== "018_items_vocab.sql") // its own tables, not items
    .sort();
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(path.join(ROOT, "sql", f), "utf8");
    } catch {
      continue;
    }
    const statements = splitStatements(
      text
        .split("\n")
        .filter((l) => !/^\s*--/.test(l))
        .join("\n"),
    );
    for (const stmt of statements) {
      try {
        await db.exec(stmt);
      } catch (err: any) {
        schemaFailures.push({
          file: f,
          stmt: stmt.slice(0, 60).replace(/\s+/g, " "),
          message: String(err.message).split("\n")[0],
        });
      }
    }
  }

  // Insert exactly as the restore does: the same columns, JSONB as JSON.
  const quoted = columns.map((c: any) => (c === "cast" ? '"cast"' : c));
  const placeholders = columns.map((_: any, i: any) => `$${i + 1}`).join(", ");
  for (const row of SAMPLE) {
    const values = columns.map((c: any) => {
      const v = row[c];
      if (v === undefined) return null;
      if (JSONB.has(c) && v !== null) return JSON.stringify(v);
      return v;
    });
    await db.query(
      `INSERT INTO items (${quoted.join(", ")}) VALUES (${placeholders})`,
      values,
    );
  }
});

describe("the schema a restore depends on", () => {
  it("applies, except for the parts needing extensions PGlite lacks", () => {
    // unaccent and pg_trgm are unavailable in PGlite, so the generated
    // search_text column and trigram index can't be created.
    const unexpected = schemaFailures.filter(
      (f) =>
        !/unaccent|pg_trgm|immutable_unaccent|search_text|gin_trgm_ops/i.test(
          `${f.stmt} ${f.message}`,
        ),
    );
    expect(unexpected, JSON.stringify(unexpected, null, 1)).toHaveLength(0);
  });
});

describe("the restore's column list", () => {
  it("covers every column the backup carries, except generated ones", () => {
    // search_text is GENERATED ALWAYS AS, so Postgres rejects an explicit
    // insert; shuffle_key has DEFAULT random(), harmless since order is random.
    const inBackup = new Set(Object.keys(SAMPLE[0]));
    const missing = [...inBackup].filter((c) => !columns.includes(c));
    expect(missing.sort()).toEqual(["search_text", "shuffle_key"]);
  });
});

describe("the data survives the round trip", () => {
  it("restores every row", async () => {
    const r = await db.query("SELECT count(*)::int AS n FROM items");
    expect(r.rows[0].n).toBe(SAMPLE.length);
  });

  it("keeps JSONB as JSON, not as a string that looks like JSON", async () => {
    const r = await db.query(
      `SELECT id, "cast", cast_context, tea_voice_claims FROM items
        WHERE "cast" IS NOT NULL OR tea_voice_claims IS NOT NULL`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      for (const col of ["cast", "cast_context", "tea_voice_claims"]) {
        if (row[col] === null) continue;
        expect(typeof row[col], `${row.id}.${col}`).not.toBe("string");
      }
    }
  });

  it('keeps arrays as arrays, not as "{a,b}"', async () => {
    const r = await db.query(
      `SELECT id, region_alt, storyline_ids FROM items
        WHERE region_alt IS NOT NULL OR storyline_ids IS NOT NULL`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      for (const col of ["region_alt", "storyline_ids"]) {
        if (row[col] === null) continue;
        expect(Array.isArray(row[col]), `${row.id}.${col}`).toBe(true);
      }
    }
  });

  it("keeps NULL distinct from the empty string", async () => {
    const nulls = await db.query(
      "SELECT count(*)::int AS n FROM items WHERE bio IS NULL",
    );
    const empties = await db.query(
      "SELECT count(*)::int AS n FROM items WHERE bio = ''",
    );
    expect(nulls.rows[0].n).toBeGreaterThan(0);
    expect(empties.rows[0].n).toBeGreaterThan(0);
  });

  it("round-trips created_at exactly as the backup stored it", async () => {
    for (const row of SAMPLE.slice(0, 6)) {
      const r = await db.query("SELECT created_at FROM items WHERE id = $1", [
        row.id,
      ]);
      expect(new Date(r.rows[0].created_at).toISOString(), row.id).toBe(
        new Date(row.created_at).toISOString(),
      );
    }
  });

  it("shows the millisecond truncation this fixture was captured under", async () => {
    // Fixed in lib/backup-format.js (see backup-timestamp-precision.test.ts
    // for the behaviour going forward). This fixture is a real backup
    // taken before the fix, so it still carries exactly three decimals --
    // documenting the old format and proving a restore of an old backup still works.
    const decimals = SAMPLE.map(
      (r: any) => (String(r.created_at).match(/\.(\d+)/) || [])[1],
    ).filter(Boolean);
    expect(decimals.length).toBeGreaterThan(0);
    for (const d of decimals) expect(d.length).toBe(3); // the pre-fix format

    // The old format still restores, which matters since dated backups
    // exist written this way.
    for (const row of SAMPLE.slice(0, 3)) {
      const r = await db.query("SELECT created_at FROM items WHERE id = $1", [
        row.id,
      ]);
      expect(new Date(r.rows[0].created_at).toISOString(), row.id).toBe(
        new Date(row.created_at).toISOString(),
      );
    }
  });

  it("preserves review_status rather than resetting it to the default", async () => {
    // The column defaults to 'ok'; letting the default apply would
    // silently un-quarantine everything the harmonization gate held back.
    const expected = SAMPLE.filter(
      (r: any) => r.review_status && r.review_status !== "ok",
    );
    expect(expected.length).toBeGreaterThan(0);
    for (const row of expected) {
      const r = await db.query(
        "SELECT review_status FROM items WHERE id = $1",
        [row.id],
      );
      expect(r.rows[0].review_status, row.id).toBe(row.review_status);
    }
  });

  it("survives non-ASCII text intact", async () => {
    const cjk = SAMPLE.find((r: any) => /[⺀-鿿]/.test(String(r.title || "")));
    expect(cjk).toBeTruthy();
    const r = await db.query("SELECT title FROM items WHERE id = $1", [cjk.id]);
    expect(r.rows[0].title).toBe(cjk.title);
  });

  it("keeps ids that collide across sources as separate rows", async () => {
    // The composite primary key keeps them apart; keying on native_id
    // alone would silently merge them.
    const r = await db.query(
      `SELECT native_id, count(*)::int AS n FROM items
        GROUP BY native_id HAVING count(*) > 1`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) expect(row.n).toBe(2);
  });

  it("round-trips ids containing commas, colons and leading slashes", async () => {
    for (const row of SAMPLE.filter(
      (r: any) => /[,:]/.test(r.native_id) || r.native_id.startsWith("/"),
    )) {
      const r = await db.query("SELECT native_id FROM items WHERE id = $1", [
        row.id,
      ]);
      expect(r.rows[0].native_id, row.id).toBe(row.native_id);
    }
  });
});
