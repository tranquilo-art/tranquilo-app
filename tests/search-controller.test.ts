// SearchController owns the search panel's open/close lifecycle and the
// runSearch() state machine (exact match -> spelling correction -> concept
// map -> dead end). No DOM environment is configured for this suite, so
// `document` is stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActiveConcept,
  SearchController,
  type SearchControllerHost,
} from "../src/app/SearchController";

function makeHost(overrides: Partial<SearchControllerHost> = {}) {
  let activeSearch: string | null = null;
  let activeConcept: ActiveConcept | null = null;
  let searchResultCount = 0;
  const filterBannerHtml: string | null = null;

  const host: SearchControllerHost = {
    getActiveSearch: vi.fn(() => activeSearch),
    setActiveSearch: vi.fn((v) => {
      activeSearch = v;
    }),
    getActiveConcept: vi.fn(() => activeConcept),
    setActiveConcept: vi.fn((v) => {
      activeConcept = v;
    }),
    setActiveCategory: vi.fn(),
    setActiveArtist: vi.fn(),
    setActiveCollectionFilter: vi.fn(),
    getSearchResultCount: vi.fn(() => searchResultCount),
    setSearchResultCount: vi.fn((v) => {
      searchResultCount = v;
    }),
    getFilterBannerHtml: vi.fn(() => filterBannerHtml),
    clearSuggestions: vi.fn(),
    setResultsLine: vi.fn(),
    openSearchBar: vi.fn(),
    closeSearchBar: vi.fn(),
    pushHistory: vi.fn(),
    findCorrection: vi.fn(async () => null),
    searchBarContains: vi.fn(() => false),
    setSearchActive: vi.fn(),
    setFilterBannerVisible: vi.fn(),
    topbarHideFilterBanner: vi.fn(),
    searchToggleContains: vi.fn(() => false),
    setFeedScrollLocked: vi.fn(),
    setFeedFilterPush: vi.fn(),
    setFeedSearchPush: vi.fn(),
    renderFeed: vi.fn(),
    adjustFeedScrollForHeightChange: vi.fn((fn: () => void) => fn()),
    pushOverlayHistoryState: vi.fn(),
    closeOverlaySync: vi.fn((fn: () => void) => fn()),
    renderChips: vi.fn(),
    showFilterBanner: vi.fn(),
    hideFilterBanner: vi.fn(),
    trackEvent: vi.fn(),
    escapeHtml: vi.fn((s: string) => s),
    apiUrl: vi.fn(() => "https://example.com/api"),
    fetchJson: vi.fn(async () => ({ items: [] })),
    countMatches: vi.fn(async () => 0),
    ...overrides,
  };
  return host;
}

let classListAdd: ReturnType<typeof vi.fn>;
let classListRemove: ReturnType<typeof vi.fn>;
let addEventListenerMock: ReturnType<typeof vi.fn>;
let removeEventListenerMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  classListAdd = vi.fn();
  classListRemove = vi.fn();
  addEventListenerMock = vi.fn();
  removeEventListenerMock = vi.fn();
  vi.stubGlobal("document", {
    body: { classList: { add: classListAdd, remove: classListRemove } },
    addEventListener: addEventListenerMock,
    removeEventListener: removeEventListenerMock,
    getElementById: vi.fn(() => null),
  });
});

describe("isOpen", () => {
  it("starts closed, flips true after open(), flips back after close()", () => {
    const controller = new SearchController(makeHost());
    expect(controller.isOpen()).toBe(false);
    controller.open();
    expect(controller.isOpen()).toBe(true);
    controller.close();
    expect(controller.isOpen()).toBe(false);
  });
});

describe("open", () => {
  it("activates search mode and pushes overlay history", () => {
    const host = makeHost();
    const controller = new SearchController(host);
    controller.open();
    expect(host.setSearchActive).toHaveBeenCalledWith(true);
    expect(host.setFilterBannerVisible).toHaveBeenCalledWith(false);
    expect(classListAdd).toHaveBeenCalledWith("search-panel-open");
    expect(host.setFeedFilterPush).toHaveBeenCalledWith(false);
    expect(host.setFeedSearchPush).toHaveBeenCalledWith(true);
    expect(host.openSearchBar).toHaveBeenCalledWith("");
    expect(host.pushOverlayHistoryState).toHaveBeenCalledWith("search");
    expect(addEventListenerMock).toHaveBeenCalled();
  });

  it("prefills from the active search and leaves the feed scrollable", () => {
    const host = makeHost({ getActiveSearch: vi.fn(() => "armor") });
    const controller = new SearchController(host);
    controller.open();
    expect(host.openSearchBar).toHaveBeenCalledWith("armor");
    expect(host.setFeedScrollLocked).toHaveBeenCalledWith(false);
  });

  it("locks the feed scroll when opening with nothing active", () => {
    const host = makeHost();
    const controller = new SearchController(host);
    controller.open();
    expect(host.setFeedScrollLocked).toHaveBeenCalledWith(true);
  });
});

describe("close", () => {
  it("deactivates search mode and restores the filter banner when one is active", () => {
    const host = makeHost({ getFilterBannerHtml: vi.fn(() => "<b>hi</b>") });
    const controller = new SearchController(host);
    controller.open();
    controller.close();
    expect(host.setSearchActive).toHaveBeenCalledWith(false);
    expect(classListRemove).toHaveBeenCalledWith("search-panel-open");
    expect(host.closeSearchBar).toHaveBeenCalled();
    expect(removeEventListenerMock).toHaveBeenCalled();
    expect(host.showFilterBanner).toHaveBeenCalledWith("<b>hi</b>");
    expect(host.topbarHideFilterBanner).not.toHaveBeenCalled();
  });

  it("hides the topbar banner outright when no filter is active", () => {
    const host = makeHost();
    const controller = new SearchController(host);
    controller.open();
    controller.close();
    expect(host.topbarHideFilterBanner).toHaveBeenCalled();
    expect(host.showFilterBanner).not.toHaveBeenCalled();
  });
});

describe("run", () => {
  it("clears the active search and re-renders on an empty query", async () => {
    const host = makeHost();
    const controller = new SearchController(host);
    await controller.run("   ");
    expect(host.setActiveSearch).toHaveBeenCalledWith(null);
    expect(host.setActiveConcept).toHaveBeenCalledWith(null);
    expect(host.setSearchResultCount).toHaveBeenCalledWith(0);
    expect(host.setResultsLine).toHaveBeenCalledWith("");
    expect(host.hideFilterBanner).toHaveBeenCalled();
    expect(host.renderChips).toHaveBeenCalled();
    expect(host.renderFeed).toHaveBeenCalled();
    expect(host.openSearchBar).toHaveBeenCalledWith("");
    expect(host.countMatches).not.toHaveBeenCalled();
  });

  it("sets the active search and hands off to the filter banner on a literal match", async () => {
    const host = makeHost({ countMatches: vi.fn(async () => 3) });
    const controller = new SearchController(host);
    await controller.run("wheat field");
    expect(host.setSearchResultCount).toHaveBeenCalledWith(3);
    expect(host.setActiveSearch).toHaveBeenCalledWith("wheat field");
    expect(host.setActiveConcept).toHaveBeenCalledWith(null);
    expect(host.pushHistory).toHaveBeenCalledWith("wheat field");
    expect(host.showFilterBanner).toHaveBeenCalled();
    expect(host.findCorrection).not.toHaveBeenCalled();
  });

  it("offers a did-you-mean correction when nothing matches literally", async () => {
    const host = makeHost({
      countMatches: vi.fn(async () => 0),
      findCorrection: vi.fn(async () => "wheat field"),
    });
    const controller = new SearchController(host);
    await controller.run("wheet field");
    expect(host.setActiveSearch).toHaveBeenCalledWith(null);
    expect(host.hideFilterBanner).toHaveBeenCalled();
    expect(host.setResultsLine).toHaveBeenCalledWith(
      expect.stringContaining("wheat field"),
    );
    expect(host.renderFeed).toHaveBeenCalled();
  });

  it("falls back to a curated concept match when there is no literal or corrected result", async () => {
    const host = makeHost({
      countMatches: vi.fn(async () => 0),
      findCorrection: vi.fn(async () => null),
      fetchJson: vi.fn(async () => ({ items: [{ id: "1" }] })),
    });
    const controller = new SearchController(host);
    await controller.run("armor");
    expect(host.setActiveConcept).toHaveBeenCalledWith({
      label: "armor",
      filter: { category: "Arms & Armor" },
    });
    expect(host.showFilterBanner).toHaveBeenCalled();
    expect(host.trackEvent).not.toHaveBeenCalledWith(
      "search_zero_results",
      expect.anything(),
    );
  });

  it("a color word resolves to the real (array-contains) palette_bucket filter, not the categorical palette column", async () => {
    const host = makeHost({
      countMatches: vi.fn(async () => 0),
      findCorrection: vi.fn(async () => null),
      fetchJson: vi.fn(async () => ({ items: [{ id: "1" }] })),
    });
    const controller = new SearchController(host);
    await controller.run("blue");
    expect(host.setActiveConcept).toHaveBeenCalledWith({
      label: "blue tones",
      filter: { palette_bucket: "Blue" },
    });
  });

  it("reaches a dead end when a concept matches but the server has nothing for it", async () => {
    const host = makeHost({
      countMatches: vi.fn(async () => 0),
      findCorrection: vi.fn(async () => null),
      fetchJson: vi.fn(async () => ({ items: [] })),
    });
    const controller = new SearchController(host);
    await controller.run("armor");
    expect(host.trackEvent).toHaveBeenCalledWith("search_zero_results", {
      query: "armor",
    });
    expect(host.setActiveCategory).toHaveBeenCalledWith("All");
    expect(host.setResultsLine).toHaveBeenCalledWith(
      expect.stringContaining("No results"),
    );
  });

  it("reaches a dead end when the query matches nothing at all", async () => {
    const host = makeHost({
      countMatches: vi.fn(async () => 0),
      findCorrection: vi.fn(async () => null),
    });
    const controller = new SearchController(host);
    await controller.run("zzzznotathing");
    expect(host.trackEvent).toHaveBeenCalledWith("search_zero_results", {
      query: "zzzznotathing",
    });
    expect(host.setActiveSearch).toHaveBeenCalledWith(null);
    expect(host.hideFilterBanner).toHaveBeenCalled();
  });
});
