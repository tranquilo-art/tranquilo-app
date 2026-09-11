import { describe, expect, it } from "vitest";
import { isAggregatorSource, sourceLinkLabel } from "../src/app/sourceLinks";

describe("sourceLinkLabel", () => {
  it("maps each known source to its own domain", () => {
    expect(sourceLinkLabel({ source: "met" })).toBe("metmuseum.org");
    expect(sourceLinkLabel({ source: "smithsonian" })).toBe("cooperhewitt.org");
    expect(sourceLinkLabel({ source: "cleveland" })).toBe("clevelandart.org");
    expect(sourceLinkLabel({ source: "commons" })).toBe(
      "commons.wikimedia.org",
    );
    expect(sourceLinkLabel({ source: "europeana" })).toBe("europeana.eu");
  });

  it("falls back to the raw source string for an unmapped source", () => {
    expect(sourceLinkLabel({ source: "some-new-source" })).toBe(
      "some-new-source",
    );
  });

  it("falls back to 'source' when there is no source at all", () => {
    expect(sourceLinkLabel({})).toBe("source");
    expect(sourceLinkLabel(null)).toBe("source");
    expect(sourceLinkLabel(undefined)).toBe("source");
  });
});

describe("isAggregatorSource", () => {
  it("is true only for europeana", () => {
    expect(isAggregatorSource({ source: "europeana" })).toBe(true);
    expect(isAggregatorSource({ source: "met" })).toBe(false);
    expect(isAggregatorSource({})).toBe(false);
    expect(isAggregatorSource(null)).toBe(false);
  });
});
