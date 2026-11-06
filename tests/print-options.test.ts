import { describe, expect, it } from "vitest";
import {
  importTaxApplies,
  printLinkEnabled,
  printOptionsFor,
} from "../src/logic/printOptions";

const sized = (w: number, h: number) => ({
  master_width: w,
  master_height: h,
  license: "cc0" as string | null,
  source: "met",
});

describe("which print products an artwork qualifies for", () => {
  it("offers every product when the master image is large enough", () => {
    expect(printOptionsFor(sized(3192, 4000), "uk")).toEqual([
      "mini_print",
      "poster",
      "framed",
      "tote",
    ]);
  });

  it("offers the mini print everywhere except Brazil", () => {
    for (const region of ["us", "ca", "eu", "uk", "au"]) {
      expect(printOptionsFor(sized(3192, 4000), region)).toContain(
        "mini_print",
      );
    }
    expect(printOptionsFor(sized(3192, 4000), "br")).not.toContain(
      "mini_print",
    );
  });

  it("judges by the short edge, whatever the orientation", () => {
    expect(printOptionsFor(sized(4000, 2000), "eu")).toEqual(
      printOptionsFor(sized(2000, 4000), "eu"),
    );
  });

  it("drops products the image is too small for", () => {
    expect(printOptionsFor(sized(2000, 4000), "uk")).toEqual([
      "mini_print",
      "tote",
    ]);
    expect(printOptionsFor(sized(1600, 4000), "uk")).toEqual(["mini_print"]);
    expect(printOptionsFor(sized(1000, 4000), "uk")).toEqual([]);
    expect(printOptionsFor(sized(2000, 4000), "us")).toEqual([
      "mini_print",
      "tote",
    ]);
  });

  it("offers nothing outside a print region", () => {
    expect(printOptionsFor(sized(3192, 4000), null)).toEqual([]);
    expect(printOptionsFor(sized(3192, 4000), "nowhere")).toEqual([]);
  });

  it("offers nothing when the master size is unknown", () => {
    expect(printOptionsFor({}, "us")).toEqual([]);
    expect(
      printOptionsFor({ master_width: null, master_height: 4000 }, "us"),
    ).toEqual([]);
  });
});

describe("whether the print link is shown at all", () => {
  it("stays off by default", () => {
    expect(printLinkEnabled("")).toBe(false);
    expect(printLinkEnabled("?print=1")).toBe(false);
  });

  it("turns on for a preview URL", () => {
    expect(printLinkEnabled("?print=preview")).toBe(true);
    expect(printLinkEnabled("?a=b&print=preview")).toBe(true);
  });
});

describe("Brazil", () => {
  it("offers a mug and a poster", () => {
    expect(printOptionsFor(sized(3192, 4000), "br")).toEqual(["mug", "poster"]);
  });

  it("offers the mug alone from a smaller image", () => {
    expect(printOptionsFor(sized(2000, 4000), "br")).toEqual(["mug"]);
  });

  it("still needs a large enough master image", () => {
    expect(printOptionsFor(sized(1000, 4000), "br")).toEqual([]);
  });
});

describe("which regions leave the buyer to pay import taxes", () => {
  it("is Brazil only", () => {
    expect(importTaxApplies("br")).toBe(true);
    for (const region of ["us", "ca", "eu", "uk", "au", null]) {
      expect(importTaxApplies(region)).toBe(false);
    }
  });
});

describe("which artworks may be sold as prints", () => {
  const big = sized(3192, 4000);

  it("accepts public-domain dedications", () => {
    for (const license of [
      "cc0",
      "public-domain",
      "public-domain-mark",
      "public-domain-ibram",
    ]) {
      expect(printOptionsFor({ ...big, license }, "us")).not.toEqual([]);
    }
  });

  it("rejects licences that need attribution or are not a grant", () => {
    for (const license of [
      "cc-by",
      "cc-by-3.0",
      "cc-by-4.0",
      "open-government-data-license-1.0",
      "no-known-copyright-restrictions",
    ]) {
      expect(printOptionsFor({ ...big, license }, "us")).toEqual([]);
    }
  });

  it("rejects an artwork with no recorded licence", () => {
    expect(printOptionsFor({ ...big, license: null }, "us")).toEqual([]);
    expect(printOptionsFor({ ...big, license: undefined }, "us")).toEqual([]);
  });

  it("rejects excluded sources whatever their licence says", () => {
    for (const source of ["tepapa", "npm"]) {
      expect(printOptionsFor({ ...big, source }, "us")).toEqual([]);
      expect(printOptionsFor({ ...big, source }, "br")).toEqual([]);
    }
  });
});
