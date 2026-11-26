// Read by the daily health-check cron. Returns human-readable lines, empty
// when there is nothing to say; a check that throws reports nothing.
//
// The daily summary of visitors the budget refused, however briefly. Visitors reading heavily
// without being refused are caught by the real-time alerts in
// items-abuse-alert.ts.
import type { QuerySql } from "./img-store.ts";
import {
  VISITOR_DENIED_COST_MIN,
  VISITORS_DENIED_MIN,
} from "./items-abuse-alert.ts";

export { VISITOR_DENIED_COST_MIN, VISITORS_DENIED_MIN };

interface DenialSummary {
  kind: string;
  visitors: number;
  heavy: number;
  worst: number;
  total: number;
}

const ITEMS_FIREWALL_RULE = 'rule "Rate limit /api/items per IP"';

interface BucketWording {
  endpoint: string;
  where: string;
}

function wordingFor(kind: string): BucketWording {
  const inFirewallView = `find the IPs in the Vercel firewall traffic view (${ITEMS_FIREWALL_RULE})`;
  if (kind === "items")
    return { endpoint: "/api/items feed and search", where: inFirewallView };
  if (kind === "detail")
    return { endpoint: "/api/items item-detail", where: inFirewallView };
  if (kind === "quote")
    return { endpoint: "/api/items print-quote", where: inFirewallView };
  if (kind.startsWith("write:"))
    return {
      endpoint: `'${kind.slice("write:".length)}' write endpoint`,
      where:
        "find the IPs in the Vercel firewall traffic view filtered to that endpoint",
    };
  return {
    endpoint: `'${kind}'`,
    where: "find the IPs in the Vercel firewall traffic view",
  };
}

// The last complete day: items_budget_events is day-granular.
export async function checkItemsBudgetDenials(
  sql: QuerySql | null | undefined,
): Promise<string[]> {
  if (!sql) return [];
  try {
    const rows = (await sql.query(
      "SELECT kind, count(*)::int AS visitors, " +
        "  (count(*) FILTER (WHERE denied_cost >= $1))::int AS heavy, " +
        "  max(denied_cost)::int AS worst, sum(denied_cost)::int AS total " +
        " FROM items_budget_events WHERE day = CURRENT_DATE - 1 " +
        " GROUP BY kind " +
        " HAVING count(*) FILTER (WHERE denied_cost >= $1) > 0 OR count(*) >= $2 " +
        "   OR count(*) FILTER (WHERE enforced) > 0 " +
        " ORDER BY kind",
      [VISITOR_DENIED_COST_MIN, VISITORS_DENIED_MIN],
    )) as DenialSummary[];
    return rows.map((r) => {
      const { endpoint, where } = wordingFor(r.kind);
      return (
        `${r.visitors} visitor(s) ran past the ${endpoint} budget yesterday ` +
        `(${r.heavy} refused ${VISITOR_DENIED_COST_MIN}+ items; worst ${r.worst}, ${r.total} in total). ` +
        `The rows carry no address: ${where} and block from there if it is scraping.`
      );
    });
  } catch (_err) {
    return [];
  }
}
