import { describe, expect, it } from "vitest";
import {
  isAggregatorSource,
  sourceLinkLabel,
  sourceLinkPreposition,
} from "../src/app/sourceLinks";

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

  it("maps npm to the institution's name, not a domain", () => {
    expect(sourceLinkLabel({ source: "npm" })).toBe("National Palace Museum");
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

describe("sourceLinkPreposition", () => {
  it("defaults to 'on' for a domain-style source", () => {
    expect(sourceLinkPreposition({ source: "met" })).toBe("on");
    expect(sourceLinkPreposition({ source: "some-new-source" })).toBe("on");
    expect(sourceLinkPreposition({})).toBe("on");
  });

  it("is 'at' for npm, a named institution rather than a domain", () => {
    expect(sourceLinkPreposition({ source: "npm" })).toBe("at");
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
