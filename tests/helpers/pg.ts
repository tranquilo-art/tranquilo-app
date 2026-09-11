/* A real Postgres, in-process, for the SQL this project's safety rests on.
 *
 * WHY A MOCK IS NOT ENOUGH HERE, CONCRETELY
 *
 * tests/img-eviction.test.js drives eviction through an in-memory `sql` double
 * that reimplements the candidate query in JavaScript, including this line:
 *
 *     .filter((e) => !pinned.includes(String(e.cache_key).split(":")[1]))
 *
 * which is a faithful JS translation of the SQL's split_part(cache_key,':',2)
 * -- faithful including its bug. Commons ids contain colons, so both versions
 * mis-parse every Commons key the same way, the mock agrees with the code, and
 * twenty passing tests cannot see it.
 *
 * That is the general hazard: when a mock reimplements the thing under test,
 * it can only ever confirm that my reading of the code matches my reading of
 * the code. Properties that live in SQL have to be checked against SQL.
 *
 * PGlite is genuine PostgreSQL compiled to WASM, in-process. No Docker, no
 * network, no DATABASE_URL -- the suite stays offline by design.
 *
 * WHAT THIS HONESTLY DOES NOT COVER
 *
 * PGlite executes statements serially, so parallel transactions are not
 * exercised. Smaller than it sounds: Postgres row locking makes concurrent
 * UPDATEs on one row equivalent to SOME serial order, so the question that is
 * actually ours -- given the state the previous caller left, does the next
 * caller's predicate refuse correctly? -- is what a serial run answers. We are
 * not testing whether Postgres takes the lock.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(import.meta.dirname, "..", "..");

/* DDL is read from the same sql/*.sql files that were run by hand against
 * Neon, never restated here. A restatement drifts, and it drifts in the
 * direction that matters: tests passing against a schema production lacks. */
function ddl(...files: string[]) {
  return files
    .map((f) => readFileSync(join(ROOT, "sql", f), "utf8"))
    .join("\n");
}

/**
 * A `sql` function shaped like @neondatabase/serverless's, so modules under
 * test cannot tell the difference: sql(text, params) resolving to rows.
 */
async function makeSql(files: string[]) {
  const db = new PGlite();
  await db.exec(ddl(...files));
  const sql: any = async (text: string, params?: any[]) =>
    (await db.query(text, params || [])).rows;
  sql.$db = db;
  sql.$close = () => db.close();
  return sql;
}

export { makeSql };
