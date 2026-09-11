// Shared Neon client getter -- lives outside /api/ for the usual
// function-cap reason. Consolidates nine handlers that each used to carry
// a byte-identical copy of this lazy-init/fail-soft logic. Memoized per
// warm function instance (module-level state, bundled separately per
// function by Vercel, so still one client per function). Returns null
// rather than throwing when DATABASE_URL isn't set, matching the fail-soft
// behavior it replaces.
import { type NeonQueryFunction, neon } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let sql: Sql | null = null;

function getSql(): Sql | null {
  if (!sql) {
    if (!process.env.DATABASE_URL) return null;
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

export { getSql };
