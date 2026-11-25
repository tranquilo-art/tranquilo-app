// Daily per-visitor refusal counters, one row per (day, visitor, kind), read
// by the health-check digests in items-budget-alerts.ts.

import type { QuerySql } from "./img-store.ts";

const RECORD_DENIAL_SQL =
  "INSERT INTO items_budget_events (day, visitor, kind, denied_requests, denied_cost, enforced) " +
  "VALUES ((now() AT TIME ZONE 'UTC')::date, $1, $2, 1, $3, $4) " +
  "ON CONFLICT (day, visitor, kind) DO UPDATE SET " +
  "  denied_requests = items_budget_events.denied_requests + 1, " +
  "  denied_cost = items_budget_events.denied_cost + $3, " +
  "  enforced = $4, " +
  "  last_seen = now() " +
  "RETURNING denied_cost";

// The day's refused total after this denial, so the caller can tell when it
// crosses an alert line.
export async function recordBudgetDenial(
  sql: QuerySql,
  visitor: string,
  kind: string,
  cost: number,
  enforced: boolean,
): Promise<number | null> {
  try {
    const rows = (await sql.query(RECORD_DENIAL_SQL, [
      visitor,
      kind,
      cost,
      enforced,
    ])) as { denied_cost: string | number }[] | undefined;
    return rows?.length ? Number(rows[0].denied_cost) : null;
  } catch (_err) {
    return null;
  }
}
