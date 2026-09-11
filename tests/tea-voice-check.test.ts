// Pre-flight checks for a Tea Voice batch, before it reaches human review --
// mechanical faults a checker can catch instead, like a Cleveland link
// built from a guessed accession number (resolves to a real but wrong
// object) or a caption opening "It wasn't only dancers" that only parses
// after reading a different caption in a randomly-ordered feed. Errors are
// factual and block; warnings are stylistic and inform, since a linter
// that fails a batch over sentence length would be ignored within a week.
import { describe, expect, it } from "vitest";
import * as check from "../lib/tea-voice-check.ts";

const item = {
  source: "cleveland",
  native_id: "393049",
  url: "https://clevelandart.org/art/2020.223",
};

describe("links must come from the stored url", () => {
  it("passes a link that matches exactly", () => {
    const out = check.checkLinks(item, [
      "https://clevelandart.org/art/2020.223",
    ]);
    expect(out).toEqual([]);
  });

  it("catches a fabricated accession number", () => {
    const out = check.checkLinks(item, [
      "https://clevelandart.org/art/1923.1049",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("error");
    expect(out[0].message).toMatch(/does not match the stored url/i);
  });

  it("leaves third-party sources alone", () => {
    const out = check.checkLinks(item, [
      "https://www.artsy.net/article/artsy-editorial-sordid-truth-degass-ballet-dancers",
      "https://clevelandart.org/art/2020.223",
    ]);
    expect(out).toEqual([]);
  });

  it("catches a link to the right institution but the wrong item", () => {
    const out = check.checkLinks(
      {
        source: "met",
        native_id: "436156",
        url: "https://www.metmuseum.org/art/collection/search/436156",
      },
      ["https://www.metmuseum.org/art/collection/search/436127"],
    );
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("error");
  });

  it("says so when the item has no stored url to check against", () => {
    const out = check.checkLinks({ source: "met", native_id: "1", url: "" }, [
      "https://www.metmuseum.org/art/collection/search/1",
    ]);
    expect(out[0].level).toBe("warning");
    expect(out[0].message).toMatch(/no stored url/i);
  });
});

describe("captions cannot assume feed order", () => {
  it("catches an opener that refers to another item", () => {
    const out = check.checkCrossReferences(
      "It wasn't only dancers. Degas drew laundresses too.",
    );
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("error");
  });

  it("catches the other sequence-dependent forms", () => {
    for (const opener of [
      "As we saw earlier, Degas worked in pastel.",
      "Unlike the previous print, this one is small.",
      "Here too the dancers are waiting.",
    ]) {
      expect(check.checkCrossReferences(opener), opener).toHaveLength(1);
    }
  });

  it("does not flag a self-contained caption", () => {
    expect(
      check.checkCrossReferences(
        "Degas was 23 and living in Rome. This is the only self-portrait he ever etched.",
      ),
    ).toEqual([]);
  });

  it("does not flag 'this' pointing at the artwork itself", () => {
    // Only references to OTHER items are the problem.
    expect(
      check.checkCrossReferences("This is a laundry: a day pressing shirts."),
    ).toEqual([]);
  });
});

describe("every claim needs a source", () => {
  it("catches a claim with no source_url", () => {
    const out = check.checkClaims([{ text: "Degas never sold a sculpture" }]);
    expect(out).toHaveLength(1);
    expect(out[0].level).toBe("error");
  });

  it("catches an empty source_url", () => {
    expect(check.checkClaims([{ text: "x", source_url: "" }])).toHaveLength(1);
  });

  it("passes a grounded claim", () => {
    expect(
      check.checkClaims([
        {
          text: "x",
          source_url: "https://www.metmuseum.org/art/collection/search/436127",
        },
      ]),
    ).toEqual([]);
  });
});

describe("wall text, as a warning not a failure", () => {
  it("warns on a caption well past the batch-09 length", () => {
    const long = "word ".repeat(140);
    const out = check.checkReadability(long);
    expect(out.some((o: any) => /long/i.test(o.message))).toBe(true);
    expect(out.every((o: any) => o.level === "warning")).toBe(true);
  });

  it("warns on a single very long sentence", () => {
    // Tracks sentence length rather than total length -- a caption can be
    // dense from one overlong sentence even with an unremarkable word count.
    const out = check.checkReadability(
      "This relief depicts a mystic vision that Saint Bridget recorded in her own writings, " +
        "the Revelationes, in which Christ himself presents her with the rule for the religious " +
        "order she founded in Sweden in 1346, carved for a predella in a Perugia church that was " +
        "taken apart only decades later.",
    );
    expect(out.some((o: any) => /sentence/i.test(o.message))).toBe(true);
  });

  it("passes a caption in the approved register", () => {
    expect(
      check.checkReadability(
        "A waiter Ryder knew told him betting on horses was easy money. Ryder told him not to. " +
          "The man put his savings on a horse called Hanover. Hanover came third.",
      ),
    ).toEqual([]);
  });
});

// checkLinks stops a fabricated citation -- a link built from a guessed
// accession number that resolves to some real object. But treating every
// url on an institution host as an object page once flagged the Met's own
// Heilbrunn essay used to ground a Cleveland item, which is legitimate
// third-party scholarship, not a fabrication risk. So institution object
// pages must match the stored url; essay/publication paths are ordinary
// grounding, while unknown institution paths stay strict.
describe("checkLinks: essays vs object pages", () => {
  const clevelandItem = {
    source: "cleveland",
    native_id: "1951.430",
    url: "https://clevelandart.org/art/1951.430",
  };

  it("allows a museum essay from another institution as grounding", () => {
    const errs = check.checkLinks(clevelandItem, [
      "https://www.metmuseum.org/essays/edgar-degas-1834-1917-bronze-sculpture",
    ]);
    expect(errs).toEqual([]);
  });

  it("allows met-publications and toah paths", () => {
    const errs = check.checkLinks(clevelandItem, [
      "https://www.metmuseum.org/met-publications/edgar-degas-photographer",
      "https://www.metmuseum.org/toah/hd/dega/hd_dega.htm",
    ]);
    expect(errs).toEqual([]);
  });

  it("still rejects an object page for a DIFFERENT object", () => {
    const errs = check.checkLinks(
      {
        source: "met",
        native_id: "436170",
        url: "https://www.metmuseum.org/art/collection/search/436170",
      },
      ["https://www.metmuseum.org/art/collection/search/436127"],
    );
    expect(errs).toHaveLength(1);
    expect(errs[0].level).toBe("error");
  });

  it("rejects a cross-institution object page too", () => {
    const errs = check.checkLinks(clevelandItem, [
      "https://www.metmuseum.org/art/collection/search/436127",
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0].level).toBe("error");
  });

  it("stays strict on an unrecognised institution path", () => {
    const errs = check.checkLinks(clevelandItem, [
      "https://clevelandart.org/some/new/shape",
    ]);
    expect(errs).toHaveLength(1);
  });

  it("accepts the item's own stored url", () => {
    expect(check.checkLinks(clevelandItem, [clevelandItem.url])).toEqual([]);
  });
});

// A second review round is often caused by faults introduced while fixing
// the first round's notes. Two mechanical causes: a bare definite
// reference ("the book") never actually naming which book, and a link
// that 403s (a dead citation costs a reviewer a click to discover). Both
// are warnings, not errors, since either can be legitimate.
describe("catching what causes a second review round", () => {
  const item = {
    source: "met",
    native_id: "1",
    url: "https://www.metmuseum.org/art/collection/search/1",
  };

  it("flags a source on a host known to refuse us", () => {
    const out = check.checkItem({
      ...item,
      caption_tea: "A caption.",
      tea_voice_claims: [
        {
          text: "x",
          status: "grounded",
          source_url: "https://artuk.org/discover/stories/x",
        },
      ],
    });
    const w = out.filter((f: any) => /403|refuses|blocked/i.test(f.message));
    expect(w.length).toBeGreaterThan(0);
  });

  it("leaves ordinary third-party sources alone", () => {
    const out = check.checkItem({
      ...item,
      caption_tea: "A caption.",
      tea_voice_claims: [
        {
          text: "x",
          status: "grounded",
          source_url: "https://www.britannica.com/topic/x",
        },
      ],
    });
    const w = out.filter((f: any) => /403|refuses|blocked/i.test(f.message));
    expect(w).toHaveLength(0);
  });
});
