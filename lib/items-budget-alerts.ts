// Read by the daily health-check cron. Returns human-readable lines, empty
// when there is nothing to say; a check that throws reports nothing.
//
// The daily summary of visitors the budget refused. Visitors reading heavily
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
        " ORDER BY kind",
      [VISITOR_DENIED_COST_MIN, VISITORS_DENIED_MIN],
    )) as DenialSummary[];
    return rows.map(
      (r) =>
        `${r.visitors} visitor(s) ran past the '${r.kind}' budget on /api/items yesterday ` +
        `(${r.heavy} refused ${VISITOR_DENIED_COST_MIN}+ items; worst ${r.worst}, ${r.total} in total). ` +
        `The rows carry no address: find the IPs in the Vercel firewall traffic view ` +
        `(rule "Rate limit /api/items per IP") and block from there if it is scraping.`,
    );
  } catch (_err) {
    return [];
  }
}
