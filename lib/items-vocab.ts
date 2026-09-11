// The search vocabulary -- what it is built from, and how it is refreshed.
// Lives outside /api/ for the usual Vercel function-cap reason.
//
// Shared rather than duplicated across callers (lib/cron/db-backup.ts
// included): a duplicated "what counts as vocabulary" definition drifts, and
// this codebase has the scar (the manifest's missing medium/tags silently
// broke those suggestion types for weeks).
//
// See sql/018_items_vocab.sql for the schema and why it's materialised
// rather than queried live.

import { LIVE_ITEMS_PREDICATE } from "./items-sql.ts";

// js/app.js's SEARCH_TYPE_RANK, as numbers. Artist beats Category beats the
// taxonomy facets beats the free-text-derived fields -- curated groupings
// first, so a query matching both an artist and a title offers the artist.
const VOCAB_RANK: Record<string, number> = {
  Artist: 0,
  Category: 1,
  Region: 2,
  Era: 3,
  Type: 4,
  Color: 5,
  Medium: 6,
  Tag: 7,
  Title: 8,
};

// Every field js/app.js's buildSearchIndex() reads, and no others. Building
// from the table rather than the manifest is what fixes the medium/tags gap
// described above.
const SCALAR_FIELDS = [
  ["Artist", "artist"],
  ["Category", "category"],
  ["Region", "region_primary"],
  ["Era", "timeframe"],
  ["Type", "media_type"],
  ["Color", "palette"],
  ["Medium", "medium"],
  ["Title", "title"],
];

// One row per (type, value) across the live catalogue. region_alt is
// unnested so a multi-region item is suggestible under either (see
// sql/006_items_region_alt.sql); tags is split the way the client splits it.
function vocabUnion(): string {
  const parts = SCALAR_FIELDS.map(
    (pair) =>
      `SELECT '${pair[0]}'::text AS type, ${pair[1]}::text AS value` +
      `  FROM items WHERE ${
        LIVE_ITEMS_PREDICATE
      }   AND ${pair[1]} IS NOT NULL AND btrim(${pair[1]}) <> ''`,
  );

  parts.push(
    `SELECT 'Region'::text, a::text FROM items, unnest(region_alt) AS a` +
      ` WHERE ${LIVE_ITEMS_PREDICATE} AND region_alt IS NOT NULL AND btrim(a) <> ''`,
  );

  parts.push(
    `SELECT 'Tag'::text, btrim(t)::text` +
      `  FROM items, unnest(string_to_array(tags, ',')) AS t` +
      ` WHERE ${LIVE_ITEMS_PREDICATE} AND tags IS NOT NULL AND btrim(t) <> ''`,
  );

  return parts.join(" UNION ALL ");
}

function rankCase(column: string): string {
  return `CASE ${column} ${Object.keys(VOCAB_RANK)
    .map((t) => `WHEN '${t}' THEN ${VOCAB_RANK[t]}`)
    .join(" ")} ELSE 99 END`;
}

// Rebuild items_vocab via UPSERT then sweep, never TRUNCATE then INSERT --
// truncate leaves a real window where the table is empty and a visitor
// typing gets no suggestions. Dedupe is by normalised key, keeping the
// best-ranked type, the same collapse buildSearchIndex() does client-side.
function refreshVocabSql(): string {
  return (
    `INSERT INTO items_vocab (key, value, type, rank, item_count, refreshed_at) ` +
    `SELECT key, ` +
    `       (array_agg(value ORDER BY rank, value))[1], ` +
    `       (array_agg(type  ORDER BY rank, value))[1], ` +
    `       min(rank)::smallint, ` +
    `       count(*)::int, ` +
    `       now() ` +
    `  FROM (SELECT type, value, ` +
    `               immutable_unaccent(lower(value)) AS key, ` +
    `               ${rankCase("type")} AS rank ` +
    `          FROM (${vocabUnion()}) raw) ranked ` +
    ` GROUP BY key ` +
    `    ON CONFLICT (key) DO UPDATE SET ` +
    `       value = EXCLUDED.value, type = EXCLUDED.type, ` +
    `       rank = EXCLUDED.rank, item_count = EXCLUDED.item_count, ` +
    `       refreshed_at = EXCLUDED.refreshed_at`
  );
}

// Words of three characters or more, from the normalised keys. Three is the
// client's own floor in SEARCH_VOCAB; below it, corrections are noise.
function refreshWordsSql(): string {
  return (
    "INSERT INTO items_vocab_words (word, refreshed_at) " +
    "SELECT DISTINCT w, now() FROM items_vocab, " +
    "     unnest(regexp_split_to_array(key, '[^a-z0-9]+')) AS w " +
    " WHERE length(w) >= 3 " +
    "    ON CONFLICT (word) DO UPDATE SET refreshed_at = EXCLUDED.refreshed_at"
  );
}

// Sweep whatever the upsert did not touch, comparing against the table's OWN
// max(refreshed_at) rather than a timestamp from the caller -- a Node-side
// `new Date().toISOString()` once emptied the table when the DB clock ran 25
// seconds behind the app's. One clock (all upserted rows share one now()
// from the same transaction) fixes it, and fails safe: if the refresh
// inserts nothing, max() is the previous run's stamp and nothing is swept.
function sweepSql(table: string): string {
  return `DELETE FROM ${
    table
  } WHERE refreshed_at < (SELECT max(refreshed_at) FROM ${table})`;
}

export {
  rankCase,
  refreshVocabSql,
  refreshWordsSql,
  SCALAR_FIELDS,
  sweepSql,
  VOCAB_RANK,
  vocabUnion,
};
