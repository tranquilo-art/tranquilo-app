// Prunes old Vercel deployments, keeping only the most recent
// KEEP_COUNT. Vercel keeps every deployment indefinitely by default.
//
// Plain fetch against Vercel's REST API, same convention as GitHub/
// Resend/Linear elsewhere in this codebase.
//
// Dry run unless invoked with ?commit=1. The deployment currently
// aliased to production is NEVER deleted, regardless of where it falls
// in the date-sorted list.
//
// Required env vars: CRON_SECRET, VERCEL_API_TOKEN, plus the
// auto-exposed VERCEL_PROJECT_ID and VERCEL_ORG_ID (if the project
// lives under a team).
import { reportError, Sentry } from "../sentry.ts";

const KEEP_COUNT = 10;
const API_BASE = "https://api.vercel.com";

// Terminal states only -- never touch a deployment still being built.
const DELETABLE_STATES = new Set(["READY", "ERROR", "CANCELED"]);

const MONITOR_SLUG = "vercel-deployment-cleanup";
const CRON_SCHEDULE = "19 4 * * *";
function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 15,
    maxRuntime: 10,
    timezone: "UTC",
  };
}

function projectAndTeam() {
  return {
    projectId: process.env.VERCEL_PROJECT_ID,
    teamId: process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID,
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}` };
}

function withTeam(url: URL, teamId?: string) {
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

// Pages through every deployment for the project. Vercel's own limit is
// 100/page; a project would need over 1,000 deployments before this needed
// more than a handful of round trips, which is itself well past the point
// this job should have already pruned things.
async function listAllDeployments(
  projectId: string,
  teamId?: string,
  opts?: any,
) {
  const fetchFn = opts?.fetch || fetch;
  let deployments: any[] = [];
  let until: number | undefined;
  for (;;) {
    const url = withTeam(new URL(`${API_BASE}/v6/deployments`), teamId);
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("limit", "100");
    if (until) url.searchParams.set("until", String(until));
    const res = await fetchFn(url.toString(), { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(
        `Vercel API error listing deployments: HTTP ${res.status}`,
      );
    }
    const json = await res.json();
    deployments = deployments.concat(json.deployments || []);
    if (!json.pagination?.next) break;
    until = json.pagination.next;
  }
  return deployments;
}

// The deployment ids to actually delete, given the full list. Pure function
// (no network) so the selection logic is unit-testable without a live
// Vercel account.
function selectDeploymentsToDelete(deployments: any[]): any[] {
  const sorted = deployments
    .slice()
    .sort(
      (a, b) =>
        (b.createdAt || b.created || 0) - (a.createdAt || a.created || 0),
    );
  const keepIds = new Set(sorted.slice(0, KEEP_COUNT).map((d) => d.uid));
  let productionId = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].target === "production") {
      productionId = sorted[i].uid;
      break;
    }
  }
  if (productionId) keepIds.add(productionId);

  return sorted.filter((d) => {
    if (keepIds.has(d.uid)) return false;
    const state = d.state || d.readyState;
    return DELETABLE_STATES.has(state);
  });
}

async function deleteDeployment(
  id: string,
  projectId: string,
  teamId: string | undefined,
  fetchFn: any,
) {
  const url = withTeam(new URL(`${API_BASE}/v13/deployments/${id}`), teamId);
  url.searchParams.set("projectId", projectId);
  const res = await fetchFn(url.toString(), {
    method: "DELETE",
    headers: authHeaders(),
  });
  return { ok: res.ok, status: res.status };
}

export default async function handler(req: any, res: any, opts?: any) {
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

  const { projectId, teamId } = projectAndTeam();
  if (!projectId || !process.env.VERCEL_API_TOKEN) {
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(
      new Error("VERCEL_PROJECT_ID and VERCEL_API_TOKEN are both required"),
    );
    res.statusCode = 500;
    res.json({
      error: "VERCEL_PROJECT_ID and VERCEL_API_TOKEN are both required",
    });
    return;
  }

  const fetchFn = opts?.fetch || fetch;
  const commit = String(req.query?.commit || "") === "1";

  try {
    const deployments = await listAllDeployments(projectId, teamId, {
      fetch: fetchFn,
    });
    const toDelete = selectDeploymentsToDelete(deployments);

    const results: any[] = [];
    if (commit) {
      for (let i = 0; i < toDelete.length; i++) {
        const d = toDelete[i];
        const result = await deleteDeployment(
          d.uid,
          projectId,
          teamId,
          fetchFn,
        );
        results.push({
          id: d.uid,
          url: d.url,
          ok: result.ok,
          status: result.status,
        });
      }
    }

    console.log(
      commit
        ? "vercel-deployment-cleanup: deleted"
        : "vercel-deployment-cleanup: DRY RUN, would delete",
      {
        total: deployments.length,
        kept: deployments.length - toDelete.length,
        deleted: toDelete.length,
      },
    );

    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);

    res.statusCode = 200;
    res.json({
      commit: commit,
      total: deployments.length,
      kept: deployments.length - toDelete.length,
      candidates: toDelete.map((d) => ({
        id: d.uid,
        url: d.url,
        createdAt: d.createdAt,
      })),
      results: results,
    });
  } catch (err) {
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "vercel-deployment-cleanup failed, see Sentry" });
  }
}

export { KEEP_COUNT, selectDeploymentsToDelete };
