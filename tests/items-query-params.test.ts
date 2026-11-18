// Vercel parses a repeated query param (?q=a&q=b) into an array. Only ?ids=
// is meant to repeat; every other param takes its first value, the same rule
// lib/request-origin.ts applies to repeated headers.
import { describe, expect, it } from "vitest";
import { buildQuery } from "../api/items.ts";

const MANIFEST_PAGE = { shape: "manifest", order: "shuffle", start: "0" };

describe("buildQuery with repeated scalar params", () => {
  it("searches on the first ?q= instead of throwing", () => {
    const q = buildQuery({ ...MANIFEST_PAGE, q: ["monet", "degas"] });
    expect(q.params).toContain("monet");
    expect(q.params).not.toContain("degas");
  });

  it("filters a facet on its first value, never on the array", () => {
    const q = buildQuery({ ...MANIFEST_PAGE, category: ["Painting", "Print"] });
    expect(q.params).toContain("Painting");
    expect(q.params.some((p) => Array.isArray(p))).toBe(false);
  });

  it("dispatches on the first ?shape=", () => {
    expect(buildQuery({ shape: ["facets", "count"] }).facets).toBe(true);
  });

  it("suggests from the first ?q=", () => {
    const q = buildQuery({ shape: "suggest", q: ["pai", "x"] });
    expect(q.params).toEqual(["pai"]);
  });

  it("still accepts ?ids= as a repeated list", () => {
    const q = buildQuery({ ids: ["a", "b"] });
    expect(q.params[0]).toEqual(["a", "b"]);
  });
});

describe("buildQuery limit clamping", () => {
  const limitOf = (limit: string) =>
    buildQuery({ ...MANIFEST_PAGE, limit }).params.at(-1);

  it.each(["-1", "-500", "0", "abc", ""])(
    "never yields a non-positive LIMIT for ?limit=%s",
    (limit) => {
      expect(limitOf(limit)).toBeGreaterThanOrEqual(1);
    },
  );

  it("caps an oversized limit at the maximum", () => {
    expect(limitOf("999999")).toBe(200);
  });

  it("passes an in-range limit through", () => {
    expect(limitOf("25")).toBe(25);
  });

  it("clamps vibe_search limits to the same floor", () => {
    const q = buildQuery({
      shape: "vibe_search",
      vibe_tags_any: "calm",
      limit: "-1",
    });
    expect(q.text).toContain("LIMIT 1");
  });
});
