// The intro slide's "10k+ public domain works" uses a rounded marker
// rather than an exact count, which gets hard to scan as it grows. The
// rule that matters is that it rounds down: at 9,914 live items, "10k+"
// would claim a thousand works we don't have, on the one slide every
// visitor reads -- so it floors to "9k+" and only becomes "10k+" the day
// the count actually crosses 10,000.
import { describe, expect, it } from "vitest";
import { roundedWorkCount } from "../src/logic/logic";

describe("roundedWorkCount", () => {
  it("never rounds up -- 9,914 is 9k, not 10k", () => {
    expect(roundedWorkCount(9914)).toBe("9k+");
  });

  it("only says 10k+ once we actually have 10,000", () => {
    expect(roundedWorkCount(9999)).toBe("9k+");
    expect(roundedWorkCount(10000)).toBe("10k+");
    expect(roundedWorkCount(11401)).toBe("11k+");
  });

  it("shows an exact count below 1,000, where rounding would lose more than it saves", () => {
    expect(roundedWorkCount(847)).toBe("847");
    expect(roundedWorkCount(999)).toBe("999");
    expect(roundedWorkCount(1)).toBe("1");
  });

  it("switches to markers at exactly 1,000", () => {
    expect(roundedWorkCount(1000)).toBe("1k+");
    expect(roundedWorkCount(1999)).toBe("1k+");
  });

  it("handles a missing or zero count without printing rubbish", () => {
    // The intro renders before facets resolve on a cold load, so
    // 0/undefined is a real state, not a hypothetical.
    expect(roundedWorkCount(0)).toBe("0");
    expect(roundedWorkCount(undefined)).toBe("0");
    expect(roundedWorkCount(null)).toBe("0");
  });

  it("ignores a fractional or negative count rather than rendering it", () => {
    expect(roundedWorkCount(-5)).toBe("0");
    expect(roundedWorkCount(1500.7)).toBe("1k+");
  });

  it("scales past 100k without changing shape", () => {
    expect(roundedWorkCount(100000)).toBe("100k+");
    expect(roundedWorkCount(250999)).toBe("250k+");
  });
});
