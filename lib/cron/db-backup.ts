// Monthly backup of the `items` table to GitHub, since Neon's free tier
// offers no scheduled backups -- only a 6-hour PITR window and one
// manual snapshot. Was daily until the full-table pull's egress started
// eating too much of the free tier's public network transfer allowance
// as `items` grew; monthly trades recovery granularity for staying
// under that cap.
//
// Exports `items` only, not `analytics_events` (anonymous, low-value,
// already expected to stay tiny).
//
// Writes two files to a dedicated `db-backups` branch (kept separate
// from `main`) via GitHub's Contents API, plain fetch:
//   backups/items/YYYY-MM-DD.json.gz  -- dated, retained 30 days
//   backups/items/latest.json.gz      -- always-current
//
// Registered as a Sentry Cron Monitor -- a missed or failed run creates
// a Sentry issue independent of this function's own alert code.
//
// Silent on a healthy run. On any failure, sendAlertEmail() (Resend) fires.
//
// Required env vars: DATABASE_URL, CRON_SECRET, GITHUB_BACKUP_TOKEN (a
// fine-grained PAT scoped to Contents read/write on this repo only),
// plus RESEND_API_KEY/OPS_ALERT_EMAIL.

import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import {
  applyMicrosecondColumns,
  backupFilename,
  backupSelectSql,
  decodeBackupBody,
  encodeBackupBody,
  isDatedBackupName,
} from "../backup-format.ts";
import { getSql } from "../db.ts";
import { refreshVocabSql, refreshWordsSql, sweepSql } from "../items-vocab.ts";
import { reportError, Sentry } from "../sentry.ts";

// Required for Pool/Client below -- Node's global WebSocket varies by
// runtime, so this uses the documented `ws` path rather than assuming one.
neonConfig.webSocketConstructor = ws;

const GITHUB_REPO = "loveycakes/artscroll";
const BACKUP_BRANCH = "db-backups";
const BACKUP_DIR = "backups/items";
// 30 days made sense at daily cadence (keeping ~30 snapshots); at
// monthly cadence that would prune the previous dated file the same
// day the next one lands, leaving no history. 180 keeps roughly the
// last 6 monthly snapshots instead.
const RETENTION_DAYS = 180;
const MONITOR_SLUG = "db-backup";

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
async function fetchAllRows(opts?: any) {
  const options = opts || {};
  const PoolCtor = options.PoolCtor || Pool;
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

async function githubRequest(path: any, options?: any) {
  const opts = options || {};
  const resp = await fetch(`https://api.github.com${path}`, {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_BACKUP_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return resp;
}

// One-time bootstrap per repo -- the Contents API can write to an
// existing branch but can't implicitly create one.
async function ensureBackupBranchExists() {
  const check = await githubRequest(
    `/repos/${GITHUB_REPO}/git/ref/heads/${BACKUP_BRANCH}`,
  );
  if (check.status === 200) return;
  if (check.status !== 404) {
    throw new Error(
      `GitHub API error checking for ${BACKUP_BRANCH} branch: HTTP ${check.status}`,
    );
  }

  const mainRef = await githubRequest(
    `/repos/${GITHUB_REPO}/git/ref/heads/main`,
  );
  if (!mainRef.ok) {
    throw new Error(
      `GitHub API error reading main branch ref: HTTP ${mainRef.status}`,
    );
  }
  const mainJson = await mainRef.json();

  const create = await githubRequest(`/repos/${GITHUB_REPO}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${BACKUP_BRANCH}`, sha: mainJson.object.sha },
  });
  if (!create.ok) {
    throw new Error(
      `GitHub API error creating ${BACKUP_BRANCH} branch: HTTP ${create.status}`,
    );
  }
}

// Returns null (not an error) for a 404: "doesn't exist yet" is normal
// for a brand-new dated file.
async function getFileSha(path: any) {
  const resp = await githubRequest(
    `/repos/${GITHUB_REPO}/contents/${path}?ref=${BACKUP_BRANCH}`,
  );
  if (resp.status === 404) return null;
  if (!resp.ok)
    throw new Error(`GitHub API error reading ${path}: HTTP ${resp.status}`);
  const json = await resp.json();
  return json.sha;
}

async function putFile(path: any, contentString: any, message: any) {
  const sha = await getFileSha(path);
  const body: any = {
    message: message,
    content: encodeBackupBody(contentString),
    branch: BACKUP_BRANCH,
  };
  if (sha) body.sha = sha;

  const resp = await githubRequest(`/repos/${GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    body: body,
  });
  if (!resp.ok) {
    throw new Error(`GitHub API error writing ${path}: HTTP ${resp.status}`);
  }
}

// Doesn't shrink git history -- an accepted tradeoff at this dataset
// size. latest.json is never touched here.
async function pruneOldBackups() {
  const resp = await githubRequest(
    `/repos/${GITHUB_REPO}/contents/${BACKUP_DIR}?ref=${BACKUP_BRANCH}`,
  );
  if (resp.status === 404) return; // first run ever
  if (!resp.ok)
    throw new Error(
      `GitHub API error listing ${BACKUP_DIR}: HTTP ${resp.status}`,
    );
  const entries = await resp.json();

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isDatedBackupName(entry.name)) continue; // skips latest.json/.json.gz
    const fileDate = entry.name.slice(0, 10);
    if (fileDate < cutoffStr) {
      const del = await githubRequest(
        `/repos/${GITHUB_REPO}/contents/${BACKUP_DIR}/${entry.name}`,
        {
          method: "DELETE",
          body: {
            message: `Prune backup older than ${RETENTION_DAYS} days: ${entry.name}`,
            sha: entry.sha,
            branch: BACKUP_BRANCH,
          },
        },
      );
      if (!del.ok)
        throw new Error(
          `GitHub API error pruning ${entry.name}: HTTP ${del.status}`,
        );
    }
  }
}

async function sendAlertEmail(alerts: any) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail =
    process.env.OPS_ALERT_EMAIL || process.env.SUBMIT_NOTIFY_EMAIL;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";
  if (!apiKey || !notifyEmail) return;

  const textBody = `Tranquilo database backup found ${alerts.length} issue(s):\n\n${alerts.map((a: any) => `- ${a}`).join("\n")}`;
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

async function alertOnFailure(message: any) {
  const alerts = [message];
  await sendAlertEmail(alerts);
}

// Re-reads the backup just written through the GitHub API (not the
// PUT's own response) to confirm the stored object is readable and
// complete.
//
// GitHub's Contents API only inlines file content under 1MB -- past
// that it still returns 200, with encoding "none" and an empty string.
// Our gzipped backup crossed 1MB, so this reads through the Git Blobs
// API instead, which returns base64 up to 100MB (the same ceiling the
// write path already uses).
async function verifyWrittenBackup(
  expectedRows: any,
  opts?: any,
): Promise<any> {
  const options = opts || {};
  const request = options.request || githubRequest;

  async function getJson(path: any) {
    const resp = await request(path);
    if (!resp?.ok) return null;
    return await resp.json();
  }

  try {
    const path = `${BACKUP_DIR}/${backupFilename(null)}`;
    const meta: any = await getJson(
      `/repos/${GITHUB_REPO}/contents/${path}?ref=${BACKUP_BRANCH}`,
    );
    if (!meta)
      return inconclusive(`could not read ${path} from the Contents API`);

    let content = meta.content;
    if (!content && meta.sha) {
      const blob: any = await getJson(
        `/repos/${GITHUB_REPO}/git/blobs/${meta.sha}`,
      );
      if (!blob?.content) {
        return inconclusive(`blob ${meta.sha} for ${path} returned no content`);
      }
      content = blob.content;
    }
    if (!content) {
      return inconclusive(
        `Contents API returned neither content nor a sha for ${path}`,
      );
    }

    const parsed = JSON.parse(decodeBackupBody(content));
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
    // A throw here is almost always decode/parse -- we have the bytes
    // and they aren't what we wrote.
    return bad(String(((err as any) && (err as any).message) || err));
  }
}

// "inconclusive": the check itself couldn't run (unexpected API shape,
// token problem, network failure) -- says nothing about the backup.
// "bad": the file was read and isn't what we wrote -- the alert that
// must never be ignored.
function inconclusive(reason: any) {
  return { ok: false, inconclusive: true, reason: reason };
}
function bad(reason: any) {
  return { ok: false, inconclusive: false, reason: reason };
}

export default async function handler(req: any, res: any) {
  const auth = req.headers.authorization || "";
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
  // 12-function cap. Branches above the GITHUB_BACKUP_TOKEN check since
  // a reshuffle needs nothing from GitHub.
  //
  // Only a FRACTION of the table: rewriting every row's shuffle_key
  // each night writes one dead tuple per row (~360MB/night at the 200k
  // target). Re-keying a tenth nightly still yields a uniformly random
  // order at every moment -- a row keeping yesterday's key keeps a
  // value that was already uniform in [0,1), and a fresh draw is from
  // the same distribution -- while turning the whole order over in
  // about ten days.
  if (req.query.task === "reshuffle") {
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

  if (!process.env.GITHUB_BACKUP_TOKEN) {
    console.error("db-backup: missing GITHUB_BACKUP_TOKEN env var");
    Sentry.captureCheckIn(
      { monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await alertOnFailure(
      "Database backup didn't run: GITHUB_BACKUP_TOKEN isn't configured in Vercel.",
    );
    res.statusCode = 500;
    res.json({ error: "GitHub isn't configured" });
    return;
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    monitorConfig(),
  );

  // Timings recorded per stage: knowing WHICH stage is slow is the
  // difference between "the backup is slow" and a scoped fix.
  const startedAt = Date.now();
  const stage: any = {};

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

    // Size and duration ride in the commit message since Vercel Hobby
    // only retains runtime logs for an hour -- `git log db-backups`
    // becomes a durable performance history for free.
    t = Date.now();
    await ensureBackupBranchExists();
    stage.branch = Date.now() - t;

    const summary = `${today} (${rows.length} items, ${megabytes} MB`;
    t = Date.now();
    await putFile(
      `${BACKUP_DIR}/${backupFilename(null)}`,
      content,
      `Database backup ${summary})`,
    );
    stage.writeLatest = Date.now() - t;

    t = Date.now();
    await putFile(
      `${BACKUP_DIR}/${backupFilename(today)}`,
      content,
      `Database backup ${summary}, write ${(stage.writeLatest / 1000).toFixed(1)}s)`,
    );
    stage.writeDated = Date.now() - t;

    // Read back before pruning anything -- deleting yesterday's good
    // backup on the strength of today's broken one would turn a bad
    // night into a lost catalogue.
    t = Date.now();
    const verified = await verifyWrittenBackup(rows.length);
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
          `backup -- today's file is probably fine and is still on the branch. ` +
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
    await pruneOldBackups();
    stage.prune = Date.now() - t;

    const elapsed = Date.now() - startedAt;
    const timing = {
      total_s: +(elapsed / 1000).toFixed(1),
      query_s: +(stage.query / 1000).toFixed(1),
      branch_s: +(stage.branch / 1000).toFixed(1),
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
    await alertOnFailure(`Database backup failed: ${(err as any).message}`);
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
export { fetchAllRows, verifyWrittenBackup };
