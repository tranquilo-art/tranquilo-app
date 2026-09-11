// wireAiDisclosureToggle() extracted out of src/app.ts's own start() (see
// src/app/aiDisclosureToggle.ts's own header comment). No DOM environment is
// configured for this project's Vitest suite (see vitest.config.mts), so
// `document` is stubbed with just enough to drive one delegated listener.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wireAiDisclosureToggle } from "../src/app/aiDisclosureToggle";

let clickHandler: (e: any) => void;
let queriedSelector: string | undefined;
let queriedBadges: any[];

function makeBadge(expanded: boolean) {
  let ariaExpanded = String(expanded);
  return {
    getAttribute: (name: string) =>
      name === "aria-expanded" ? ariaExpanded : null,
    setAttribute: (name: string, value: string) => {
      if (name === "aria-expanded") ariaExpanded = value;
    },
  };
}

function makeEvent(closestMap: Record<string, any>) {
  return {
    preventDefault: vi.fn(),
    target: {
      closest: (selector: string) => closestMap[selector] ?? null,
    },
  };
}

beforeEach(() => {
  queriedBadges = [];
  queriedSelector = undefined;
  vi.stubGlobal("document", {
    addEventListener: (_type: string, handler: (e: any) => void) => {
      clickHandler = handler;
    },
    querySelectorAll: (selector: string) => {
      queriedSelector = selector;
      return queriedBadges;
    },
  });
  wireAiDisclosureToggle();
});

describe("wireAiDisclosureToggle", () => {
  it("toggles aria-expanded on the clicked badge", () => {
    const badge = makeBadge(false);
    const e = makeEvent({ "[data-ai-disclosure]": badge });
    clickHandler(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    clickHandler(e);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes every open badge on a click elsewhere on the page", () => {
    const openBadge = makeBadge(true);
    queriedBadges = [openBadge];
    const e = makeEvent({});
    clickHandler(e);
    expect(queriedSelector).toBe('[data-ai-disclosure][aria-expanded="true"]');
    expect(openBadge.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not close an open badge when the click lands inside its note", () => {
    const openBadge = makeBadge(true);
    queriedBadges = [openBadge];
    const e = makeEvent({ "[data-ai-disclosure-text]": {} });
    clickHandler(e);
    expect(queriedSelector).toBeUndefined();
    expect(openBadge.getAttribute("aria-expanded")).toBe("true");
  });
});
