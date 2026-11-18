// Several cron jobs merged into one file, dispatching on ?job=. Originally
// done to stay under a 12-function plan cap; kept because it keeps each
// job's cold-start bundle out of every other function. Each job's logic lives in
// lib/cron/ (only api/ files count toward the cap) and still does its
// own CRON_SECRET check internally, so calling one directly behaves
// exactly as before the merge -- this file only adds routing.
//
// Not merged: api/items.ts and api/img/[source]/[id]/[tier].ts (hot,
// real-visitor-traffic paths) and api/og/[slug].ts (would add @vercel/og's
// 2.1M to every /v/[slug] cold start).
//
// `opts.jobs` is injected so the dispatch contract is testable without
// touching the real handlers -- see tests/cron-dispatcher.test.ts.

import dbBackup from "../../lib/cron/db-backup.ts";
import healthCheck from "../../lib/cron/health-check.ts";
import pruneVisitorData from "../../lib/cron/prune-visitor-data.ts";
import restoreDrillReminder from "../../lib/cron/restore-drill-reminder.ts";
import vercelDeploymentCleanup from "../../lib/cron/vercel-deployment-cleanup.ts";
import warmImageCache from "../../lib/cron/warm-image-cache.ts";
import { isCronAuthorized } from "../../lib/cron-auth.ts";
import type { CronRequest, CronResponse } from "../../lib/cron-types.ts";

type CronJob = (req: CronRequest, res: CronResponse) => unknown;

const REAL_JOBS: Record<string, CronJob> = {
  "db-backup": dbBackup,
  "health-check": healthCheck,
  "prune-visitor-data": pruneVisitorData,
  "restore-drill-reminder": restoreDrillReminder,
  "vercel-deployment-cleanup": vercelDeploymentCleanup,
  // Reachable by hand but not in vercel.json's `crons` -- a rare-backfill
  // job now, not a standing schedule; scripts/warm_image_cache.mts is
  // the CLI for that.
  "warm-image-cache": warmImageCache,
};

async function handler(
  req: CronRequest,
  res: CronResponse,
  opts?: { jobs?: Record<string, CronJob> },
) {
  const jobs = opts?.jobs || REAL_JOBS;
  const job = req.query?.job;
  // Own keys only: `jobs.constructor` would otherwise dispatch to Object.
  const fn =
    typeof job === "string" && Object.hasOwn(jobs, job) ? jobs[job] : undefined;
  if (!fn) {
    res.statusCode = 400;
    res.json(
      isCronAuthorized(req)
        ? { error: "Unknown or missing ?job", known: Object.keys(jobs) }
        : { error: "Unknown or missing ?job" },
    );
    return;
  }
  return fn(req, res);
}

export default handler;
// Exported for tests.
export { REAL_JOBS };
