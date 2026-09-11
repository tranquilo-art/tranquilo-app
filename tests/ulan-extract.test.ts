// Extracting artist identity from Getty ULAN, which knows that "Rembrandt
// van Rijn", "Rijn, Rembrandt van" and "Rembrandt" are one person -- our
// catalogue splits that artist across spellings, defeating the artist
// facet, the Tea Voice worklist and the feed's own de-clustering. The dump
// is 190 MB and not committed; what ships is the derived subset.
//
// Matching is where this goes wrong: a crude normaliser can merge distinct
// artists that happen to share tokens (it already did once, merging Dai
// Jin, Ma Lin and Lü Ji by dropping short words).
import { describe, expect, it } from "vitest";
import * as ulan from "../lib/ulan-extract.ts";

describe("parsing a TERM row", () => {
  // Tab-delimited, 13 columns, no header. Subject id is column 10, term text
  // 11, and column 3 flags the preferred form.
  const row =
    "NA\t\tY\t2\t\tNA\tNA\tV\t\t500011051\tRembrandt van Rijn\t1500000418\tV";

  it("reads the subject id and the term", () => {
    const t = ulan.parseTermRow(row);
    expect(t.subjectId).toBe("500011051");
    expect(t.term).toBe("Rembrandt van Rijn");
  });

  it("recognises the preferred form", () => {
    expect(ulan.parseTermRow(row).preferred).toBe(true);
    expect(ulan.parseTermRow(row.replace("\tY\t", "\tNA\t")).preferred).toBe(
      false,
    );
  });

  it("ignores a malformed line rather than throwing", () => {
    expect(ulan.parseTermRow("")).toBeNull();
    expect(ulan.parseTermRow("not\ttab\tdelimited")).toBeNull();
  });
});

describe("normalising a name for matching", () => {
  it("ignores case and accents", () => {
    expect(ulan.normalise("Albrecht Dürer")).toBe(
      ulan.normalise("ALBRECHT DURER"),
    );
  });

  it("ignores punctuation and spacing", () => {
    expect(ulan.normalise("Rijn, Rembrandt van")).toBe(
      ulan.normalise("Rijn Rembrandt van"),
    );
  });

  it("strips a trailing parenthetical", () => {
    expect(ulan.normalise("Rembrandt (Rembrandt van Rijn)")).toBe(
      ulan.normalise("Rembrandt"),
    );
  });

  it("does NOT reorder words", () => {
    // Sorting tokens makes "Dai Jin", "Ma Lin" and "Lü Ji" collide into one
    // artist.
    expect(ulan.normalise("Dai Jin")).not.toBe(ulan.normalise("Jin Dai"));
    expect(ulan.normalise("Ma Lin")).not.toBe(ulan.normalise("Lin Ma"));
  });

  it("does not drop short words", () => {
    expect(ulan.normalise("Li Tang")).not.toBe(ulan.normalise("Tang Yin"));
  });
});

describe("matching our artists to ULAN subjects", () => {
  const terms = [
    { subjectId: "500011051", term: "Rembrandt van Rijn", preferred: true },
    { subjectId: "500011051", term: "Rijn, Rembrandt van", preferred: false },
    { subjectId: "500011051", term: "Rembrandt", preferred: false },
    { subjectId: "500115493", term: "Degas, Edgar", preferred: false },
    { subjectId: "500115493", term: "Edgar Degas", preferred: true },
    { subjectId: "500999999", term: "Rembrandt", preferred: true }, // a different Rembrandt
  ];

  it("finds the subject for a name written any of its ways", () => {
    const idx = ulan.buildIndex(
      terms.filter((t) => t.subjectId !== "500999999"),
    );
    expect(ulan.lookup(idx, "Rembrandt van Rijn").subjectId).toBe("500011051");
    expect(ulan.lookup(idx, "Rijn, Rembrandt van").subjectId).toBe("500011051");
  });

  it("groups our spellings under one subject", () => {
    const idx = ulan.buildIndex(
      terms.filter((t) => t.subjectId !== "500999999"),
    );
    const groups = ulan.groupBySubject(idx, [
      "Rembrandt van Rijn",
      "Rijn, Rembrandt van",
      "Edgar Degas",
    ]);
    const rembrandt = groups.find((g: any) => g.subjectId === "500011051");
    expect(rembrandt.ourNames.sort()).toEqual([
      "Rembrandt van Rijn",
      "Rijn, Rembrandt van",
    ]);
  });

  it("reports the preferred form as the canonical name", () => {
    const idx = ulan.buildIndex(
      terms.filter((t) => t.subjectId !== "500999999"),
    );
    expect(ulan.lookup(idx, "Rijn, Rembrandt van").preferredName).toBe(
      "Rembrandt van Rijn",
    );
  });

  it("refuses to choose when a name matches two subjects", () => {
    // Picking one silently is how a merge fuses two artists into one.
    const idx = ulan.buildIndex(terms);
    const hit = ulan.lookup(idx, "Rembrandt");
    expect(hit.ambiguous).toBe(true);
    expect(hit.subjectIds).toHaveLength(2);
    expect(hit.subjectId).toBeUndefined();
  });

  it("returns nothing for a name ULAN does not have", () => {
    const idx = ulan.buildIndex(terms);
    expect(ulan.lookup(idx, "Nobody At All")).toBeNull();
  });

  it("does not propose a group of one", () => {
    // A "merge" of a single spelling isn't a merge; emitting it would bury
    // the real merges in noise.
    const idx = ulan.buildIndex(
      terms.filter((t) => t.subjectId !== "500999999"),
    );
    const groups = ulan.groupBySubject(idx, ["Edgar Degas"]);
    expect(groups.filter((g: any) => g.ourNames.length > 1)).toHaveLength(0);
  });
});
