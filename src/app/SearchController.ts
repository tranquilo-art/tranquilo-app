import { formatNumber, tHtml, tnHtml } from "../i18n/index";
import { matchConcept } from "../logic/logic";

export interface ActiveConcept {
  label: string;
  filter: Record<string, unknown>;
  query?: string;
}

// A curated fallback when a query finds nothing literally and no spelling
// correction either -- each entry names a server filter, not a predicate.
export interface ConceptEntry {
  label: string;
  filter: Record<string, unknown>;
}

// "renaissance" maps to the timeframe facet (centuries 15-16). "couples"
// stays a text query, since it's only a tag substring test and ?q=
// searches tags among its fields.
export const CONCEPT_MAP: Record<string, ConceptEntry> = {
  armor: {
    label: "armor",
    filter: { category: "Arms & Armor" },
  },
  renaissance: {
    label: "the Renaissance",
    filter: { timeframe: "Renaissance" },
  },
  couples: {
    label: "couples",
    // Rarely fires: a plain search usually finds these items first.
    filter: { q: "couples" },
  },
  // Real color filter, surfaced through the same soft term ->
  // filter mechanism as every concept above, rather than a new UI
  // component -- palette_bucket is the multi-valued array-contains
  // filter (api/items.ts), distinct from the single-valued `palette`
  // facet. One entry per classify_palette_buckets() bucket name; "Neutral"
  // deliberately omitted here since "neutral"/"monochrome" isn't a color
  // someone searches for the way "blue" or "green" is.
  red: { label: "red tones", filter: { palette_bucket: "Red" } },
  orange: { label: "orange tones", filter: { palette_bucket: "Orange" } },
  yellow: { label: "yellow tones", filter: { palette_bucket: "Gold/Yellow" } },
  gold: { label: "gold tones", filter: { palette_bucket: "Gold/Yellow" } },
  green: { label: "green tones", filter: { palette_bucket: "Green" } },
  teal: { label: "teal tones", filter: { palette_bucket: "Teal" } },
  blue: { label: "blue tones", filter: { palette_bucket: "Blue" } },
  purple: { label: "purple tones", filter: { palette_bucket: "Purple" } },
  pink: { label: "pink tones", filter: { palette_bucket: "Pink" } },
};

export interface SearchControllerHost {
  // Search/concept/category/artist/collection state is shared with every
  // other filter in the app, so SearchController reads and writes it
  // through the host rather than owning it.
  getActiveSearch(): string | null;
  setActiveSearch(v: string | null): void;
  getActiveConcept(): ActiveConcept | null;
  setActiveConcept(v: ActiveConcept | null): void;
  setActiveCategory(v: string): void;
  setActiveArtist(v: string | null): void;
  setActiveCollectionFilter(v: boolean): void;
  getSearchResultCount(): number;
  setSearchResultCount(v: number): void;
  getFilterBannerHtml(): string | null;

  // <tranquilo-search-bar>
  clearSuggestions(): void;
  setResultsLine(html: string): void;
  // Real "processing" feedback for the count/correction/concept-probe
  // round trip run() makes -- without it, submitting read as a hang.
  setSearchLoading(loading: boolean): void;
  openSearchBar(prefill: string): void;
  closeSearchBar(): void;
  pushHistory(q: string): void;
  findCorrection(q: string): Promise<string | null>;
  searchBarContains(target: unknown): boolean;

  // <tranquilo-topbar>
  setSearchActive(active: boolean): void;
  setFilterBannerVisible(visible: boolean): void;
  topbarHideFilterBanner(): void;
  searchToggleContains(target: unknown): boolean;

  // The feed
  setFeedScrollLocked(on: boolean): void;
  setFeedFilterPush(on: boolean): void;
  setFeedSearchPush(on: boolean): void;
  renderFeed(): void;
  adjustFeedScrollForHeightChange(applyChange: () => void): void;

  // Overlay history
  pushOverlayHistoryState(name: string): void;
  closeOverlaySync(closeFn: () => void): void;

  // Cross-cutting app.ts behaviors shared with the other filters
  renderChips(): void;
  showFilterBanner(html: string): void;
  hideFilterBanner(): void;
  trackEvent(name: string, props?: Record<string, unknown>): void;
  escapeHtml(s: string): string;
  apiUrl(params: Record<string, unknown>): string;
  fetchJson(url: string, what: string): Promise<{ items?: unknown[] }>;
  countMatches(params: Record<string, unknown>): Promise<number>;
}

// The search panel's open/close lifecycle and the runSearch() state
// machine (exact match -> spelling correction -> concept map -> dead
// end), extracted out of src/app.ts.
//
// Unified panel: one persistent .search-bar that changes state (empty ->
// suggestions/history -> results) instead of switching to .filter-banner
// on submit. A successful search no longer auto-closes the panel --
// results/did-you-mean/concept messaging renders as a second line inside
// it, staying open until explicitly dismissed, which is why the category
// chips are the persistent "get back to everything" escape hatch.
export class SearchController {
  private open_ = false;

  constructor(private host: SearchControllerHost) {
    this.handleOutsideSearchClick = this.handleOutsideSearchClick.bind(this);
  }

  isOpen(): boolean {
    return this.open_;
  }

  // Reflects whatever's currently active (or nothing) -- called on open,
  // distinct from the transient messages runSearch renders on submit.
  // Both the panel's results line and the filter banner that outlives it
  // render this, so it's derived in one place rather than rebuilt per site.
  private activeSearchLabel(): string {
    const concept = this.host.getActiveConcept();
    if (concept) {
      return tHtml("search.related", {
        concept: this.host.escapeHtml(concept.label),
      });
    }
    const search = this.host.getActiveSearch();
    if (search) {
      const count = this.host.getSearchResultCount();
      return tnHtml("search.results", count, {
        count: `<strong>${formatNumber(count)}</strong>`,
        query: this.host.escapeHtml(search),
      });
    }
    return "";
  }

  private renderPersistedSearchState(): void {
    this.host.setResultsLine(this.activeSearchLabel());
  }

  private handleOutsideSearchClick(e: { target: unknown }): void {
    if (!this.open_) return;
    if (
      this.host.searchBarContains(e.target) ||
      this.host.searchToggleContains(e.target)
    )
      return;
    this.host.closeOverlaySync(this.close);
  }

  // Pushes #feed/.slide down below the search panel instead of letting it
  // float on top of the artwork. --search-bar-h tracks the panel's actual
  // rendered height via a ResizeObserver rather than a guessed constant.
  // adjustFeedScrollForHeightChange corrects feedEl.scrollTop to match,
  // since scroll-snap doesn't re-evaluate on its own when layout changes.
  open = (): void => {
    this.open_ = true;
    this.host.setSearchActive(true);
    this.host.setFilterBannerVisible(false);
    // The topbar is a flat space-between row that stays clustered only
    // while a child (.chips or .filter-banner) grows to fill the space.
    // Reopening the panel hides both, so this class lets CSS supply a
    // spacer to keep the icons from scattering.
    document.body.classList.add("search-panel-open");
    const concept = this.host.getActiveConcept();
    const prefill = concept
      ? concept.query || ""
      : this.host.getActiveSearch() || "";
    this.host.adjustFeedScrollForHeightChange(() => {
      // Bypasses hideFilterBanner(), since export/chips visibility should
      // stay whatever the active filter left it in, so filter-push needs
      // cleaning up here too or it'd stack with search-push.
      this.host.setFeedFilterPush(false);
      this.host.setFeedSearchPush(true);
      this.host.openSearchBar(prefill);
    });
    this.renderPersistedSearchState();
    if (prefill) {
      // Reopening onto an already-active search -- nothing overlays the
      // feed here, so it should stay scrollable.
      this.host.setFeedScrollLocked(false);
    } else {
      this.host.setFeedScrollLocked(true);
    }
    document.addEventListener("click", this.handleOutsideSearchClick, true);
    this.host.pushOverlayHistoryState("search");
  };

  close = (): void => {
    this.open_ = false;
    this.host.setSearchActive(false);
    document.body.classList.remove("search-panel-open");
    this.host.setFeedScrollLocked(false);
    this.host.adjustFeedScrollForHeightChange(() => {
      this.host.setFeedSearchPush(false);
      this.host.closeSearchBar();
    });
    document.removeEventListener("click", this.handleOutsideSearchClick, true);
    // Restore whatever the banner was saying rather than unconditionally
    // handing the space to the chips: a filter can still be active after
    // the panel closes, and a filtered feed with an unfiltered chip row
    // above it is a lie about what's on screen.
    const filterBannerHtml = this.host.getFilterBannerHtml();
    if (filterBannerHtml !== null) {
      this.host.showFilterBanner(filterBannerHtml);
    } else {
      this.host.topbarHideFilterBanner();
    }
  };

  // A search that actually produced a feed is done being composed, so the
  // panel closes and the slim filter banner (the mechanism every other
  // filter already uses) takes over announcing it. Both calls run in the
  // same task, so the banner label close() restores is never painted.
  private handOffToFilterBanner(): void {
    if (this.open_) {
      this.host.closeOverlaySync(this.close);
    }
    this.host.showFilterBanner(this.activeSearchLabel());
  }

  // Does this concept match anything? One row is enough to know.
  private probeConcept(concept: ConceptEntry): Promise<boolean> {
    const p: Record<string, unknown> = {
      shape: "manifest",
      order: "shuffle",
      limit: 1,
      start: 0,
    };
    Object.keys(concept.filter).forEach((k) => {
      p[k] = concept.filter[k];
    });
    return this.host
      .fetchJson(this.host.apiUrl(p), "concept probe")
      .then((body) => !!body.items?.length)
      .catch((err: unknown) => {
        console.error("items: concept probe failed", err);
        return false;
      });
  }

  private searchDeadEnd(q: string): void {
    this.host.trackEvent("search_zero_results", { query: q });
    this.host.setActiveSearch(null);
    this.host.setActiveConcept(null);
    this.host.setActiveCategory("All");
    // The panel stays open over an unfiltered feed, same reasoning as the
    // did-you-mean branch in run() -- scroll stays locked so that feed
    // isn't scrollable behind the still-open panel.
    this.host.setFeedScrollLocked(true);
    this.host.hideFilterBanner();
    this.host.setResultsLine(
      tHtml("search.noResults", { query: this.host.escapeHtml(q) }),
    );
    this.host.renderChips();
    this.host.renderFeed();
  }

  async run(rawQuery: string): Promise<void> {
    const q = rawQuery.trim();
    this.host.clearSuggestions();

    if (!q) {
      this.host.setActiveSearch(null);
      this.host.setActiveConcept(null);
      this.host.setSearchResultCount(0);
      this.host.setResultsLine("");
      // The feed is unfiltered again, so a remembered banner would
      // outlive the filter it describes.
      this.host.hideFilterBanner();
      this.host.renderChips();
      this.host.renderFeed();
      // Redundant with open()'s display/focus writes, but also re-renders
      // the history/hint chips a cleared query should fall back to.
      this.host.openSearchBar("");
      // The panel is reopening over the feed, same as a fresh open() with
      // nothing active -- see that method's own scroll-lock reasoning.
      this.host.setFeedScrollLocked(true);
      return;
    }

    this.host.trackEvent("search_submit", { query: q });

    // Real feedback for the round trip below (count, then possibly a
    // correction or concept-probe lookup) -- without this the submit
    // button just sat there through the whole gap, reading as a hang.
    // finally, not a call at the end of the try: every branch below
    // returns early, and a thrown network error must still clear it.
    this.host.setSearchLoading(true);
    try {
      await this.runQuery(q);
    } finally {
      this.host.setSearchLoading(false);
    }
  }

  // The actual literal-match -> concept-map -> correction -> dead-end
  // pipeline, split out of run() so the loading-state try/finally above
  // wraps it without an extra indent level over the whole thing.
  private async runQuery(q: string): Promise<void> {
    // The count decides the branch; the feed fetches the rows itself.
    const searchResultCount = await this.host.countMatches({ q });
    this.host.setSearchResultCount(searchResultCount);
    this.host.setActiveArtist(null);
    this.host.setActiveCollectionFilter(false);

    if (searchResultCount > 0) {
      this.host.setActiveSearch(q);
      this.host.setActiveConcept(null);
      this.host.setActiveCategory("All");
      this.host.pushHistory(q);
      this.renderPersistedSearchState();
      this.host.renderChips();
      this.host.renderFeed();
      // Only this branch (and the concept-match branch below) actually
      // closes the panel and hands the feed to the visitor as real
      // content -- every other branch below leaves the panel open on top
      // of an unfiltered feed, which is exactly what scroll-locked exists
      // to protect against; unlocking unconditionally here used to let a
      // "did you mean"/dead-end response leave the intro/feed behind it
      // scrollable, out of sync with the still-fixed panel above it.
      this.host.setFeedScrollLocked(false);
      this.handOffToFilterBanner();
      return;
    }

    // Zero literal results: try the curated concept map (e.g. "armor,"
    // "renaissance," a color word) before a fuzzy spelling guess -- a
    // concept entry is a deliberate, exact keyword match (matchConcept()
    // only ever does exact/token lookups against CONCEPT_MAP's own keys),
    // strictly more authoritative than a same-edit-distance guess at an
    // unrelated real word. A curated word that's one edit away from some
    // other real word in the corpus previously surfaced a "did you mean"
    // suggestion instead of the curated match, simply for being checked
    // second.
    const concept = matchConcept(q, CONCEPT_MAP);
    if (concept) {
      // Asked with limit=1 rather than fetching a page, since the only
      // thing needed here is "is this non-empty" -- the feed fetches the
      // real first page a moment later.
      const hasItems = await this.probeConcept(concept);
      if (hasItems) {
        this.host.setActiveSearch(null);
        this.host.setActiveConcept({
          label: concept.label,
          filter: concept.filter,
        });
        this.host.setActiveCategory("All");
        this.renderPersistedSearchState();
        this.host.renderChips();
        this.host.renderFeed();
        this.host.setFeedScrollLocked(false);
        this.handOffToFilterBanner();
        return;
      }
      // A curated word whose own probe comes back empty (e.g. a category
      // genuinely has nothing right now) still falls through to spelling
      // correction below rather than dead-ending immediately -- the
      // concept existing doesn't guarantee it currently has results.
    }

    const correction = await this.host.findCorrection(q);
    if (correction) {
      this.host.setActiveSearch(null);
      this.host.setActiveConcept(null);
      this.host.setActiveCategory("All");
      // Panel stays open, since it holds the correction button, but the
      // feed underneath is unfiltered, so no banner should claim it is --
      // and scroll stays locked, since that unfiltered feed is not what
      // this response is actually about.
      this.host.setFeedScrollLocked(true);
      this.host.hideFilterBanner();
      this.host.setResultsLine(
        tHtml("search.didYouMean", {
          query: this.host.escapeHtml(q),
          suggestion: `<button type="button" class="did-you-mean-link" id="didYouMeanBtn">${this.host.escapeHtml(
            correction,
          )}</button>`,
        }),
      );
      const dymBtn = document.getElementById("didYouMeanBtn");
      if (dymBtn) {
        dymBtn.addEventListener("click", () => {
          (document.getElementById("searchInput") as HTMLInputElement).value =
            correction;
          this.run(correction);
        });
      }
      this.host.renderChips();
      this.host.renderFeed();
      return;
    }

    this.searchDeadEnd(q);
  }
}
