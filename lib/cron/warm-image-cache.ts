// NOT CURRENTLY SCHEDULED -- no entry in vercel.json's `crons`, by design.
// Kept only so the endpoint can be triggered by hand
// (`Authorization: Bearer $CRON_SECRET` to /api/cron?job=warm-image-cache);
// the actual current tool is the CLI, `node scripts/warm_image_cache.mts
// --commit`, run occasionally as a backfill.
//
// Unscheduled because ingest-time caching already retries on its own
// (fetch_image_bytes()'s 6x backoff), so what's left to catch is rare
// enough that a standing cron with its own Sentry monitor is more moving
// parts than the problem needs. If ever rescheduled, it's safe because a
// fixed, small LIMIT per run makes cost capped and predictable rather than
// scaling with visitor traffic (unlike Fluid CPU / Fast Origin Transfer).
//
// Bounded (default 50 items/run) to fit one invocation without a mid-batch
// timeout, and resumable by construction. Shares
// scripts/warm_image_cache.mts's warmBatch() rather than reimplementing the
// loop. Required env vars if invoked: DATABASE_URL, CRON_SECRET, plus the
// S3_*/IMG_CDN_BASE_URL vars api/img's own S3 path already requires.

import * as proxy from "../../api/img/[source]/[id]/[tier].ts";
import { sourcesToWarm, warmBatch } from "../../scripts/warm_image_cache.mts";
import { getSql } from "../db.ts";
import * as objectKey from "../img-object-key.ts";
import * as s3 from "../img-s3.ts";
import * as store from "../img-store.ts";
import { reportError, Sentry } from "../sentry.ts";
import * as identity from "../source-identity.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200; // a manual ?limit= override still can't turn one
// invocation into an hours-long run.

// Silent maintenance by design -- a healthy run has nothing worth logging,
// so the Sentry cron monitor is the only thing that would notice a silent
// failure to fire. Flushed before the response, same as every cron here,
// since the SDK sends asynchronously and a frozen serverless function would
// otherwise report an unflushed "ok" as a timeout.
const MONITOR_SLUG = "warm-image-cache";
const CRON_SCHEDULE = "*/30 * * * *";

// checkinMargin tighter than health-check's 60 (sized for a daily schedule)
// since a 30-minute schedule needs a proportionally tighter margin or a
// missed run hides inside it. maxRuntime bounded to DEFAULT_LIMIT items at
// the slowest sanctioned pace, not the worst case of a large manual ?limit=.
function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 10,
    maxRuntime: 5,
    timezone: "UTC",
  };
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

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    monitorConfig(),
  );

  const lines: string[] = [];
  try {
    const sql = getSql();
    if (!sql) {
      throw new Error("Database isn't configured");
    }

    const tier = req.query?.tier === "lightbox" ? "lightbox" : "display";
    const requestedLimit = Number(req.query?.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const result = await warmBatch({
      sql,
      tier,
      sources: sourcesToWarm(null),
      limit,
      commit: true,
      deps: { proxy, objectKey, store, s3, identity },
      onProgress: (line) => lines.push(line),
    });

    Sentry.captureCheckIn(
      { checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);
    res.statusCode = 200;
    res.json({ ...result, log: lines });
  } catch (err: any) {
    console.error("warm-image-cache:", err?.message || err);
    Sentry.captureCheckIn(
      { checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err); // awaits its own flush
    res.statusCode = 500;
    res.json({ error: String(err?.message || err), log: lines });
  }
}
