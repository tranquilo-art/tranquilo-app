// Count Blob operations, because nothing did -- the Vercel dashboard once
// reported 7.6K of 10K Simple Operations with ten days left in the month,
// found out via email, since operations had been inferred from cache
// hits/misses (which undercounts: hits are an immutable 302 that never
// re-enters the function, and eviction's del() was never counted at all).
//
// Wraps put/head/del rather than placing counters at call sites, so a new
// call site is counted automatically. Counts failures too, since Vercel
// bills an operation whether or not it succeeds. Fire-and-forget and
// approximate by design: serving an image matters more than counting it, so
// a failing recorder is swallowed. Aggregated on write (one row per day/op),
// never a per-request log, same discipline as img_cache_stats.

// `record(op)` is injected rather than imported so this stays testable without
// a database, and so the eviction path can share it.
type BlobOpsDeps = {
  put: (...args: any[]) => any;
  head: (...args: any[]) => any;
  del: (...args: any[]) => any;
  record: (op: string) => any;
};

function makeCountedBlobOps(deps: BlobOpsDeps) {
  const put = deps.put;
  const head = deps.head;
  const del = deps.del;
  const record = deps.record;

  function count(op: string): void {
    try {
      const p = record(op);
      // Swallow both a rejected promise and a synchronous throw.
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_e) {
      /* counting must never break serving */
    }
  }

  // The count happens BEFORE awaiting, so an operation that throws is still
  // counted -- see the note above about billing.
  return {
    put: (...args: any[]) => {
      count("put");
      return put.apply(null, args);
    },
    head: (...args: any[]) => {
      count("head");
      return head.apply(null, args);
    },
    del: (...args: any[]) => {
      count("del");
      return del.apply(null, args);
    },
  };
}

// Aggregated upsert, one row per (day, op). Mirrors bumpStat's shape.
async function recordBlobOp(sql: any, op: string): Promise<void> {
  if (!sql) return;
  await sql(
    "INSERT INTO blob_ops_stats (day, op, n) VALUES (CURRENT_DATE, $1, 1) " +
      "ON CONFLICT (day, op) DO UPDATE SET n = blob_ops_stats.n + 1",
    [op],
  );
}

// Month-to-date total, the number the Vercel quota is measured against.
// Returns null (not 0) when unreachable, since "no data" and "zero
// operations" mean very different things in an alert.
async function monthToDateOps(sql: any): Promise<number | null> {
  if (!sql) return null;
  try {
    const rows = await sql(
      "SELECT COALESCE(SUM(n), 0)::bigint AS total FROM blob_ops_stats " +
        "WHERE day >= date_trunc('month', CURRENT_DATE)",
    );
    if (!rows?.length) return 0;
    return Number(rows[0].total);
  } catch (_e) {
    return null;
  }
}

export { makeCountedBlobOps, monthToDateOps, recordBlobOp };
