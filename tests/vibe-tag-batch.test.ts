// Pre-flight checks and apply-planning for a vibe-tag
// batch. Errors are factual and block (an id that doesn't resolve, a tag
// outside the closed vocabulary); warnings inform a human reviewer but
// don't block.
import { describe, expect, it } from "vitest";
import {
  checkCandidate,
  findDuplicateIds,
  planApply,
  VOCABULARY,
} from "../lib/vibe-tag-batch.ts";

const liveItem = { id: "met:1", review_status: "ok", vibe_tags: null };

describe("findDuplicateIds", () => {
  it("finds no duplicates in a clean batch", () => {
    const dupes = findDuplicateIds([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(dupes.size).toBe(0);
  });

  it("finds the duplicated id, not just that one exists", () => {
    const dupes = findDuplicateIds([{ id: "a" }, { id: "b" }, { id: "a" }]);
    expect(dupes).toEqual(new Set(["a"]));
  });
});

describe("checkCandidate", () => {
  it("passes a fully valid candidate with no findings", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: "Serene", secondary_vibes: ["Misty"] },
      liveItem,
      false,
    );
    expect(findings).toEqual([]);
  });

  it("passes a valid null-vibe candidate (nothing clearly applies)", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: null, secondary_vibes: [] },
      liveItem,
      false,
    );
    expect(findings).toEqual([]);
  });

  it("errors when the id doesn't resolve to any item, and stops there", () => {
    const findings = checkCandidate(
      { id: "met:999", primary_vibe: "Serene" },
      undefined,
      false,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      level: "error",
      message: "no such item in the catalogue",
    });
  });

  it.each(["quarantined", "rejected", "delisted"])(
    "errors when the item is %s",
    (status) => {
      const findings = checkCandidate(
        { id: "met:1", primary_vibe: "Serene" },
        { ...liveItem, review_status: status },
        false,
      );
      expect(
        findings.some((f) => f.level === "error" && f.message.includes(status)),
      ).toBe(true);
    },
  );

  it("errors on a duplicate id within the batch", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: "Serene" },
      liveItem,
      true,
    );
    expect(findings.some((f) => f.message.includes("duplicate"))).toBe(true);
  });

  it("errors when primary_vibe is outside the closed vocabulary", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: "MadeUpTag" },
      liveItem,
      false,
    );
    expect(
      findings.some(
        (f) => f.level === "error" && f.message.includes("MadeUpTag"),
      ),
    ).toBe(true);
  });

  it("errors when a secondary vibe is outside the closed vocabulary", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: "Serene", secondary_vibes: ["Invented"] },
      liveItem,
      false,
    );
    expect(
      findings.some(
        (f) => f.level === "error" && f.message.includes("Invented"),
      ),
    ).toBe(true);
  });

  it("warns (does not error) on a null primary with non-empty secondaries", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: null, secondary_vibes: ["Serene"] },
      liveItem,
      false,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warning");
  });

  it("warns (does not error) when the item already has vibe_tags", () => {
    const findings = checkCandidate(
      { id: "met:1", primary_vibe: "Serene" },
      { ...liveItem, vibe_tags: ["Nocturnal"] },
      false,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warning");
    expect(findings[0].message).toContain("Nocturnal");
  });

  it("every real vocabulary tag passes as a primary with no error", () => {
    for (const tag of VOCABULARY) {
      const findings = checkCandidate(
        { id: "met:1", primary_vibe: tag },
        liveItem,
        false,
      );
      expect(findings.filter((f) => f.level === "error")).toEqual([]);
    }
  });
});

describe("planApply", () => {
  const byId = new Map([["met:1", liveItem]]);

  it("a real primary_vibe becomes vibeTags with primary first, then secondaries", () => {
    const { plan, problems } = planApply(
      [
        {
          id: "met:1",
          primary_vibe: "Nocturnal",
          secondary_vibes: ["Melancholic"],
        },
      ],
      byId,
    );
    expect(problems).toEqual([]);
    expect(plan[0].vibeTags).toEqual(["Nocturnal", "Melancholic"]);
  });

  it("a null primary_vibe plans an empty array, not null -- marks 'reviewed, no vibe'", () => {
    // Distinct from never-classified (NULL): without this, a future
    // mining run (WHERE vibe_tags IS NULL) would re-select and re-pay to
    // reclassify the same item.
    const { plan } = planApply([{ id: "met:1", primary_vibe: null }], byId);
    expect(plan[0].vibeTags).toEqual([]);
  });

  it("carries the item's previous vibe_tags value through for the audit", () => {
    const withExisting = new Map([
      ["met:1", { ...liveItem, vibe_tags: ["Serene"] }],
    ]);
    const { plan } = planApply(
      [{ id: "met:1", primary_vibe: "Nocturnal" }],
      withExisting,
    );
    expect(plan[0].previous).toEqual(["Serene"]);
  });

  it("refuses the whole batch when any id doesn't resolve", () => {
    const { plan, problems } = planApply(
      [
        { id: "met:1", primary_vibe: "Serene" },
        { id: "met:999", primary_vibe: "Serene" },
      ],
      byId,
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes("met:999"))).toBe(true);
    // The plan is still constructed (so a caller could inspect it), but
    // the problems list is what actually gates the write.
    expect(plan).toHaveLength(2);
  });

  it("refuses the whole batch on a tag outside the vocabulary", () => {
    const { problems } = planApply(
      [{ id: "met:1", primary_vibe: "NotReal" }],
      byId,
    );
    expect(problems.some((p) => p.includes("NotReal"))).toBe(true);
  });

  it("refuses the whole batch on a duplicate id", () => {
    const { problems } = planApply(
      [
        { id: "met:1", primary_vibe: "Serene" },
        { id: "met:1", primary_vibe: "Nocturnal" },
      ],
      byId,
    );
    expect(problems.some((p) => p.includes("duplicate"))).toBe(true);
  });

  it("refuses the whole batch when an item is quarantined/rejected/delisted", () => {
    const quarantined = new Map([
      ["met:1", { ...liveItem, review_status: "quarantined" }],
    ]);
    const { problems } = planApply(
      [{ id: "met:1", primary_vibe: "Serene" }],
      quarantined,
    );
    expect(problems.some((p) => p.includes("quarantined"))).toBe(true);
  });

  it("a clean batch has zero problems", () => {
    const { problems } = planApply(
      [{ id: "met:1", primary_vibe: "Serene", secondary_vibes: ["Misty"] }],
      byId,
    );
    expect(problems).toEqual([]);
  });
});
