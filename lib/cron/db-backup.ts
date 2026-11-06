// Monthly backup of the `items` table to a dedicated S3 bucket.
//
// Exports `items` only, not `analytics_events`.
//
// Writes two gzip objects (plain fetch + SigV4, lib/img-s3.ts):
//   backups/items/YYYY-MM-DD.json.gz  -- dated, retained RETENTION_DAYS
//   backups/items/latest.json.gz      -- always-current
//
// Registered as a Sentry Cron Monitor; a missed run opens a Sentry issue.
// Silent on a healthy run. On any failure, sendAlertEmail() (Resend) fires.
//
// Required env vars: DATABASE_URL, CRON_SECRET, DB_BACKUP_S3_BUCKET,
// DB_BACKUP_S3_REGION, DB_BACKUP_S3_ACCESS_KEY_ID,
// DB_BACKUP_S3_SECRET_ACCESS_KEY, plus RESEND_API_KEY/OPS_ALERT_EMAIL.

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import {
  applyMicrosecondColumns,
  backupFilename,
  backupSelectSql,
  gunzipBackupBody,
  gzipBackupBody,
  isDatedBackupName,
} from "../backup-format.ts";
import type { CronRequest, CronResponse } from "../cron-types.ts";
import { getSql } from "../db.ts";
import type { S3Credentials } from "../img-s3.ts";
import * as s3 from "../img-s3.ts";
import { refreshVocabSql, refreshWordsSql, sweepSql } from "../items-vocab.ts";
import { refreshLocaleSearch } from "../search-locale.ts";
import { reportError, Sentry } from "../sentry.ts";

function errorMessage(err: unknown): string {
  return String((err instanceof Error && err.message) || err);
}

// Required for Pool/Client below -- Node's global WebSocket varies by
// runtime, so this uses the documented `ws` path rather than assuming one.
neonConfig.webSocketConstructor = ws;

const BACKUP_DIR = "backups/items";
// 30 days made sense at daily cadence (keeping ~30 snapshots); at
// monthly cadence that would prune the previous dated file the same
// day the next one lands, leaving no history. 180 keeps roughly the
// last 6 monthly snapshots instead.
const RETENTION_DAYS = 180;
const MONITOR_SLUG = "db-backup";

interface PoolLike {
  connect(): Promise<{
    query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
    release(): void;
  }>;
  end(): Promise<void>;
}

interface FetchAllRowsOptions {
  PoolCtor?: new (config: { connectionString?: string }) => PoolLike;
}

interface VerifyOptions {
  getObject?: typeof s3.getObject;
}

type BackupS3Config = S3Credentials & { enabled: boolean };

interface VerifyResult {
  ok: boolean;
  rows?: number;
  inconclusive?: boolean;
  reason?: string;
}

const RESHUFFLE_FRACTION = 0.1;
const CRON_SCHEDULE = "27 7 1 * *"; // must match vercel.json's schedule for this path

// Uses Neon's WebSocket Pool, not the HTTP client used elsewhere in
// this file -- Neon's HTTP mode hard-caps a response at 64MB, which
// `items` crossed at 34,697 rows. The Pool speaks plain Postgres wire
// protocol with no such cap.
//
// A chunked, keyset-paginated fetch was considered and rejected:
// `items.id` isn't insertion-ordered, so a row written mid-run could
// land in an already-scanned range and be silently skipped across
// separate HTTP round trips with no shared snapshot. One SELECT is its
// own consistent snapshot instead.
//
// Pool/Client must be created, used and closed within one request
// handler, never at module scope.
async function fetchAllRows(opts?: FetchAllRowsOptions) {
  const options = opts || {};
  const PoolCtor =
    options.PoolCtor ||
    (Pool as unknown as NonNullable<FetchAllRowsOptions["PoolCtor"]>);
  const pool = new PoolCtor({ connectionString: process.env.DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      const result = await client.query(backupSelectSql());
      return result.rows;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// The secret is non-enumerable so config objects never leak it into logs.
function backupS3ConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): BackupS3Config {
  const bucket = env.DB_BACKUP_S3_BUCKET || "";
  const region = env.DB_BACKUP_S3_REGION || "";
  const accessKeyId = env.DB_BACKUP_S3_ACCESS_KEY_ID || "";
  const secretValue = env.DB_BACKUP_S3_SECRET_ACCESS_KEY || "";

  const config = {
    bucket: bucket,
    region: region,
    accessKeyId: accessKeyId,
    enabled: !!(bucket && region && accessKeyId && secretValue),
  } as BackupS3Config;
  Object.defineProperty(config, "secret", {
    enumerable: false,
    value: () => secretValue,
  });
  return config;
}

async function putBackupObject(
  config: S3Credentials,
  key: string,
  body: Buffer,
) {
  const result = await s3.putObject(config, key, body, "application/gzip");
  if (!result.ok) {
    throw new Error(
      `S3 error writing ${key}: HTTP ${result.status}` +
        (result.error ? ` (${result.error})` : ""),
    );
  }
}

// latest.json.gz never matches isDatedBackupName, so it is never pruned.
async function pruneOldBackups(config: S3Credentials) {
  const listed = await s3.listObjects(config, `${BACKUP_DIR}/`);
  if (!listed.ok) {
    throw new Error(`S3 error listing ${BACKUP_DIR}: HTTP ${listed.status}`);
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const key of listed.keys ?? []) {
    const name = key.slice(BACKUP_DIR.length + 1);
    if (!isDatedBackupName(name)) continue;
    if (name.slice(0, 10) < cutoffStr) {
      const del = await s3.deleteObject(config, key);
      if (!del.ok) {
        throw new Error(`S3 error pruning ${key}: HTTP ${del.status}`);
      }
    }
  }
}

async function sendAlertEmail(alerts: string[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail =
    process.env.OPS_ALERT_EMAIL || process.env.SUBMIT_NOTIFY_EMAIL;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";
  if (!apiKey || !notifyEmail) return;

  const textBody = `Tranquilo database backup found ${alerts.length} issue(s):\n\n${alerts.map((a) => `- ${a}`).join("\n")}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notifyEmail],
      subject: `Tranquilo database backup: ${alerts.length} issue(s) found`,
      text: textBody,
    }),
  }).catch(() => {}); // best-effort -- Resend is the only durable record now
}

async function alertOnFailure(message: string) {
  const alerts = [message];
  await sendAlertEmail(alerts);
}

// Re-reads the written object, not the PUT response, to confirm it decodes
// and matches. A failed GET is inconclusive; undecodable bytes are bad.
async function verifyWrittenBackup(
  config: S3Credentials,
  expectedRows: number,
  opts?: VerifyOptions,
): Promise<VerifyResult> {
  const getObject = opts?.getObject || s3.getObject;
  const key = `${BACKUP_DIR}/${backupFilename(null)}`;

  const got = await getObject(config, key);
  if (!got.ok || !got.body) {
    return inconclusive(
      `could not read ${key} from S3: HTTP ${got.status}` +
        (got.error ? ` (${got.error})` : ""),
    );
  }

  try {
    const parsed = JSON.parse(gunzipBackupBody(got.body));
    if (!Array.isArray(parsed)) return bad("backup is not an array");
    if (parsed.length !== expectedRows) {
      return bad(
        `row count mismatch -- wrote ${
          expectedRows
        }, read back ${parsed.length}`,
      );
    }
    if (parsed.length && (!parsed[0].id || !parsed[0].native_id)) {
      return bad("rows are missing id/native_id");
    }
    return { ok: true, rows: parsed.length };
  } catch (err) {
    return bad(errorMessage(err));
  }
}

// "inconclusive": the check itself couldn't run (credentials, network)
// -- says nothing about the backup.
// "bad": the file was read and isn't what we wrote -- the alert that
// must never be ignored.
function inconclusive(reason: string): VerifyResult {
  return { ok: false, inconclusive: true, reason: reason };
}
function bad(reason: string): VerifyResult {
  return { ok: false, inconclusive: false, reason: reason };
}

export default async function handler(req: CronRequest, res: CronResponse) {
  const auth = req.headers?.authorization || "";
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    return;
  }

  const client = getSql();
  if (!client) {
    console.error("db-backup: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Database isn't configured" });
    return;
  }

  // Re-randomise shuffle_key -- a second cron ENTRY on this same
  // function, not a second function, since api/ is at Vercel Hobby's
  // 12-function cap. Branches above the S3 config check; a reshuffle
  // needs nothing from S3.
  //
  // Only a FRACTION of the table: rewriting every row's shuffle_key
  // each night writes one dead tuple per row (~360MB/night at the 200k
  // target). Re-keying a tenth nightly still yields a uniformly random
  // order at every moment -- a row keeping yesterday's key keeps a
  // value that was already uniform in [0,1), and a fresh draw is from
  // the same distribution -- while turning the whole order over in
  // about ten days.
  if (req.query?.task === "reshuffle") {
    const reshuffleStart = Date.now();
    try {
      const reshuffled = await client.query(
        "WITH upd AS (UPDATE items SET shuffle_key = random() " +
          "WHERE random() < $1 RETURNING 1) SELECT count(*)::int AS n FROM upd",
        [RESHUFFLE_FRACTION],
      );
      const n = reshuffled[0]?.n || 0;

      // Rebuilds the search vocabulary in the same run, for the same
      // 12-function reason, and on the same schedule so the two can
      // never describe different versions of the catalogue. Words are
      // built FROM items_vocab, so vocabulary first, then words.
      await client.query(refreshVocabSql());
      await client.query(refreshWordsSql());
      const sweptVocab = await client.query(
        `${sweepSql("items_vocab")} RETURNING 1`,
      );
      const sweptWords = await client.query(
        `${sweepSql("items_vocab_words")} RETURNING 1`,
      );

      await refreshLocaleSearch(client);

      const ms = Date.now() - reshuffleStart;
      console.log(
        `db-backup: reshuffled ${n} rows, refreshed vocabulary` +
          ` (swept ${sweptVocab.length} terms, ${
            sweptWords.length
          } words) in ${ms}ms`,
      );
      res.json({
        ok: true,
        task: "reshuffle",
        rows: n,
        ms: ms,
        vocab_swept: sweptVocab.length,
        words_swept: sweptWords.length,
      });
    } catch (err) {
      console.error("db-backup: reshuffle failed", err);
      await reportError(err);
      // Deliberately not alertOnFailure() -- a missed run costs a
      // day of the feed opening on the same sequence, invisible to a
      // visitor since the per-session start offset still varies.
      res.statusCode = 500;
      res.json({ error: "reshuffle failed" });
    }
    return;
  }

  const s3Config = backupS3ConfigFromEnv();
  if (!s3Config.enabled) {
    console.error("db-backup: missing one or more DB_BACKUP_S3_* env vars");
    Sentry.captureCheckIn(
      { monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await alertOnFailure(
      "Database backup didn't run: the DB_BACKUP_S3_* env vars aren't all configured in Vercel.",
    );
    res.statusCode = 500;
    res.json({ error: "S3 isn't configured" });
    return;
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    monitorConfig(),
  );

  // Timings recorded per stage: knowing WHICH stage is slow is the
  // difference between "the backup is slow" and a scoped fix.
  const startedAt = Date.now();
  const stage: Record<string, number> = {};

  try {
    let t = Date.now();
    // TIMESTAMPTZ columns are aliased to microsecond-precision strings
    // here, then moved onto their real names -- otherwise the driver
    // returns JS Dates and JSON.stringify truncates to milliseconds.
    const rows = applyMicrosecondColumns(await fetchAllRows());
    stage.query = Date.now() - t;

    const content = JSON.stringify(rows, null, 2);
    const today = new Date().toISOString().slice(0, 10);
    const megabytes = (Buffer.byteLength(content, "utf8") / 1048576).toFixed(2);

    t = Date.now();
    const gzipped = gzipBackupBody(content);
    stage.gzip = Date.now() - t;

    t = Date.now();
    await putBackupObject(
      s3Config,
      `${BACKUP_DIR}/${backupFilename(null)}`,
      gzipped,
    );
    stage.writeLatest = Date.now() - t;

    t = Date.now();
    await putBackupObject(
      s3Config,
      `${BACKUP_DIR}/${backupFilename(today)}`,
      gzipped,
    );
    stage.writeDated = Date.now() - t;

    // Read back before pruning anything -- deleting yesterday's good
    // backup on the strength of today's broken one would turn a bad
    // night into a lost catalogue.
    t = Date.now();
    const verified = await verifyWrittenBackup(s3Config, rows.length);
    stage.verify = Date.now() - t;
    if (!verified.ok) {
      Sentry.captureCheckIn(
        { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
        monitorConfig(),
      );
      const message = verified.inconclusive
        ? `Database backup wrote successfully (${rows.length} rows), but the ` +
          `nightly verification COULD NOT BE COMPLETED: ${verified.reason}. ` +
          `This is a problem with the check, not evidence of a problem with the ` +
          `backup -- today's file is probably fine and is still in the bucket. ` +
          `Older snapshots were not pruned. Worth fixing promptly, because while ` +
          `this is broken nothing is confirming the backups are restorable.`
        : `Database backup wrote successfully but FAILED VERIFICATION: ${
            verified.reason
          }. The file was read back and is NOT what we wrote. ` +
          `Older snapshots were NOT pruned, so the previous good backup is still ` +
          `there. Do not trust today's file.`;
      await alertOnFailure(message);
      res.statusCode = 500;
      res.json({
        error: verified.inconclusive
          ? "backup verification inconclusive"
          : "backup failed verification",
        reason: verified.reason,
      });
      return;
    }

    t = Date.now();
    await pruneOldBackups(s3Config);
    stage.prune = Date.now() - t;

    const elapsed = Date.now() - startedAt;
    const timing = {
      total_s: +(elapsed / 1000).toFixed(1),
      query_s: +(stage.query / 1000).toFixed(1),
      gzip_s: +(stage.gzip / 1000).toFixed(1),
      write_latest_s: +(stage.writeLatest / 1000).toFixed(1),
      write_dated_s: +(stage.writeDated / 1000).toFixed(1),
      prune_s: +(stage.prune / 1000).toFixed(1),
      rows: rows.length,
      megabytes: +megabytes,
    };
    console.log("db-backup: completed", JSON.stringify(timing));
    // Only records a message when the run was SLOW -- the check-in
    // above is the durable record that the run happened; this is the
    // record of it happening badly.
    if (elapsed > 5 * 60 * 1000) {
      Sentry.captureMessage(`db-backup slow: ${timing.total_s}s`, {
        level: "warning",
        extra: timing,
      });
    }

    // Flushed before the response, not merely before returning -- the
    // SDK buffers and sends asynchronously, and a serverless function
    // freezes once the platform has its response. Without this, Sentry
    // only ever saw the in_progress check-in and timed it out, even
    // though the backup completed in seconds.
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);
    res.statusCode = 200;
    res.json({ ok: true, rows: rows.length, timing: timing });
  } catch (err) {
    console.error("db-backup: failed", err);
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err);
    await alertOnFailure(`Database backup failed: ${errorMessage(err)}`);
    res.statusCode = 500;
    res.json({ error: "Database backup failed" });
  }
}

// checkinMargin of 60 minutes accounts for Vercel Hobby's imprecise
// cron firing (can trigger anywhere within the scheduled hour).
// maxRuntime raised from 5 to 15 after a false alarm on a healthy run
// (950 items, completed correctly but outside the old window) -- the
// duration recorded above is what turns "feels slow" into a number to
// scope a real fix against, rather than raising this further blind.
function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 60,
    maxRuntime: 15,
    timezone: "UTC",
  };
}

// Exported for tests.
export {
  backupS3ConfigFromEnv,
  fetchAllRows,
  pruneOldBackups,
  verifyWrittenBackup,
};
