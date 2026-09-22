// Daily health check -- Vercel Hobby's minimum cron interval, enough
// since DB growth is bursty rather than sub-daily-urgent and source
// reliability needs a multi-day trend.
//
// Silent on a healthy run. On a threshold breach: emails the maintainer
// directly (see lib/cron/analytics-report.ts for the separate periodic
// trend-review rollup -- this file is the fast threshold-triggered path).
//
// Checks:
//   1. Neon database size vs. the 500MB free-tier cap.
//   2. Per-source image reachability -- samples real image URLs from
//      every live source, alerting only on a genuine failure
//      (non-2xx/timeout/network error), not mere slowness.
//   3. image_load_failed analytics events in the last 24h, per source.
//
// Required env vars: DATABASE_URL, CRON_SECRET, RESEND_API_KEY,
// SUBMIT_NOTIFY_EMAIL.

import * as Sentry from "@sentry/node";
import { del, list, put } from "@vercel/blob";
import * as blobOps from "../blob-ops.ts";
import { getSql } from "../db.ts";
import * as cacheAlerts from "../img-cache-alerts.ts";
import * as eviction from "../img-eviction.ts";
import { reportError } from "../sentry.ts";
import * as sourceHealth from "../source-health.ts";
import { imageFetchHeaders } from "../source-identity.ts";

const DB_SIZE_THRESHOLD_BYTES = 400 * 1024 * 1024; // 80% of Neon free tier's 500MB cap
// 80% of Vercel Blob's 1GB ceiling. Past the cap the image proxy's
// circuit breaker fails CLOSED and SILENTLY, hotlinking source CDNs
// with no error and nothing in the logs.
//
// Decimal bytes deliberately, since "1GB" could mean 10^9 or 2^30
// (7% apart) -- taking the smaller reading fires early if the real
// limit is binary, rather than late if it's decimal.
const BLOB_HARD_CEILING_BYTES = 1000 * 1000 * 1000;
const BLOB_USAGE_THRESHOLD_BYTES = 0.8 * BLOB_HARD_CEILING_BYTES;

// The Simple Operations meter, which actually stopped us once while
// storage sat at 30%. 70% (lower than storage's 80%) because operations
// only reset with the calendar -- there's nothing to free, so the
// warning has to arrive early enough to change behaviour.
const BLOB_OPS_MONTHLY_QUOTA = 10000;
const BLOB_OPS_THRESHOLD = 0.7;
// Low but not noisy: a recent 30-day window had 25 days with zero
// image failures. Raising it would only delay noticing a real outage.
const IMAGE_LOAD_FAILED_THRESHOLD_24H = 5;
// A source must fail across at least this many distinct page loads.
// One page load (a headless client with an unbounded viewport,
// rendering every frame at once) has produced 10,476 rows in a single
// second while images served fine to everyone else; 2 is the smallest
// value that means "more than one client".
const IMAGE_LOAD_FAILED_MIN_PAGE_LOADS = 2;
const SOURCES = ["met", "smithsonian", "cleveland", "commons", "europeana"];
const IMAGE_FETCH_TIMEOUT_MS = 15000;

async function checkDatabaseSize(client: any) {
  const rows = await client.query(
    "SELECT pg_database_size(current_database()) AS bytes",
  );
  const bytes = Number(rows[0].bytes);
  if (bytes >= DB_SIZE_THRESHOLD_BYTES) {
    const mb = Math.round(bytes / 1024 / 1024);
    return `Neon database size is ${mb}MB, over the ${Math.round(DB_SIZE_THRESHOLD_BYTES / 1024 / 1024)}MB (80%) checkpoint of the 500MB free-tier cap.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Maintenance operations, reached with ?op=... rather than their own
// routes -- api/ is at Vercel Hobby's 12-function cap. Triggered by
// hand only; the scheduled cron invocation passes no ?op.
// ---------------------------------------------------------------------------

function blobPathnameFor(source: any, id: any, tier: any) {
  return `img-cache/${source}/${id}/${tier}`;
}

// The id can contain slashes (Commons "File:x.jpg", Europeana
// "/318/..."), so the tier is taken from the end.
function parseBlobPathname(pathname: any) {
  const withoutPrefix = String(pathname).replace(/^img-cache\//, "");
  const parts = withoutPrefix.split("/");
  if (parts.length < 3) return null;
  const tier = parts[parts.length - 1];
  const source = parts[0];
  const id = parts.slice(1, -1).join("/");
  if (!source || !id || !tier) return null;
  return {
    source: source,
    id: id,
    tier: tier,
    cacheKey: `${source}:${id}:${tier}`,
  };
}

async function blobDeleteByKey(cacheKey: any) {
  const parts = String(cacheKey).split(":");
  const source = parts[0];
  const tier = parts[parts.length - 1];
  const id = parts.slice(1, -1).join(":");
  return await del(blobPathnameFor(source, id, tier));
}

async function checkSourceFetchHealth(client: any) {
  const classified = await sourceHealth.loadSourceHealth(client);
  return sourceHealth.healthAlerts(classified);
}

async function checkBlobUsage(client: any) {
  const rows = await client.query(
    "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
  );
  if (!rows.length) return null; // tracker not provisioned
  const bytes = Number(rows[0].total_bytes);
  if (bytes < BLOB_USAGE_THRESHOLD_BYTES) return null;
  const mb = Math.round(bytes / 1024 / 1024);
  const pct = Math.round((bytes / BLOB_HARD_CEILING_BYTES) * 100);
  return (
    `Vercel Blob storage is ${mb}MB, ${pct}% of the 1GB ceiling. ` +
    `At the cap the image proxy stops caching and silently falls back to ` +
    `hotlinking source CDNs. Free up space or change the caching policy ` +
    `before that happens.`
  );
}

// null means "cannot tell" (table absent); 0 means "genuinely none" --
// must not be collapsed.
async function checkBlobOperations(client: any) {
  const total = await blobOps.monthToDateOps(client);
  if (total === null) return null;
  if (total < BLOB_OPS_MONTHLY_QUOTA * BLOB_OPS_THRESHOLD) return null;
  const pct = Math.round((total / BLOB_OPS_MONTHLY_QUOTA) * 100);
  return (
    `Vercel Blob operations are ${total.toLocaleString()} of ${BLOB_OPS_MONTHLY_QUOTA.toLocaleString()} this month (${pct}%). ` +
    `Unlike storage there is nothing to free -- this resets with the calendar. ` +
    `At the cap image caching stops. The long-term fix is S3 + CloudFront; ` +
    `the immediate lever is IMG_ADMIT_THRESHOLD_DISPLAY.`
  );
}

async function checkSourceReachability(client: any) {
  const alerts: any[] = [];
  // Skips sources under a standing hold -- pinging a source through a
  // rate-limit hold just repeats the request we said we'd stop making.
  // One shared definition of "held" (source_fetch_state.hold_reason),
  // so this can't drift from what other routes believe.
  const held = await sourceHealth.heldSourceSet(client, SOURCES);
  for (let i = 0; i < SOURCES.length; i++) {
    if (held[SOURCES[i]]) continue;
    const source = SOURCES[i];
    const rows = await client.query(
      "SELECT img FROM items WHERE source = $1 ORDER BY random() LIMIT 2",
      [source],
    );
    for (let j = 0; j < rows.length; j++) {
      const url = rows[j].img;
      if (!url) continue;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, IMAGE_FETCH_TIMEOUT_MS);
        // Identified via imageFetchHeaders() -- an anonymous daily
        // probe is exactly the shape a WAF flags (an unheaded request
        // to a real Europeana URL got a 403 from Cloudflare).
        const resp = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: imageFetchHeaders(source),
        });
        clearTimeout(timeoutId);
        if (!resp.ok) {
          alerts.push(
            `${source}: image request returned HTTP ${resp.status} (${url})`,
          );
        } else {
          // The only thing that can clear a degraded verdict for a
          // source nobody is currently requesting -- origin fetches
          // only happen on a cache miss, so a quiet source generates
          // no evidence of recovery without this.
          await sourceHealth.recordProbeSuccess(client, source);
        }
      } catch (err) {
        alerts.push(
          `${source}: image request failed (${(err as any).name === "AbortError" ? `timed out after ${IMAGE_FETCH_TIMEOUT_MS / 1000}s` : (err as any).message}) -- ${url}`,
        );
      }
    }
  }
  return alerts;
}

async function checkRecentImageLoadFailures(client: any) {
  // page_load/reason were added later; older rows coalesce to a single
  // 'legacy' bucket, which reads as one page load and can't raise an
  // alert on its own -- correct, since those rows can't distinguish
  // one client from many.
  const rows = await client.query(
    "SELECT props->>'source' AS source, " +
      "count(*) AS n, " +
      "count(DISTINCT coalesce(props->>'page_load', 'legacy')) AS page_loads, " +
      "count(*) FILTER (WHERE props->>'reason' = 'timeout') AS timeouts, " +
      "count(*) FILTER (WHERE props->>'reason' = 'error') AS errors " +
      "FROM analytics_events " +
      "WHERE event_name = 'image_load_failed' AND created_at >= now() - interval '24 hours' " +
      "GROUP BY 1 HAVING count(*) >= $1",
    [IMAGE_LOAD_FAILED_THRESHOLD_24H],
  );
  return rows
    .filter(
      (r: any) => Number(r.page_loads) >= IMAGE_LOAD_FAILED_MIN_PAGE_LOADS,
    )
    .map(
      (r: any) =>
        `Source '${r.source}': ${r.n} failed image load(s) across ${
          r.page_loads
        } page load(s) in the last 24h (${
          r.timeouts
        } timeout, ${r.errors} error).`,
    );
}

async function sendAlertEmail(alerts: any) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail =
    process.env.OPS_ALERT_EMAIL || process.env.SUBMIT_NOTIFY_EMAIL;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";
  if (!apiKey || !notifyEmail) return;

  const textBody = `Tranquilo health check found ${alerts.length} issue(s):\n\n${alerts.map((a: any) => `- ${a}`).join("\n")}`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notifyEmail],
      subject: `Tranquilo health check: ${alerts.length} issue(s) found`,
      text: textBody,
    }),
  }).catch(() => {}); // best-effort -- Resend is the only durable record now
}

// This cron IS the monitoring, so it needs its own outside observer --
// a Sentry cron monitor -- for when it silently stops firing.
const MONITOR_SLUG = "health-check";
const CRON_SCHEDULE = "13 8 * * *";

function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 60,
    maxRuntime: 10,
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

  const op = String(req.query?.op || "");
  if (op) {
    const opClient = getSql();
    if (!opClient || !process.env.BLOB_READ_WRITE_TOKEN) {
      res.statusCode = 500;
      res.json({
        error: "DATABASE_URL and BLOB_READ_WRITE_TOKEN are both required",
      });
      return;
    }
    const commit = String(req.query?.commit || "") === "1";
    try {
      if (op === "reconcile-blob") {
        let cursor: any,
          seen = 0,
          skipped = 0,
          bytes = 0,
          rows: any[] = [],
          byTier: any = {};
        do {
          const page = await list({
            prefix: "img-cache/",
            cursor: cursor,
            limit: 1000,
          });
          for (let i = 0; i < page.blobs.length; i++) {
            const b = page.blobs[i];
            seen++;
            const p = parseBlobPathname(b.pathname);
            if (!p) {
              skipped++;
              continue;
            }
            bytes += b.size;
            byTier[p.tier] = byTier[p.tier] || { count: 0, bytes: 0 };
            byTier[p.tier].count++;
            byTier[p.tier].bytes += b.size;
            rows.push([
              p.cacheKey,
              p.source,
              p.tier,
              b.size,
              b.uploadedAt || null,
              p.id,
            ]);
          }
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);

        const tr = await opClient.query(
          "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
        );
        const tracked = tr.length ? Number(tr[0].total_bytes) : null;
        const drift = tracked == null ? null : tracked - bytes;

        let written = 0;
        if (commit) {
          for (let j = 0; j < rows.length; j++) {
            const r = rows[j];
            // last_seen takes the object's upload time, not now() --
            // stamping every pre-existing object as freshly seen would
            // invert LRU, evicting genuinely-hot entries first.
            await opClient.query(
              "INSERT INTO img_cache_entries (cache_key, source, tier, native_id, requests, bytes, admitted_at, first_seen, last_seen) " +
                "VALUES ($1, $2, $3, $6, 1, $4, $5, $5, $5) " +
                "ON CONFLICT (cache_key) DO UPDATE SET bytes = EXCLUDED.bytes, " +
                "  admitted_at = COALESCE(img_cache_entries.admitted_at, EXCLUDED.admitted_at), " +
                "  native_id = COALESCE(img_cache_entries.native_id, EXCLUDED.native_id)",
              [r[0], r[1], r[2], r[3], r[4] || new Date().toISOString(), r[5]],
            );
            written++;
          }
          if (drift !== null && drift !== 0) {
            await opClient.query(
              "UPDATE blob_usage_tracker SET total_bytes = $1 WHERE id = 1",
              [bytes],
            );
          }
        }
        res.statusCode = 200;
        res.json({
          op: op,
          mode: commit ? "committed" : "dry-run",
          objects_seen: seen,
          objects_unparseable: skipped,
          actual_bytes: bytes,
          actual_mb: Math.round(bytes / 1e5) / 10,
          tracker_bytes: tracked,
          tracker_mb: tracked == null ? null : Math.round(tracked / 1e5) / 10,
          drift_bytes: drift,
          drift_mb: drift == null ? null : Math.round(drift / 1e5) / 10,
          by_tier: byTier,
          entries_written: written,
        });
        return;
      }

      if (op === "verify-eviction") {
        const capOverride = Number(req.query?.cap);
        const cap =
          Number.isFinite(capOverride) && capOverride > 0
            ? capOverride
            : Number(process.env.BLOB_USAGE_SOFT_CAP_BYTES) ||
              950 * 1024 * 1024;

        const beforeRows = await opClient.query(
          "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
        );
        const usedBefore = beforeRows.length
          ? Number(beforeRows[0].total_bytes)
          : null;
        const storedRows = await opClient.query(
          "SELECT count(*) AS n FROM img_cache_entries WHERE bytes IS NOT NULL",
        );
        const storedCount = Number(storedRows[0].n);
        if (storedCount === 0) {
          res.statusCode = 200;
          res.json({
            op: op,
            ok: false,
            blocked_on: "img_cache_entries has no stored rows",
            detail:
              "Eviction can only remove objects it knows about. Run " +
              "?op=reconcile-blob&commit=1 first.",
            used_bytes: usedBefore,
          });
          return;
        }
        // force bypasses IMG_EVICTION_ENABLED to exercise the real
        // path before arming it globally -- none of eviction's own
        // safety rules are bypassed.
        const result = await eviction.evictIfNeeded(opClient, blobDeleteByKey, {
          cap: cap,
          force: true,
          dryRun: !commit,
        });
        const afterRows = await opClient.query(
          "SELECT total_bytes FROM blob_usage_tracker WHERE id = 1",
        );
        const usedAfter = afterRows.length
          ? Number(afterRows[0].total_bytes)
          : null;
        res.statusCode = 200;
        res.json({
          op: op,
          mode: commit
            ? "COMMITTED -- objects were deleted"
            : "dry run -- nothing deleted",
          cap_used: cap,
          cap_was_overridden: Number.isFinite(capOverride) && capOverride > 0,
          high_water_bytes: Math.round(cap * eviction.HIGH_WATER),
          low_water_bytes: Math.round(cap * eviction.LOW_WATER),
          stored_entries: storedCount,
          tracker_before: usedBefore,
          tracker_after: usedAfter,
          tracker_delta:
            usedBefore != null && usedAfter != null
              ? usedBefore - usedAfter
              : null,
          result: result,
          eviction_globally_enabled: eviction.isEnabled(),
        });
        return;
      }

      res.statusCode = 400;
      res.json({
        error: "Unknown op",
        known: ["reconcile-blob", "verify-eviction"],
      });
      return;
    } catch (opErr) {
      res.statusCode = 500;
      res.json({
        op: op,
        error: String(((opErr as any) && (opErr as any).message) || opErr),
      });
      return;
    }
  }

  const client = getSql();
  if (!client) {
    console.error("health-check: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Database isn't configured" });
    return;
  }

  try {
    let alerts = [];
    const dbSizeAlert = await checkDatabaseSize(client);
    if (dbSizeAlert) alerts.push(dbSizeAlert);
    const blobOpsAlert = await checkBlobOperations(client);
    if (blobOpsAlert) alerts.push(blobOpsAlert);

    const blobAlert = await checkBlobUsage(client);
    if (blobAlert) alerts.push(blobAlert);
    alerts = alerts.concat(await checkSourceReachability(client));
    alerts = alerts.concat(await checkRecentImageLoadFailures(client));
    alerts = alerts.concat(await checkSourceFetchHealth(client));
    alerts = alerts.concat(await cacheAlerts.checkTokenBuckets(client));
    alerts = alerts.concat(await cacheAlerts.checkEvictionThrash(client));
    alerts = alerts.concat(await cacheAlerts.checkRateLimits(client));
    alerts = alerts.concat(await cacheAlerts.checkShedReasons(client));
    // Temporary, for as long as the S3 migration stays paused --
    // see lib/img-cache-alerts.ts.
    alerts = alerts.concat(
      await cacheAlerts.checkBlobSuspended(client, put, del),
    );

    if (alerts.length === 0) {
      // Flushed before the response, not merely before returning --
      // Sentry's SDK sends asynchronously and a serverless function
      // freezes once the platform has its response. A flush placed
      // after res.json() is a race, not a guarantee, and lost once.
      Sentry.captureCheckIn(
        { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
        monitorConfig(),
      );
      await Sentry.flush(2000);
      res.statusCode = 200;
      res.json({ ok: true, alerts: [] });
      return;
    }

    await sendAlertEmail(alerts);
    // Finding alerts is a SUCCESSFUL run -- checking in as "error"
    // would conflate "health-check is broken" with "health-check
    // found something", which is the whole point of running it.
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);
    res.statusCode = 200;
    res.json({ ok: true, alerts: alerts });
  } catch (err) {
    console.error("health-check: failed", err);
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err); // awaits its own flush
    res.statusCode = 500;
    res.json({ error: "Health check failed" });
  }
}

// Named exports for the offline suite.
export {
  checkRecentImageLoadFailures,
  checkSourceReachability,
  IMAGE_LOAD_FAILED_MIN_PAGE_LOADS,
  IMAGE_LOAD_FAILED_THRESHOLD_24H,
};
