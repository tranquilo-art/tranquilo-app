// Read by the daily health-check cron. Returns human-readable lines, empty
// when traffic looks ordinary.
//
// Unlike the other digests, a check that cannot run says so: this one depends
// on an API token, and a missing token would otherwise look like a quiet day.

import { TRANQUILO_CONFIG } from "./config.generated.ts";

const QUERY_URL = "https://api.vercel.com/v2/observability/query";
const DAY_MS = 86_400_000;
const SPIKE_ACTIONS = ["deny", "challenge"];

type Row = Record<string, string | number | null | undefined>;
type Env = Record<string, string | undefined>;

interface Scope {
  token: string;
  teamId: string;
  projectId: string;
}

function scopeFromEnv(env: Env): Scope | null {
  const token = env.VERCEL_API_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_ORG_ID || env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) return null;
  return { token, teamId, projectId };
}

async function queryRequests(
  fetchImpl: typeof fetch,
  scope: Scope,
  body: Record<string, unknown>,
): Promise<Row[]> {
  const res = await fetchImpl(
    `${QUERY_URL}?teamId=${encodeURIComponent(scope.teamId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${scope.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metric: "vercel.request.count",
        aggregation: "sum",
        scope: {
          type: "project",
          ownerId: scope.teamId,
          projectIds: [scope.projectId],
        },
        ...body,
      }),
    },
  );
  if (!res.ok) throw new Error(`observability query returned ${res.status}`);
  const json = (await res.json()) as { data?: Row[] };
  return json.data ?? [];
}

const count = (r: Row) => Number(r.vercel_request_count_sum ?? 0);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function heavyClientLines(rows: Row[], min: number): string[] {
  const busiest = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.asn_name}\u0000${r.client_ja4_digest}`;
    const prev = busiest.get(key);
    if (!prev || count(r) > count(prev)) busiest.set(key, r);
  }
  return [...busiest.values()]
    .filter((r) => count(r) >= min)
    .sort((a, b) => count(b) - count(a))
    .map(
      (r) =>
        `Firewall: one visitor sent ${count(r)} requests in the hour from ${r.timestamp} ` +
        `(network ${r.asn_name}, JA4 ${r.client_ja4_digest}), above ${min}/hour. ` +
        `Unless a rule matched, all of it reached the app. To see what it fetched: ` +
        `vercel firewall traffic inspect ja4 ${r.client_ja4_digest} --since 2d --group-by path`,
    );
}

function actionSpikeLines(
  rows: Row[],
  lastDay: string,
  ratio: number,
  floor: number,
): string[] {
  return SPIKE_ACTIONS.flatMap((action) => {
    const mine = rows.filter((r) => r.waf_action === action);
    const day = (r: Row) => String(r.timestamp).slice(0, 10);
    const latest = mine.filter((r) => day(r) === lastDay).map(count)[0] ?? 0;
    const before = median(mine.filter((r) => day(r) < lastDay).map(count));
    if (latest < floor || latest < before * ratio) return [];
    const verb = action === "deny" ? "denied" : "challenged";
    return [
      `Firewall: ${latest} requests were ${verb} on ${lastDay}, over ${ratio}x the ` +
        `prior week's median of ${before}. The Firewall > Traffic view shows which ` +
        `rule and which networks.`,
    ];
  });
}

export async function checkFirewallTraffic(
  fetchImpl: typeof fetch = fetch,
  env: Env = process.env,
  now: Date = new Date(),
): Promise<string[]> {
  const scope = scopeFromEnv(env);
  if (!scope) {
    return [
      "Firewall digest skipped: VERCEL_API_TOKEN, VERCEL_PROJECT_ID and " +
        "VERCEL_ORG_ID (or VERCEL_TEAM_ID) must all be set.",
    ];
  }
  const limits = TRANQUILO_CONFIG.firewall_alerts;
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const lastDay = new Date(today - DAY_MS).toISOString().slice(0, 10);
  try {
    const [clients, actions] = await Promise.all([
      queryRequests(fetchImpl, scope, {
        startTime: new Date(now.getTime() - DAY_MS).toISOString(),
        endTime: now.toISOString(),
        granularity: { minutes: 60 },
        groupBy: ["asnName", "clientJa4Digest"],
        limit: 50,
      }),
      queryRequests(fetchImpl, scope, {
        startTime: new Date(today - 8 * DAY_MS).toISOString(),
        endTime: new Date(today).toISOString(),
        granularity: { days: 1 },
        groupBy: ["wafAction"],
      }),
    ]);
    return [
      ...heavyClientLines(clients, limits.client_requests_per_hour_min),
      ...actionSpikeLines(
        actions,
        lastDay,
        limits.action_spike_ratio,
        limits.action_spike_floor,
      ),
    ];
  } catch (err) {
    return [
      `Firewall digest failed: ${err instanceof Error ? err.message : String(err)}`,
    ];
  }
}
