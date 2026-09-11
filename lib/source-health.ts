// Is a source healthy enough to fetch from? Reads state written elsewhere by
// recordOriginOutcome and blockSource; kept separate from
// lib/img-fetch-guard.js since that module is on the request path and this
// one (health-check cron, operators) is not.
//
// Deliberately does NOT filter manifests by health: excluding a degraded
// source would empty whole categories (Architecture & Space is all
// Smithsonian) and deadlock recovery (no requests means consecutive_failures
// never resets). Health drives alerting and shedding, not visibility -- the
// client already degrades a failed image gracefully on its own.

// Asymmetric on purpose: five consecutive failures degrade a source, one
// success clears it. Wrongly calling a source degraded costs a spurious
// alert; wrongly leaving it degraded suppresses a real one later.
//
// Lives in config.toml's [source_health] -- baked in at build time, never
// read live.
import { TRANQUILO_CONFIG } from "./config.generated.ts";

const DEGRADED_AFTER_CONSECUTIVE_FAILURES =
  TRANQUILO_CONFIG.source_health.degraded_after_consecutive_failures;

/**
 * Returns one row per source with a derived status. Pure interpretation --
 * pass in the rows, get back the verdicts, so this is testable without a
 * database and cannot accidentally write anything.
 *
 * Status precedence, most permanent first:
 *   held      a standing policy decision (the Wikimedia rate-limit hold). Not a
 *             health problem and must never be reported as one -- alerting on
 *             it would page someone daily about a decision we made.
 *   cooling   inside a Retry-After window the source itself asked for.
 *   degraded  N consecutive failures with no standing reason for them.
 *   healthy   everything else.
 */
type SourceHealthRow = {
  source: string;
  hold_reason?: string | null;
  blocked_until?: string | null;
  consecutive_failures?: number | string | null;
  last_status?: number | string | null;
  last_ok_at?: string | null;
};

type SourceVerdict = {
  source: string;
  status: "healthy" | "held" | "cooling" | "degraded";
  consecutive_failures: number;
  last_status: number | null;
  last_ok_at: string | null;
  hold_reason: string | null;
  blocked_until: string | null;
};

function classifySources(
  rows: SourceHealthRow[] | null | undefined,
  now?: string | number | Date | null,
): SourceVerdict[] {
  const at = now ? new Date(now).getTime() : Date.now();
  return (rows || []).map((r) => {
    const blockedUntil = r.blocked_until
      ? new Date(r.blocked_until).getTime()
      : null;
    const failures = Number(r.consecutive_failures || 0);
    let status: SourceVerdict["status"] = "healthy";
    if (r.hold_reason) status = "held";
    else if (blockedUntil && blockedUntil > at) status = "cooling";
    else if (failures >= DEGRADED_AFTER_CONSECUTIVE_FAILURES)
      status = "degraded";
    return {
      source: r.source,
      status: status,
      consecutive_failures: failures,
      last_status: r.last_status == null ? null : Number(r.last_status),
      last_ok_at: r.last_ok_at || null,
      hold_reason: r.hold_reason || null,
      blocked_until: r.blocked_until || null,
    };
  });
}

/** Human-readable alert lines for anything not healthy and not deliberately
 *  held. Returns [] when everything is fine, so the caller can stay quiet. */
function healthAlerts(
  classified: SourceVerdict[] | null | undefined,
): string[] {
  return (classified || [])
    .filter((s) => s.status === "degraded" || s.status === "cooling")
    .map((s) => {
      if (s.status === "cooling") {
        return (
          `Image source '${s.source}' is in a rate-limit cooldown until ${
            s.blocked_until
          } (last status ${s.last_status}). Server-side ` +
          `fetches for it are paused; visitors are being served from the source ` +
          `directly meanwhile.`
        );
      }
      return `Image source '${s.source}' has failed ${
        s.consecutive_failures
      } consecutive origin fetches (last status ${s.last_status}, last success ${
        s.last_ok_at || "never"
      }). Uncached images from it are failing for real visitors.`;
    });
}

/**
 * The set of sources under a standing hold, as a plain object for O(1) lookup.
 *
 * Exists because several server-side paths (health-check, analytics-report,
 * api/og/[slug]) fetch source images directly from the raw origin URL on
 * their own schedule, bypassing the Wikimedia hold honoured elsewhere.
 *
 * Fails CLOSED: if the holds cannot be read, every source is reported held --
 * losing a latency sample is trivial; breaking a hold commitment is not.
 */
async function heldSourceSet(
  sql: any,
  allSources?: string[] | null,
): Promise<Record<string, string>> {
  const closed: Record<string, string> = {};
  (allSources || []).forEach((s) => {
    closed[s] = "holds unreadable";
  });
  if (!sql) return closed;
  try {
    const rows = await sql(
      "SELECT source, hold_reason FROM source_fetch_state WHERE hold_reason IS NOT NULL",
    );
    const held: Record<string, string> = {};
    for (let i = 0; i < rows.length; i++)
      held[rows[i].source] = rows[i].hold_reason;
    return held;
  } catch (_err) {
    return closed;
  }
}

async function loadSourceHealth(sql: any): Promise<SourceVerdict[]> {
  if (!sql) return [];
  try {
    const rows = await sql(
      "SELECT source, consecutive_failures, last_status, last_ok_at, " +
        "       hold_reason, blocked_until FROM source_fetch_state ORDER BY source",
    );
    return classifySources(rows);
  } catch (_err) {
    return [];
  }
}

/**
 * Clears a degraded verdict after an out-of-band probe succeeds.
 *
 * This exists because of the recovery problem described at the top: a source
 * whose images nobody requests generates no fetches, so nothing would ever
 * reset its failure count on its own. The health-check cron already probes
 * every source's images directly -- this lets that probe count as the success
 * it actually is.
 */
async function recordProbeSuccess(sql: any, source: string): Promise<void> {
  if (!sql) return;
  try {
    await sql(
      "UPDATE source_fetch_state SET consecutive_failures = 0, last_ok_at = now(), " +
        "  last_status = 200, updated_at = now() WHERE source = $1",
      [source],
    );
  } catch (_err) {
    // A probe that cannot record its own success is not worth failing over.
  }
}

export {
  classifySources,
  DEGRADED_AFTER_CONSECUTIVE_FAILURES,
  healthAlerts,
  heldSourceSet,
  loadSourceHealth,
  recordProbeSuccess,
};
