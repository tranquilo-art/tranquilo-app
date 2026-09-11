// gzip the nightly database backup. lib/cron/db-backup.js writes one JSON
// file through the GitHub Contents API, capped at ~100MB; uncompressed that
// ceiling was ~27,600 items (measured: 2,721 bytes/row as JSON). gzip runs
// ~10:1 on this shape of JSON, moving the ceiling to ~280,000 -- the cheap
// half of the fix (S3 is the proper one, with no ceiling).
//
// isDatedBackupName() must keep recognising pre-gzip plain `.json` backups,
// or pruneOldBackups() leaves them accumulating forever and the Python
// restore path can no longer restore them.
import zlib from "node:zlib";

// gzip then base64: the Contents API requires base64, and compressing first is
// what makes the payload smaller. The other order would be pointless -- base64
// output is high-entropy and barely compresses.
function encodeBackupBody(contentString: string): string {
  return zlib.gzipSync(Buffer.from(contentString, "utf-8")).toString("base64");
}

function decodeBackupBody(base64String: string): string {
  return zlib.gunzipSync(Buffer.from(base64String, "base64")).toString("utf-8");
}

// `date` null means the always-current snapshot, which a restore reaches for
// when it does not care which night it came from.
function backupFilename(date?: string | null): string {
  return `${date === null || date === undefined ? "latest" : date}.json.gz`;
}

// Matches a DATED backup in either format, and never `latest` in either.
// pruneOldBackups() deletes what this returns true for, so the two exclusions
// are load-bearing: latest.json.gz is the file a restore reaches for first.
const DATED_BACKUP_RE = /^\d{4}-\d{2}-\d{2}\.json(\.gz)?$/;

function isDatedBackupName(name?: string | null): boolean {
  return DATED_BACKUP_RE.test(String(name || ""));
}

// Postgres stores TIMESTAMPTZ to microseconds, but `JSON.stringify()` via
// `Date.toISOString()` emits only three decimals -- lossy before any restore
// runs. harmonized_at was missed on the first pass since it's added by
// sql/items_harmonization.sql rather than the base schema file; the live
// table is the authority, not the file that creates it. A test checks this
// list against restore_from_backup.py's own COLUMNS list, so a future *_at
// column can't be added to the restore without being added here too.
const MICROSECOND_COLUMNS = [
  "created_at",
  "human_reviewed_at",
  "harmonized_at",
];

// Suffix chosen to be one no real column would collide with, because the whole
// point is to avoid duplicate output names.
const US_SUFFIX = "__us";

// SELECT * is deliberate -- a missing column is unrecoverable, far worse
// than one with truncated precision, so the column list is never
// hand-maintained. Casts are aliased rather than shadowing the originals,
// since `SELECT *, x::text AS x` relies on driver field-assignment order to
// pick a winner. to_char(... AT TIME ZONE 'UTC') rather than ::text, since
// ::text renders in the session TimeZone (UTC today, but that's an
// assumption a backup shouldn't rest on).
function backupSelectSql() {
  const casts = MICROSECOND_COLUMNS.map(
    (col) =>
      `to_char(${col} AT TIME ZONE 'UTC', ` +
      `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${col}${US_SUFFIX}`,
  ).join(",\n       ");
  return `SELECT *,\n       ${casts}\n  FROM items ORDER BY native_id ASC`;
}

// Moves each aliased value onto its real column name and drops the alias, so
// the backup's shape is unchanged and column order stays stable. to_char(NULL)
// is NULL, so a null timestamp stays null rather than the string "null".
function applyMicrosecondColumns(rows: any) {
  for (const row of rows) {
    for (const col of MICROSECOND_COLUMNS) {
      const alias = col + US_SUFFIX;
      if (!(alias in row)) continue;
      row[col] = row[alias];
      delete row[alias];
    }
  }
  return rows;
}

export {
  applyMicrosecondColumns,
  backupFilename,
  backupSelectSql,
  DATED_BACKUP_RE,
  decodeBackupBody,
  encodeBackupBody,
  isDatedBackupName,
  MICROSECOND_COLUMNS,
};
