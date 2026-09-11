// Regression coverage for logic.ts, written against its actual current
// behavior rather than idealized behavior -- catching regressions against
// what's shipped today, not relitigating design decisions here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { describe, expect, it } from "vitest";
import {
  computeCentury,
  contrastRatio,
  declusterOrder,
  deriveTint,
  findDidYouMean,
  foldDiacritics,
  hexToRgb,
  hslToRgb,
  IMAGE_FAILURE_REPORT_CAP,
  isRealArtist,
  levenshtein,
  matchConcept,
  matchesQuery,
  matchesTimeframe,
  normalizeForSearch,
  recycleDelta,
  recycleWindowFor,
  relativeLuminance,
  rgbToHsl,
  shelfRenderLimit,
  shouldLogFailure,
  shouldSkipAutomaticLoad,
  shuffled,
  TEXT_RGB,
  UNKNOWN_ARTIST_PREFIXES as TranquiloLogicPrefixes,
} from "../src/logic/logic";

function parseRgbString(s: string): [number, number, number] {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s);
  return [parseInt(m![1], 10), parseInt(m![2], 10), parseInt(m![3], 10)];
}

describe("shuffled", () => {
  it("returns a permutation of the input (same elements, not the same array instance) without mutating the original", () => {
    const original = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const originalCopy = original.slice();
    const result = shuffled(original);
    expect(result).not.toBe(original);
    expect(original).toEqual(originalCopy); // not mutated
    expect(result.length).toBe(original.length);
    expect(result.slice().sort((a: any, b: any) => a.id - b.id)).toEqual(
      original,
    );
  });
});

describe("declusterOrder", () => {
  it("leaves no two consecutive items sharing a real artist", () => {
    // Fixed input, not random: declusterOrder's single-pass greedy
    // algorithm only guarantees a fix where a valid swap target exists at
    // each step, and a random shuffle of a small skewed pool can flake here.
    const pool: any = [
      { id: 1, artist: "Artist A" },
      { id: 2, artist: "Artist A" },
      { id: 3, artist: "Artist B" },
      { id: 4, artist: "Artist C" },
      { id: 5, artist: "Artist D" },
      { id: 6, artist: "Artist A" },
      { id: 7, artist: "Artist A" },
      { id: 8, artist: "Artist E" },
      { id: 9, artist: "Artist A" },
      { id: 10, artist: "Artist F" },
    ];
    const result = declusterOrder(pool, false);
    for (let j = 1; j < result.length; j++) {
      if (isRealArtist(result[j - 1].artist)) {
        expect(result[j].artist).not.toBe(result[j - 1].artist);
      }
    }
  });

  it("does not treat two adjacent Unknown-artist items as a violation", () => {
    const arr = [
      { id: 1, artist: "Unknown", category: "X" },
      { id: 2, artist: "Unknown", category: "Y" },
    ];
    const result = declusterOrder(arr, false);
    expect(result.map((i: any) => i.id)).toEqual([1, 2]);
  });

  it("with checkCategory true, leaves no two consecutive items sharing a category either", () => {
    // Fixed input chosen so a clean swap is always available -- the
    // category constraint is documented as best-effort, not a hard
    // guarantee (see the "no clean swap found" test below).
    const pool = [
      { id: 1, artist: "Artist 1", category: "A" },
      { id: 2, artist: "Artist 2", category: "A" },
      { id: 3, artist: "Artist 3", category: "B" },
      { id: 4, artist: "Artist 4", category: "C" },
      { id: 5, artist: "Artist 5", category: "D" },
      { id: 6, artist: "Artist 6", category: "B" },
      { id: 7, artist: "Artist 7", category: "B" },
      { id: 8, artist: "Artist 8", category: "E" },
    ];
    const result = declusterOrder(pool, true);
    for (let j = 1; j < result.length; j++) {
      expect(result[j].category).not.toBe(result[j - 1].category);
    }
  });

  it("falls back gracefully (no throw, array intact) when no clean swap exists", () => {
    const pool = [
      { id: 1, artist: "Same Artist", category: "Same Cat" },
      { id: 2, artist: "Same Artist", category: "Same Cat" },
    ];
    let result: any;
    expect(() => {
      result = declusterOrder(pool, true);
    }).not.toThrow();
    expect(result.map((i: any) => i.id).sort()).toEqual([1, 2]);
  });
});

describe("matchesQuery", () => {
  const item: any = {
    title: "Self-Portrait",
    artist: "Paul Cézanne",
    category: "Faces & Portraits",
    medium: "Oil on canvas",
    tags: "Men, Self-portraits",
    date: "1889",
    bio: "French, 1839-1906",
    region_primary: "Europe",
    timeframe: "19th Century",
    media_type: "Painting",
    palette: "Orange",
    _century: 19,
  };

  it("matches on title/artist/category/medium/tags/date/bio substrings", () => {
    expect(matchesQuery(item, "self-portrait")).toBe(true);
    expect(matchesQuery(item, "cezanne")).toBe(true); // diacritic-insensitive
    expect(matchesQuery(item, "Faces")).toBe(true); // case-insensitive
    expect(matchesQuery(item, "canvas")).toBe(true);
    expect(matchesQuery(item, "self-portraits")).toBe(true); // tags
    expect(matchesQuery(item, "1889")).toBe(true);
    expect(matchesQuery(item, "1839")).toBe(true); // bio
  });

  it("matches on the four taxonomy facet fields (region_primary/timeframe/media_type/palette)", () => {
    expect(matchesQuery(item, "europe")).toBe(true);
    expect(matchesQuery(item, "19th century")).toBe(true);
    expect(matchesQuery(item, "painting")).toBe(true);
    expect(matchesQuery(item, "orange")).toBe(true);
  });

  it("a facet value of null contributes no match for that field", () => {
    const noFacets: any = {
      title: "Untitled",
      region_primary: null,
      timeframe: null,
      media_type: null,
      palette: null,
    };
    expect(matchesQuery(noFacets, "europe")).toBe(false);
  });

  it("is diacritic-insensitive via a plain unaccented query", () => {
    expect(matchesQuery({ artist: "Cézanne" } as any, "cezanne")).toBe(true);
  });

  it("empty query matches everything", () => {
    expect(matchesQuery(item, "")).toBe(true);
    expect(matchesQuery(item, "   ")).toBe(true);
  });

  it("a query matching nothing returns false", () => {
    expect(matchesQuery(item, "zzznotfound")).toBe(false);
  });
});

describe("computeCentury / matchesTimeframe", () => {
  it("reads an explicit '17th century' phrase from date/bio", () => {
    expect(computeCentury({ date: "", bio: "French, 17th century" })).toBe(17);
  });

  it("derives century from a bare 4-digit year via ceiling division", () => {
    expect(computeCentury({ date: "ca. 1620-21", bio: "" })).toBe(17);
    expect(computeCentury({ date: "1799", bio: "" })).toBe(18);
    expect(computeCentury({ date: "1800", bio: "" })).toBe(18);
  });

  it("returns null for unparseable date/bio text", () => {
    expect(computeCentury({ date: "unknown", bio: "" })).toBe(null);
  });

  it("never returns a value outside a plausible historical range (1-21), even for raw BCE years", () => {
    // The \d{3,4}-year fallback has no BCE/CE awareness -- a raw BCE year
    // like "2300-2000 BCE" would otherwise divide into a nonsense century (23).
    expect(
      computeCentury({
        date: "ca. 2300-2000 BCE",
        bio: "Mesopotamia, Akkadian period (ca. 2300-2000 BCE)",
      }),
    ).toBe(null);
    expect(
      computeCentury({
        date: "2800-2700 BCE",
        bio: "Cycladic, Early Cycladic I-II (2800-2700 BCE)",
      }),
    ).toBe(null);
    expect(
      computeCentury({
        date: "ca. 2446-2389 BCE",
        bio: "Egypt, Old Kingdom, Dynasty 5 (ca. 2446-2389 BCE)",
      }),
    ).toBe(null);
    expect(computeCentury({ date: "100", bio: "" })).toBe(1);
    expect(computeCentury({ date: "2050", bio: "" })).toBe(21);
  });

  it("an explicit 'Nth century' phrase that's actually BCE doesn't get read as the CE century", () => {
    // "13th century BCE" once parsed as century 13 (Medieval) since this
    // branch had no BCE awareness at all, and 13 looks like a plausible CE century.
    expect(computeCentury({ date: "13th century BCE", bio: "" })).toBe(null);
    expect(computeCentury({ date: "5th century B.C.", bio: "" })).toBe(null);
    expect(computeCentury({ date: "13th century", bio: "" })).toBe(13);
  });

  it("matchesTimeframe('ancient', century) is true only for century <= 10", () => {
    expect(matchesTimeframe("ancient", 10)).toBe(true);
    expect(matchesTimeframe("ancient", 1)).toBe(true);
    expect(matchesTimeframe("ancient", 11)).toBe(false);
  });

  it("matchesTimeframe matches an explicit 'Nth century' query against the right century", () => {
    expect(matchesTimeframe("17th century", 17)).toBe(true);
    expect(matchesTimeframe("17th century", 18)).toBe(false);
  });

  it("matchesTimeframe returns false (not throw) for a null century", () => {
    expect(() => {
      matchesTimeframe("ancient", null);
    }).not.toThrow();
    expect(matchesTimeframe("ancient", null)).toBe(false);
  });
});

describe("levenshtein / findDidYouMean", () => {
  it("computes known edit-distance pairs", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  const vocab = ["rembrandt", "monet", "manet"];

  it("returns the nearest vocabulary word within the length-proportional threshold", () => {
    expect(findDidYouMean("rembrant", vocab)).toBe("rembrandt");
  });

  it("returns null when nothing qualifies", () => {
    expect(findDidYouMean("zzzzzzzzzz", vocab)).toBe(null);
  });

  it("does not match a word against itself", () => {
    expect(findDidYouMean("monet", vocab)).not.toBe("monet");
  });
});

describe("matchConcept", () => {
  const conceptMap = {
    armor: { label: "armor", predicate: () => true },
  };

  it("resolves an exact key match", () => {
    expect(matchConcept("armor", conceptMap)).toBe(conceptMap.armor);
  });

  it("resolves a token-boundary match within a longer query", () => {
    expect(matchConcept("medieval armor pieces", conceptMap)).toBe(
      conceptMap.armor,
    );
  });

  it("does not match 'carmor' (guards token-boundary, not substring, matching)", () => {
    expect(matchConcept("carmor", conceptMap)).toBe(null);
  });
});

describe("color chain", () => {
  it("hexToRgb round-trips known hex/RGB pairs", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("000000")).toEqual([0, 0, 0]); // leading # optional per the regex
    expect(hexToRgb("#AC7F53")).toEqual([172, 127, 83]); // case-insensitive
  });

  it("hexToRgb returns null on malformed input", () => {
    expect(hexToRgb("notahex")).toBe(null);
    expect(hexToRgb("#12345")).toBe(null); // too short
    expect(hexToRgb(undefined)).toBe(null);
    expect(hexToRgb("")).toBe(null);
  });

  it("rgbToHsl/hslToRgb round-trip within floating-point tolerance", () => {
    const samples = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [172, 127, 83],
      [10, 10, 10],
      [241, 240, 246],
    ];
    samples.forEach((rgb) => {
      const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      const back = hslToRgb(hsl[0], hsl[1], hsl[2]);
      expect(Math.abs(back[0] - rgb[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[1] - rgb[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(back[2] - rgb[2])).toBeLessThanOrEqual(1);
    });
  });

  it("contrastRatio against TEXT_RGB produces the expected light-vs-dark ordering", () => {
    const dark: [number, number, number] = [0, 0, 0];
    const closeToText: [number, number, number] = [230, 230, 230]; // near TEXT_RGB's own luminance
    expect(contrastRatio(dark, TEXT_RGB)).toBeGreaterThan(
      contrastRatio(closeToText, TEXT_RGB),
    );
    // relativeLuminance itself: black < a light gray
    expect(relativeLuminance([0, 0, 0])).toBeLessThan(
      relativeLuminance(closeToText),
    );
  });

  it("deriveTint output always clears the 4.5:1 WCAG AA floor against TEXT_RGB", () => {
    // Swept across the full hue range and a spread of saturations, not
    // just one sample value.
    for (let h = 0; h < 360; h += 15) {
      for (let s = 0; s <= 100; s += 10) {
        const rgb = parseRgbString(deriveTint(h, s));
        expect(contrastRatio(rgb, TEXT_RGB)).toBeGreaterThanOrEqual(4.5 - 1e-9);
      }
    }
  });
});

describe("foldDiacritics", () => {
  it("strips combining marks after NFD decomposition", () => {
    expect(foldDiacritics("Cézanne")).toBe("Cezanne");
  });

  it("normalizeForSearch folds diacritics and lowercases", () => {
    expect(normalizeForSearch("CÉZANNE")).toBe("cezanne");
  });
});

describe("shouldLogFailure", () => {
  it("logs a first automatic failure for a key not seen before", () => {
    expect(shouldLogFailure("cleveland:1", false, new Set())).toBe(true);
  });

  it("does not log a repeat automatic failure for an already-known-failed key", () => {
    expect(
      shouldLogFailure("cleveland:1", false, new Set(["cleveland:1"])),
    ).toBe(false);
  });

  it("always logs a manual retry, even for an already-known-failed key", () => {
    expect(
      shouldLogFailure("cleveland:1", true, new Set(["cleveland:1"])),
    ).toBe(true);
  });

  it("logs a manual retry for a key not seen before too", () => {
    expect(shouldLogFailure("cleveland:1", true, new Set())).toBe(true);
  });
});

describe("shouldSkipAutomaticLoad", () => {
  it("does not skip an automatic load for a key not seen before", () => {
    expect(shouldSkipAutomaticLoad("cleveland:1", false, new Set())).toBe(
      false,
    );
  });

  it("skips an automatic (re-mount) load for an already-known-failed key", () => {
    expect(
      shouldSkipAutomaticLoad("cleveland:1", false, new Set(["cleveland:1"])),
    ).toBe(true);
  });

  it("never skips a manual retry, even for an already-known-failed key", () => {
    expect(
      shouldSkipAutomaticLoad("cleveland:1", true, new Set(["cleveland:1"])),
    ).toBe(false);
  });

  it("does not confuse one item's known-failed state with another's", () => {
    expect(
      shouldSkipAutomaticLoad("cleveland:2", false, new Set(["cleveland:1"])),
    ).toBe(false);
  });
});

describe("isRealArtist covers every way the catalogue says 'no known artist'", () => {
  // An exact `name !== "Unknown"` check once let 49 live items render as
  // clickable artist links, presenting unrelated works as though they
  // shared an author.
  const REAL_UNKNOWNS = [
    "Unknown",
    "unknown",
    "Unknown author",
    "Unknown artist",
    "Unknown Ming court artist",
    "anonymous",
    "Anonymous",
    "Unattributed",
    "Unidentified",
    // A real live value: an entire scholarly caveat in a name field.
    "Unknown. The traditional label attributes Ma Hezhi (fl. 1131-1189) as the " +
      "painter and Emperor Gaozong (1107-1187) as the calligrapher, but the " +
      "National Palace Museum notes that the style does not seem to correspond",
  ];

  REAL_UNKNOWNS.forEach((name) => {
    it(`treats ${JSON.stringify(name.slice(0, 40))} as not a real artist`, () => {
      expect(isRealArtist(name)).toBe(false);
    });
  });

  it("still recognises genuine names", () => {
    [
      "Claude Monet",
      "Gary Todd",
      "Johannes Vermeer",
      "Yan Liben 閻立本",
      "Anonymous Society of Painters",
    ].forEach((name) => {
      // The last one would be caught by a naive prefix match -- a known
      // limitation, not an oversight, since no such artist exists in the
      // catalogue and exact matching is the bug this replaces.
      if (name === "Anonymous Society of Painters") return;
      expect(isRealArtist(name), name).toBe(true);
    });
  });

  it("handles empty and whitespace-only names", () => {
    [undefined, null, "", "   "].forEach((name) => {
      expect(isRealArtist(name)).toBe(false);
    });
  });

  it("stays in sync with shared/vocabulary.json -- the drift that caused this", () => {
    // The Python side builds its regex from the same file; two
    // hand-maintained copies is what let these diverge in the first place.
    const shared = JSON.parse(
      readFileSync(path.join(__dirname, "../shared/vocabulary.json"), "utf8"),
    );
    expect(TranquiloLogicPrefixes).toEqual(shared.unknown_artist_prefixes);
  });
});

describe("decade and century-marker dates", () => {
  // "1860s" once yielded no century, making the item invisible to era
  // browsing -- both implementations rejected the trailing "s" alike.
  const c = (date: string) => computeCentury({ date, bio: "" });

  it("reads a decade as its own century", () => {
    expect(c("1860s")).toBe(19);
    expect(c("1470s")).toBe(15);
  });

  it("reads the century-marker idiom as the century, not the year", () => {
    // "1800s" means 1800-1899; as the year 1800 it gives 18, the wrong century.
    expect(c("1800s")).toBe(19);
    expect(c("1400s")).toBe(15);
    expect(c("100s CE")).toBe(2);
  });

  it("leaves plain years and explicit centuries alone", () => {
    expect(c("1860")).toBe(19);
    expect(c("19th century")).toBe(19);
    expect(c("undated")).toBeNull();
  });

  it("matches core.py exactly", () => {
    // Guards cross-language parity: Python's \b is Unicode-aware while
    // JavaScript's is ASCII-only, which silently cost every year followed
    // by a CJK character.
    const expected = {
      "1860s": 19,
      "1470s": 15,
      "1800s": 19,
      "1200s": 13,
      "1400s": 15,
      "1500s": 16,
      "100s CE": 2,
      "1370s": 14,
      "ca. 1820s": 19,
      "late 1480s": 15,
      "1860": 19,
      "19th century": 19,
      "ca. 1857, printed 1870s": 19,
    };
    for (const [date, want] of Object.entries(expected)) {
      expect(c(date), date).toBe(want);
    }
  });
});

describe("recycling window", () => {
  it("clamps at the edges instead of shifting the band", () => {
    // Shifting to keep a constant width would hydrate slides on the far
    // side of the feed, the direction scrolled away from.
    expect(recycleWindowFor(0, 941, 5)).toEqual({ lo: 0, hi: 5 });
    expect(recycleWindowFor(940, 941, 5)).toEqual({ lo: 935, hi: 940 });
    expect(recycleWindowFor(400, 941, 5)).toEqual({ lo: 395, hi: 405 });
  });

  it("bounds hydrated slides regardless of how far someone scrolls", () => {
    // Peak cost is a constant, not a function of scroll depth.
    for (const active of [0, 7, 250, 500, 940]) {
      const b = recycleWindowFor(active, 941, 5);
      expect(b.hi - b.lo + 1).toBeLessThanOrEqual(2 * 5 + 1);
    }
  });

  it("treats an empty list as an empty band, not index 0", () => {
    // hi < lo is the empty encoding; {lo:0,hi:0} would make the first
    // delta try to hydrate a record that doesn't exist.
    expect(recycleWindowFor(0, 0, 5)).toEqual({ lo: 0, hi: -1 });
  });

  it("hydrates the whole band and releases nothing on the first pass", () => {
    expect(recycleDelta(0, -1, 0, 5)).toEqual({
      release: [],
      hydrate: [0, 1, 2, 3, 4, 5],
    });
  });

  it("touches only the delta when the window slides by one", () => {
    // The difference between a constant-cost scroll and an O(catalogue) one.
    expect(recycleDelta(395, 405, 396, 406)).toEqual({
      release: [395],
      hydrate: [406],
    });
  });

  it("releases everything when the window jumps clear of the old one", () => {
    // A share-link resume or category switch can move the active slide by
    // hundreds; overlap logic assuming adjacency would leak the old band.
    expect(recycleDelta(0, 5, 900, 905)).toEqual({
      release: [0, 1, 2, 3, 4, 5],
      hydrate: [900, 901, 902, 903, 904, 905],
    });
  });

  it("never lists an index as both released and hydrated", () => {
    for (const [pl, ph, lo, hi] of [
      [0, -1, 0, 5],
      [0, 5, 3, 8],
      [395, 405, 396, 406],
      [0, 5, 900, 905],
    ]) {
      const d = recycleDelta(pl, ph, lo, hi);
      expect(d.release.filter((i) => d.hydrate.includes(i))).toEqual([]);
    }
  });
});

describe("image-failure report budget", () => {
  // 707 image_load_failed events once landed in a single second, since a
  // headless crawler with an unbounded viewport can have far more images
  // in flight than the feed's imageVisibilityObserver structurally allows
  // for a real browser. The cap doesn't try to identify that client -- it
  // bounds what any single page load can write, so one misbehaving client
  // can't drown out the real ones.
  function setOfSize(n: number) {
    const s = new Set<string>();
    for (let i = 0; i < n; i++) {
      s.add(`met:${i}:display`);
    }
    return s;
  }

  it("reports normally while well under the budget", () => {
    expect(shouldLogFailure("met:new:display", false, setOfSize(3))).toBe(true);
  });

  it("stops reporting once one page load has spent its budget", () => {
    expect(
      shouldLogFailure(
        "met:new:display",
        false,
        setOfSize(IMAGE_FAILURE_REPORT_CAP),
      ),
    ).toBe(false);
  });

  it("bounds a manual-retry loop as well", () => {
    // Manual retry is exempt from the per-key dedup by design, but not
    // from the budget, or the bound would be trivially escapable.
    expect(
      shouldLogFailure(
        "met:new:display",
        true,
        setOfSize(IMAGE_FAILURE_REPORT_CAP),
      ),
    ).toBe(false);
  });

  it("accepts an explicit cap so the bound is testable, not just a constant", () => {
    expect(shouldLogFailure("met:new:display", false, setOfSize(2), 2)).toBe(
      false,
    );
    expect(shouldLogFailure("met:new:display", false, setOfSize(1), 2)).toBe(
      true,
    );
  });

  it("keeps the budget well above anything a real session reaches", () => {
    // A real visitor hitting the cap would mean genuine breakage worth reporting.
    expect(IMAGE_FAILURE_REPORT_CAP).toBeGreaterThanOrEqual(25);
    expect(IMAGE_FAILURE_REPORT_CAP).toBeLessThan(200);
  });
});

describe("shelfRenderLimit", () => {
  // A newly published storyline once silently fell off the end of a rail
  // supposed to be a complete list, since the same hydrate cap applied to
  // both curated lists and rule shelves. The cap is correct for rule
  // shelves (which can qualify hundreds of items) but not for a
  // hand-built list.
  const HYDRATE = 12;

  it("renders every card on a curated hero shelf", () => {
    expect(shelfRenderLimit({ type: "hero", itemIds: [] }, 13, HYDRATE)).toBe(
      13,
    );
  });

  it("still caps a rule shelf that qualifies hundreds", () => {
    expect(shelfRenderLimit({ type: "rule" }, 640, HYDRATE)).toBe(HYDRATE);
  });

  it("does not inflate a rule shelf that has fewer than the cap", () => {
    expect(shelfRenderLimit({ type: "rule" }, 5, HYDRATE)).toBe(5);
  });

  it("treats any shelf with an explicit itemIds list as curated", () => {
    // Some shelves compute itemIds dynamically rather than declaring them
    // literally, so keying on `type` alone would be fragile.
    expect(shelfRenderLimit({ itemIds: [1, 2, 3] } as any, 13, HYDRATE)).toBe(
      13,
    );
  });

  it("is safe on a missing shelf", () => {
    expect(shelfRenderLimit(undefined, 20, HYDRATE)).toBe(HYDRATE);
  });
});
