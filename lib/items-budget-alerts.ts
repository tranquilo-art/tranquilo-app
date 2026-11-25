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
        " FROM items_budget_events WHERE day = CURRENT_DATE - 1 AND kind <> 'img' " +
        " GROUP BY kind " +
        " HAVING count(*) FILTER (WHERE denied_cost >= $1) > 0 OR count(*) >= $2 " +
        "   OR count(*) FILTER (WHERE enforced) > 0 " +
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

// Any refusal is worth a line: the image budget is sized so a person
// scrolling never meets it.
export async function checkImageBudgetDenials(
  sql: QuerySql | null | undefined,
): Promise<string[]> {
  if (!sql) return [];
  try {
    const [r] = (await sql.query(
      "SELECT count(*)::int AS visitors, max(denied_cost)::int AS worst, " +
        "  sum(denied_cost)::int AS total " +
        " FROM items_budget_events WHERE day = CURRENT_DATE - 1 AND kind = 'img'",
    )) as { visitors: number; worst: number | null; total: number | null }[];
    if (!r?.visitors) return [];
    return [
      `${r.visitors} visitor(s) were refused images by the per-visitor image budget yesterday ` +
        `(worst ${r.worst}, ${r.total} in total). Small, bursty counts are people: raise ` +
        `[img_visitor_rate_limit] in config.toml. To see who: vercel metrics vercel.request.count ` +
        `--since 2d -q 'route:"/api/img/[source]/[id]/[tier]" AND httpStatus:429' ` +
        `--group-by asnName --group-by clientJa4Digest`,
    ];
  } catch (_err) {
    return [];
  }
}
