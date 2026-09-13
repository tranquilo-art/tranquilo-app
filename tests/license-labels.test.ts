import { describe, expect, it } from "vitest";
import { licenseLabel } from "../src/app/licenseLabels";

describe("licenseLabel", () => {
  it("links a known Creative Commons slug to its deed", () => {
    expect(licenseLabel("cc-by-4.0")).toEqual({
      label: "CC BY 4.0",
      deed: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("links npm's Open Government Data License to its authoritative page", () => {
    // Not a creativecommons.org URI -- Taiwan's own OGDL 1.0 page, the same
    // one npm.py's LICENSE_CHECK gates on.
    expect(licenseLabel("open-government-data-license-1.0")).toEqual({
      label: "Open Government Data License 1.0",
      deed: "https://data.gov.tw/license",
    });
  });

  it("is case-insensitive on the stored slug", () => {
    expect(licenseLabel("CC0")).toEqual({
      label: "CC0 1.0",
      deed: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
  });

  it("falls through to the raw value, unlinked, for an unmapped slug", () => {
    expect(licenseLabel("some-future-license")).toEqual({
      label: "some-future-license",
      deed: null,
    });
  });

  it("is empty, not a dash or placeholder, when there is nothing to show", () => {
    expect(licenseLabel("")).toEqual({ label: "", deed: null });
    expect(licenseLabel(null)).toEqual({ label: "", deed: null });
    expect(licenseLabel(undefined)).toEqual({ label: "", deed: null });
  });
});
