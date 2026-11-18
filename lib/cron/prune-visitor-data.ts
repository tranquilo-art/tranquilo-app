// Daily retention for visitor-keyed rows: denial counters are kept 30 days,
// per-day bucket rows for the items, detail and image budgets two days (their
// key changes daily, so older rows can never be read again). API key usage
// counters are kept 13 months; key buckets ("key:<id>") are never pruned.
//
// Required env vars: CRON_SECRET, DATABASE_URL.
import * as Sentry from "@sentry/node";
import type { CronRequest, CronResponse } from "../cron-types.ts";
import { getSql } from "../db.ts";
import { reportError } from "../sentry.ts";

const EVENT_RETENTION_DAYS = 30;
const BUCKET_RETENTION_DAYS = 2;
const USAGE_RETENTION_MONTHS = 13;

const MONITOR_SLUG = "prune-visitor-data";
const CRON_SCHEDULE = "37 4 * * *";
function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 60,
    maxRuntime: 5,
    timezone: "UTC",
  };
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

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    monitorConfig(),
  );

  try {
    const sql = getSql();
    if (!sql) throw new Error("DATABASE_URL is not set");
    const events = (await sql.query(
      "DELETE FROM items_budget_events " +
        "WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int RETURNING 1",
      [EVENT_RETENTION_DAYS],
    )) as unknown[];
    const buckets = (await sql.query(
      "DELETE FROM visitor_fetch_state " +
        "WHERE (ip LIKE 'items:%' OR ip LIKE 'img:%' OR ip LIKE 'detail:%' OR ip LIKE 'write:%') " +
        "AND updated_at < now() - make_interval(days => $1::int) RETURNING 1",
      [BUCKET_RETENTION_DAYS],
    )) as unknown[];

    const usage = (await sql.query(
      "DELETE FROM api_usage " +
        "WHERE day < (now() AT TIME ZONE 'UTC')::date - make_interval(months => $1::int) RETURNING 1",
      [USAGE_RETENTION_MONTHS],
    )) as unknown[];

    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);

    res.statusCode = 200;
    res.json({
      events: events.length,
      buckets: buckets.length,
      usage: usage.length,
    });
  } catch (err) {
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "prune-visitor-data failed, see Sentry" });
  }
}
