// buildIntroSlide()/buildEmptyCollectionSlide() build the feed's two
// static, catalogue-independent slides. No DOM environment is configured
// for this suite, so `document.createElement` is stubbed with a minimal element.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmptyCollectionSlide,
  buildIntroSlide,
} from "../src/feed/introSlides";

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const el: any = { tagName: tag };
      Object.defineProperty(el, "className", {
        get() {
          return this._className;
        },
        set(v) {
          this._className = v;
        },
      });
      Object.defineProperty(el, "innerHTML", {
        get() {
          return this._innerHTML;
        },
        set(v) {
          this._innerHTML = v;
        },
      });
      return el;
    },
  });
});

describe("buildIntroSlide", () => {
  it("renders the source and rounded work count from facets", () => {
    const el = buildIntroSlide({ sources: ["met", "cleveland"], total: 4321 });
    expect(el.className).toBe("slide intro");
    expect(el.innerHTML).toContain("2 sources");
    expect(el.innerHTML).toContain("4k+ public-domain works");
  });

  it("uses singular 'source' for exactly one", () => {
    const el = buildIntroSlide({ sources: ["met"], total: 100 });
    expect(el.innerHTML).toContain("1 source");
    expect(el.innerHTML).not.toContain("1 sources");
  });

  it("defaults to zero when facets carries no sources or total", () => {
    const el = buildIntroSlide({});
    expect(el.innerHTML).toContain("0 sources");
  });
});

describe("buildEmptyCollectionSlide", () => {
  it("renders the empty-collection placeholder", () => {
    const el = buildEmptyCollectionSlide();
    expect(el.className).toBe("slide intro");
    expect(el.innerHTML).toContain("Nothing collected");
  });
});
