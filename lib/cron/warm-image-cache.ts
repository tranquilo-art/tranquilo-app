// NOT CURRENTLY SCHEDULED -- no entry in vercel.json's `crons`, by design.
// Kept only so the endpoint can be triggered by hand
// (`Authorization: Bearer $CRON_SECRET` to /api/cron?job=warm-image-cache);
// the actual current tool is the CLI, `node scripts/warm_image_cache.mts
// --commit`, run occasionally as a backfill.
//
// Unscheduled because ingest-time caching already retries on its own
// (fetch_image_bytes()'s 6x backoff), so what's left to catch is rare
// enough that a standing cron is more moving parts than the problem needs.
// Sentry cron monitors are a billed quota, so this job has none; add one
// back only if it is rescheduled. If ever rescheduled, it's safe because a
// fixed, small LIMIT per run makes cost capped and predictable rather than
// scaling with visitor traffic (unlike Fluid CPU / Fast Origin Transfer).
//
// Bounded (default 50 items/run) to fit one invocation without a mid-batch
// timeout, and resumable by construction. Shares lib/img-warm.ts's
// warmBatch() rather than reimplementing the loop -- that module (not
// scripts/warm_image_cache.mts, which isn't part of this function's bundle)
// is the shared implementation; the CLI re-exports it. Required env vars if
// invoked: DATABASE_URL, CRON_SECRET, plus the S3_*/IMG_CDN_BASE_URL vars
// api/img's own S3 path already requires.

import * as proxy from "../../api/img/[source]/[id]/[tier].ts";
import type { CronRequest, CronResponse } from "../cron-types.ts";
import { getSql } from "../db.ts";
import * as objectKey from "../img-object-key.ts";
import * as s3 from "../img-s3.ts";
import * as store from "../img-store.ts";
import { sourcesToWarm, warmBatch } from "../img-warm.ts";
import { reportError } from "../sentry.ts";
import * as identity from "../source-identity.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200; // a manual ?limit= override still can't turn one
// invocation into an hours-long run.

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

    res.statusCode = 200;
    res.json({ ...result, log: lines });
  } catch (err) {
    console.error("warm-image-cache:", (err as Error)?.message || err);
    await reportError(err); // awaits its own flush
    res.statusCode = 500;
    res.json({ error: String((err as Error)?.message || err), log: lines });
  }
}
