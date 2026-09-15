// The aggregate shapes (?shape=facets, ?shape=vocab) that let the browser
// stop downloading the whole catalogue -- they answer a question about the
// catalogue without shipping it, bounded by distinct values rather than
// item count.
//
// These are assertions about the SQL that gets built, since the handler
// opens a real Neon connection at module scope and this suite is offline by
// design. They guard that the aggregate stays an aggregate -- a regression
// to SELECT * would reintroduce the download while still looking correct.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as items from "../api/items.ts";
import { LIVE_ITEMS_PREDICATE } from "../lib/items-sql.ts";
import * as vocab from "../lib/items-vocab.ts";

describe("?shape=facets", () => {
  it("aggregates rather than selecting rows", () => {
    const q = items.buildQuery({ shape: "facets" });
    expect(q.text).toMatch(/GROUP BY/i);
    expect(q.text).not.toMatch(/SELECT \*/);
  });

  it("only reads the live catalogue", () => {
    const q = items.buildQuery({ shape: "facets" });
    expect(q.text).toContain(LIVE_ITEMS_PREDICATE);
  });

  it("is a complete answer in one response, with no cursor", () => {
    // An aggregate is bounded by distinct values, not by catalogue size, so
    // unlike the manifest it legitimately needs no paging.
    const q = items.buildQuery({ shape: "facets" });
    expect(q.facets).toBe(true);
    expect(q.paginated).toBeUndefined();
    expect(q.text).not.toMatch(/cursor/);
  });

  it("caps the one pool that grows with the catalogue", () => {
    // Artists are the only unbounded facet -- everything else is a small
    // fixed vocabulary.
    const q = items.buildQuery({ shape: "facets" });
    expect(q.text).toMatch(/'artist'[\s\S]*?LIMIT 50/);
  });

  it("carries the browse-hint pools with their per-type thresholds", () => {
    // The qualifying set only: artists with >= 2 items, everything else >= 10.
    const q = items.buildQuery({ shape: "facets" });
    ["artist", "region", "era", "type", "color"].forEach((pool) => {
      expect(q.text, `${pool} pool missing`).toContain(`'${pool}'`);
    });
    expect(q.text).toMatch(/HAVING count\(\*\) >= 2/);
    expect(q.text).toMatch(/HAVING count\(\*\) >= 10/);
  });

  it("unnests palette_buckets for the real color filter's counts", () => {
    // TRA-274: unlike every other pool above, palette_buckets is a TEXT[]
    // -- an item can carry several, so a straight GROUP BY on the array
    // itself would never match a single bucket name. Must unnest first.
    const q = items.buildQuery({ shape: "facets" });
    expect(q.text).toContain("'palette_bucket'");
    expect(q.text).toMatch(/unnest\(palette_buckets\)/);
  });
});

describe("?shape=facets response shape", () => {
  // Regression: the handler bucketed on `row.facet === "category" ? a : b`,
  // sweeping every other pool into `sources` -- reported 86 sources instead
  // of 5 live. Exercises the real handler's grouping via the row shape the
  // query produces, since the bug was in the mapping, not the SQL.
  function group(rows: any) {
    const POOL_NAMES: any = { category: "categories", source: "sources" };
    const out: any = { categories: [], sources: [] };
    for (const row of rows) {
      const key = POOL_NAMES[row.facet] || row.facet;
      out[key] = out[key] || [];
      out[key].push({ value: row.value, count: row.n });
    }
    out.total = out.categories.reduce((a: any, c: any) => a + c.count, 0);
    return out;
  }

  const ROWS = [
    { facet: "category", value: "Photography", n: 502 },
    { facet: "category", value: "Arms & Armor", n: 359 },
    { facet: "source", value: "met", n: 2579 },
    { facet: "source", value: "cleveland", n: 1440 },
    { facet: "artist", value: "Rembrandt", n: 7 },
    { facet: "region", value: "Europe", n: 2666 },
    { facet: "era", value: "Renaissance", n: 120 },
    { facet: "type", value: "Painting", n: 900 },
    { facet: "color", value: "Gold/Yellow", n: 283 },
  ];

  it("keeps each pool separate", () => {
    const out = group(ROWS);
    expect(out.sources).toHaveLength(2); // NOT 7
    expect(out.categories).toHaveLength(2);
    expect(out.artist).toHaveLength(1);
    expect(out.region).toHaveLength(1);
    expect(out.era).toHaveLength(1);
    expect(out.type).toHaveLength(1);
    expect(out.color).toHaveLength(1);
  });

  it("does not leak other pools into sources", () => {
    const values = group(ROWS).sources.map((s: any) => s.value);
    expect(values).toEqual(["met", "cleveland"]);
    expect(values).not.toContain("Rembrandt");
    expect(values).not.toContain("Europe");
  });

  it("totals over categories, which partition the catalogue exactly once", () => {
    // Region would over-count: region_alt can put an item in twice.
    expect(group(ROWS).total).toBe(861);
  });

  it("the handler builds the same pool names the client reads", () => {
    const src = readFileSync(
      new URL("../api/items.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("POOL_NAMES");
    expect(src).not.toMatch(/row\.facet === "category" \? byFacet/);
  });
});

describe("?shape=suggest", () => {
  it("caps the response regardless of catalogue size", () => {
    // Shipping the whole vocabulary measured 657KB at 4,502 items (near-unique
    // titles/mediums scale with the catalogue, not distinct values) -- would
    // have been ~29MB at 200k. A capped query cannot regress into that.
    const q = items.buildQuery({ shape: "suggest", q: "por" });
    expect(q.text).toMatch(/LIMIT 8\b/);
  });

  it("reads the materialised table, never the catalogue", () => {
    // Querying `items` directly measured ~300ms per keystroke on 4,502 rows,
    // degrading linearly -- a 200k problem wearing a 4.5k disguise.
    const q = items.buildQuery({ shape: "suggest", q: "por" });
    expect(q.text).toMatch(/FROM items_vocab\b/);
    expect(q.text).not.toMatch(/FROM items\b/);
  });

  it("orders the way getSearchSuggestions() does", () => {
    // Type rank first, then item count descending, matching the client's sort.
    const q = items.buildQuery({ shape: "suggest", q: "por" });
    expect(q.text).toMatch(/ORDER BY rank ASC, item_count DESC/);
  });

  it("answers below the minimum length without querying at all", () => {
    // Fires on every keystroke, so under 2 characters must not reach Postgres.
    const q = items.buildQuery({ shape: "suggest", q: "p" });
    expect(q.empty).toBe(true);
    expect(q.text).toBe(null);
  });
});

describe("vocabulary refresh (lib/items-vocab.js)", () => {
  it("covers every field the client's buildSearchIndex() reads", () => {
    // The nine SEARCH_TYPE_RANK types; missing one silently removes a whole
    // class of suggestion from the autocomplete.
    const sql = vocab.refreshVocabSql();
    [
      "artist",
      "category",
      "region_primary",
      "region_alt",
      "timeframe",
      "media_type",
      "palette",
      "medium",
      "tags",
      "title",
    ].forEach((col) => {
      expect(sql, `${col} missing from the vocabulary union`).toContain(col);
    });
  });

  it("includes medium and tags, which the MANIFEST never carried", () => {
    // The manifest serializes neither, so Medium/Tag suggestions were
    // silently absent before this.
    const sql = vocab.refreshVocabSql();
    expect(sql).toContain("medium");
    expect(sql).toContain("tags");
  });

  it("only reads the live catalogue", () => {
    expect(vocab.refreshVocabSql()).toContain(LIVE_ITEMS_PREDICATE);
  });

  it("upserts rather than replacing, so the table is never empty", () => {
    // TRUNCATE-then-INSERT leaves a window with no suggestions and no error.
    const sql = vocab.refreshVocabSql();
    expect(sql).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(sql).not.toMatch(/TRUNCATE|DELETE FROM items_vocab/);
  });

  it("sweeps against the database's own clock, never the caller's", () => {
    // Passing Node's own now() as the cutoff once deleted a fresh refresh
    // outright, because the Neon clock was 25s behind -- comparing the table
    // against its own max keeps it to one clock.
    const sql = vocab.sweepSql("items_vocab");
    expect(sql).toMatch(/SELECT max\(refreshed_at\) FROM items_vocab/);
    expect(sql).not.toMatch(/\$\d/);
  });

  it("builds words from the vocabulary, not from a second union", () => {
    expect(vocab.refreshWordsSql()).toMatch(/FROM items_vocab\b/);
  });
});

describe("?shape=correction", () => {
  it("returns candidates for the client to score, not a verdict", () => {
    // fuzzystrmatch's levenshtein() is not installed on this database;
    // pg_trgm's similarity() is a different measure, so the server narrows
    // the field and the client's findDidYouMean() still makes the call.
    const q = items.buildQuery({ shape: "correction", q: "cezane" });
    expect(q.correction).toBe(true);
    expect(q.text).toMatch(/similarity\(/);
    expect(q.text).toMatch(/LIMIT 25/);
  });
});

describe("facet whitelist", () => {
  it("accepts subject_type, which the one rule shelf filters on", () => {
    // Without it in the whitelist that shelf can't resolve server-side; a
    // typo'd facet is a 400 rather than a silently empty shelf.
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
      subject_type: "portrait",
    });
    expect(q.text).toMatch(/subject_type = \$\d+/);
    expect(q.params).toContain("portrait");
  });

  it("still rejects a column that is not a facet", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
      credit: "anything",
    });
    expect(q.text).not.toMatch(/credit/);
  });

  it("palette_bucket filters by containment, not equality -- an item can carry several", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
      palette_bucket: "Blue",
    });
    expect(q.text).toMatch(/palette_buckets @> ARRAY\[\$\d+\]::text\[\]/);
    expect(q.params).toContain("Blue");
  });

  it("resolves the rule shelf's three filters together", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
      category: "Paintings & Portraits",
      region_primary: "Europe",
      subject_type: "portrait",
    });
    expect(q.text).toMatch(/category = \$\d+/);
    expect(q.text).toMatch(/subject_type = \$\d+/);
    // region_primary must still match the alternates, or a shelf loses
    // items that genuinely span regions.
    expect(q.text).toMatch(/region_alt @> ARRAY/);
  });
});
