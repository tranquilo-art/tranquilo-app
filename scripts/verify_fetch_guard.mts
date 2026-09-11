// Prove the concurrency properties against real Postgres. A fake sql client
// (tests/img-fetch-guard.test.js) would cheerfully confirm whatever it's
// told; "two concurrent callers never both spend the last token" is a
// property of the Postgres statement, checkable only for real.
//
// Not part of the vitest suite (offline by design, no DATABASE_URL in CI) --
// run by hand after touching lib/img-fetch-guard.ts. Most assertions are
// also ported into tests/img-guard-atomicity.test.js against PGlite, which
// runs on every commit, but PGlite executes serially and can't produce
// genuinely parallel transactions -- only this, against Neon's HTTP driver,
// exercises real concurrency end to end.
//
// Read-mostly and self-cleaning: works on synthetic sources/keys prefixed
// `__verify__`, deleted at the end, never touching a real source's budget.
//
//   node scripts/verify_fetch_guard.mts
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import * as admission from "../lib/img-admission.ts";
import * as guard from "../lib/img-fetch-guard.ts";

for (const line of readFileSync(
  new URL("../.env.local", import.meta.url),
  "utf8",
).split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL!);

const SOURCE = "__verify__source";
const KEY = "__verify__key";
let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  -- ${detail}` : ""}`,
  );
  if (!ok) failures++;
}

async function cleanup() {
  await sql("DELETE FROM source_fetch_state WHERE source = $1", [SOURCE]);
  await sql("DELETE FROM img_fetch_claims WHERE cache_key LIKE '__verify__%'");
  await sql("DELETE FROM img_cache_stats WHERE source = $1", [SOURCE]);
  await sql("DELETE FROM img_cache_entries WHERE cache_key LIKE '__verify__%'");
}

console.log("Verifying img-fetch-guard against real Postgres\n");
await cleanup();

// --- 1b: N concurrent claims on one key produce exactly ONE winner ----------
console.log("single-flight (1b)");
await sql("DELETE FROM img_fetch_claims WHERE cache_key = $1", [KEY]);
{
  const N = 40;
  const results = await Promise.all(
    Array.from({ length: N }, () => guard.claimFetch(sql, KEY)),
  );
  const winners = results.filter(Boolean).length;
  check(
    `${N} concurrent claims -> exactly 1 winner`,
    winners === 1,
    `got ${winners}`,
  );
}

// A released key must be immediately re-claimable, or every miss waits out
// the full TTL after a successful fetch.
await guard.releaseFetch(sql, KEY);
check(
  "released claim is immediately re-claimable",
  await guard.claimFetch(sql, KEY),
);

// An expired claim must be takeable, or a function that died mid-fetch would
// block that image forever.
await sql(
  "UPDATE img_fetch_claims SET expires_at = now() - interval '1 second' WHERE cache_key = $1",
  [KEY],
);
check("expired claim can be taken over", await guard.claimFetch(sql, KEY));
await guard.releaseFetch(sql, KEY);

// --- 1c: concurrent callers cannot overspend the bucket --------------------
console.log("\ntoken bucket (1c)");
{
  const TOKENS = 5,
    CALLERS = 40;
  await sql(
    "INSERT INTO source_fetch_state (source, tokens, capacity, refill_per_sec, last_refill) " +
      "VALUES ($1, $2, 100, 0, now()) ON CONFLICT (source) DO UPDATE " +
      "SET tokens = $2, capacity = 100, refill_per_sec = 0, last_refill = now(), blocked_until = NULL",
    [SOURCE, TOKENS],
  );

  const results = await Promise.all(
    Array.from({ length: CALLERS }, () => guard.acquireFetchToken(sql, SOURCE)),
  );
  const allowed = results.filter((r) => r.allowed).length;
  check(
    `${CALLERS} concurrent acquires against ${TOKENS} tokens -> exactly ${TOKENS} allowed`,
    allowed === TOKENS,
    `got ${allowed}`,
  );

  const [{ tokens }] = await sql(
    "SELECT tokens FROM source_fetch_state WHERE source = $1",
    [SOURCE],
  );
  check("bucket never goes negative", Number(tokens) >= 0, `tokens=${tokens}`);
}

// --- refill accrues over elapsed time, without a scheduled job -------------
{
  await sql(
    "UPDATE source_fetch_state SET tokens = 0, refill_per_sec = 10, " +
      "last_refill = now() - interval '1 second' WHERE source = $1",
    [SOURCE],
  );
  const r = await guard.acquireFetchToken(sql, SOURCE);
  check(
    "one second at 10/sec refills enough to spend",
    r.allowed,
    `reason=${r.reason}`,
  );
}

// --- 1d: a cooldown blocks even a full bucket ------------------------------
console.log("\nRetry-After cooldown (1d)");
{
  await sql(
    "UPDATE source_fetch_state SET tokens = 100, refill_per_sec = 0 WHERE source = $1",
    [SOURCE],
  );
  await guard.blockSource(sql, SOURCE, 120);
  const r = await guard.acquireFetchToken(sql, SOURCE);
  check(
    "cooldown denies despite a full bucket",
    !r.allowed && r.reason === "cooldown",
    `allowed=${r.allowed} reason=${r.reason}`,
  );

  await sql(
    "UPDATE source_fetch_state SET blocked_until = now() - interval '1 second' WHERE source = $1",
    [SOURCE],
  );
  const after = await guard.acquireFetchToken(sql, SOURCE);
  check(
    "expired cooldown allows again",
    after.allowed,
    `reason=${after.reason}`,
  );
}

// --- 1a/A2: counters aggregate rather than accumulating rows ---------------
console.log("\ncounters (1a/A2)");
{
  await Promise.all(
    Array.from({ length: 25 }, () =>
      guard.bumpStat(sql, SOURCE, "display", "hits"),
    ),
  );
  const rows = await sql(
    "SELECT hits FROM img_cache_stats WHERE day = CURRENT_DATE AND source = $1 AND tier = 'display'",
    [SOURCE],
  );
  check(
    "25 concurrent bumps -> one row",
    rows.length === 1,
    `${rows.length} rows`,
  );
  check(
    "25 concurrent bumps -> count of 25, none lost",
    rows.length === 1 && Number(rows[0].hits) === 25,
    rows.length ? `hits=${rows[0].hits}` : "",
  );
}

// --- the Commons hold, expressed as data -----------------------------------
console.log("\nstanding holds");
{
  const r = await guard.acquireFetchToken(sql, "commons");
  check(
    "commons cannot acquire a token (rate-limit hold seeded as zero tokens/refill)",
    !r.allowed,
    `allowed=${r.allowed} reason=${r.reason}`,
  );
}

// --- 3a: admission control -------------------------------------------------
console.log("\nadmission control (3a)");
{
  const KEY_D = "__verify__admit:display";
  await sql("DELETE FROM img_cache_entries WHERE cache_key LIKE '__verify__%'");

  const first = await admission.noteRequest(sql, KEY_D, SOURCE, "display");
  check(
    "display: first request is NOT admitted",
    !first.admit,
    `requests=${first.requests}`,
  );
  const second = await admission.noteRequest(sql, KEY_D, SOURCE, "display");
  check(
    "display: second request IS admitted",
    second.admit,
    `requests=${second.requests}`,
  );

  const lb = await admission.noteRequest(
    sql,
    "__verify__admit:lightbox",
    SOURCE,
    "lightbox",
  );
  check("lightbox: admitted on first open", lb.admit);

  // The property a fake client can't prove: concurrent misses must not both
  // read the same count and both decline, which would leave a popular image
  // permanently un-cached.
  const KEY_C = "__verify__admit:concurrent";
  const rs = await Promise.all(
    Array.from({ length: 20 }, () =>
      admission.noteRequest(sql, KEY_C, SOURCE, "display"),
    ),
  );
  const counts = rs.map((r) => r.requests).sort((a, b) => a - b);
  const distinct = new Set(counts).size;
  check(
    "20 concurrent notes -> 20 distinct counts, none lost",
    distinct === 20 && counts[0] === 1 && counts[19] === 20,
    `distinct=${distinct} min=${counts[0]} max=${counts[19]}`,
  );
  check(
    "at least one concurrent caller was admitted",
    rs.some((r) => r.admit),
  );

  // markStored is what makes eviction able to free the bytes again.
  await admission.markStored(sql, KEY_D, 284000);
  const [row] = await sql(
    "SELECT bytes, admitted_at FROM img_cache_entries WHERE cache_key = $1",
    [KEY_D],
  );
  check(
    "markStored records the byte count",
    Number(row.bytes) === 284000,
    `bytes=${row.bytes}`,
  );

  const again = await admission.noteRequest(sql, KEY_D, SOURCE, "display");
  check(
    "a stored key is not re-admitted",
    !again.admit && again.reason === "already-stored",
    `reason=${again.reason}`,
  );

  await sql("DELETE FROM img_cache_entries WHERE cache_key LIKE '__verify__%'");
}

await cleanup();
console.log(
  `\n${failures === 0 ? "All checks passed." : `${failures} CHECK(S) FAILED.`}`,
);
process.exit(failures === 0 ? 0 : 1);
