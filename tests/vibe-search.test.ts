// ?shape=vibe_search -- a bounded, RANKED result set for
// a "moody paintings" style query, distinct from every other filter
// (including palette_bucket), which rides the infinite shuffle-cursor
// feed. These are assertions about the SQL buildQuery() produces, same
// scope as catalogue-aggregates.test.ts's own tests -- the handler opens
// a real Neon connection at module scope, so this suite is offline by
// design.
import { describe, expect, it } from "vitest";
import * as items from "../api/items.ts";
import { LIVE_ITEMS_PREDICATE } from "../lib/items-sql.ts";

describe("?shape=vibe_search", () => {
  it("requires vibe_tags_any", () => {
    expect(() => items.buildQuery({ shape: "vibe_search" })).toThrow();
  });

  it("rejects an empty vibe_tags_any the same as a missing one", () => {
    expect(() =>
      items.buildQuery({ shape: "vibe_search", vibe_tags_any: "" }),
    ).toThrow();
  });

  it("splits a comma-joined tag list", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Melancholic,Chiaroscuro,Nocturnal",
    });
    expect(q.params[0]).toEqual(["Melancholic", "Chiaroscuro", "Nocturnal"]);
  });

  it("trims whitespace and drops empty entries from the tag list", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: " Melancholic , , Nocturnal ",
    });
    expect(q.params[0]).toEqual(["Melancholic", "Nocturnal"]);
  });

  it("filters by array OVERLAP, not containment -- any one matching tag is enough", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    expect(q.text).toMatch(/vibe_tags && \$1::text\[\]/);
    expect(q.text).not.toContain("@>");
  });

  it("only reads the live catalogue", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    expect(q.text).toContain(LIVE_ITEMS_PREDICATE);
  });

  it("ranks curator_boost first, then harmony+contrast as a tie-break", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    const order = q.text.slice(q.text.indexOf("ORDER BY"));
    expect(order.indexOf("curator_boost")).toBeLessThan(
      order.indexOf("palette_contrast_score"),
    );
    expect(order).toMatch(/curator_boost.*DESC/);
  });

  it("derives harmony inline from palette_buckets rather than a stored column", () => {
    // Deliberate: harmony is a cheap function of an already-stored
    // array's length, computed only over an already-filtered, bounded
    // candidate set -- not the per-catalogue dynamic sort this repo's
    // shuffle_key architecture exists to avoid.
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    expect(q.text).toMatch(/array_length\(palette_buckets, ?1\)/);
  });

  it("is bounded, not paginated -- no cursor, a capped LIMIT", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    expect(q.vibeSearch).toBe(true);
    expect(q.paginated).toBeUndefined();
    expect(q.text).not.toMatch(/cursor/);
    expect(q.text).toMatch(/LIMIT 60/); // the default
  });

  it("honors a custom limit, capped at the maximum", () => {
    const small = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
      limit: "10",
    });
    expect(small.text).toMatch(/LIMIT 10/);

    const tooBig = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
      limit: "999",
    });
    expect(tooBig.text).toMatch(/LIMIT 100/);
  });

  it("selects full rows, not a lean manifest -- this is a small, complete response", () => {
    const q = items.buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "Serene",
    });
    expect(q.text).toMatch(/SELECT \*/);
  });
});
