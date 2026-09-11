// The search panel (input, submit/close, results line, autocomplete/
// history/browse-hint suggestions), as a native custom element.
//
// Different integration shape from TranquiloTopbar/TranquiloMusicToggle,
// deliberately: those hand app.js decisions through a host-object
// property. This element instead dispatches CustomEvents (search-submit,
// search-close-request) so any component could listen without this
// element changing. State flows the other way as plain method calls
// (open(), close(), setResultsLine()).
//
// app.js still decides what a submitted/cleared query means for the feed
// and still owns the overlay-stack/feed-scroll-compensation machinery
// shared with every overlay -- neither belongs to a single panel. This
// element owns everything that doesn't leave its own DOM: the input,
// debounced autocomplete, spelling correction, browse-hint chips, recent
// history, and keyboard navigation between them.
//
// Renders into light DOM: every style already lives in css/style.css.
// Light DOM also keeps #searchInput/#searchResultsLine/etc. reachable via
// plain getElementById, including the #didYouMeanBtn app.js's runSearch()
// creates inside the results line and wires up itself.

import {
  findDidYouMean,
  isRealArtist,
  normalizeForSearch,
  shuffled,
} from "../logic/logic";
import { on } from "../utils/on";

interface FacetEntry {
  value: string;
  count: number;
}

// The subset of /api/items?shape=facets this element actually reads.
// app.js fetches the real thing once at startup and hands it over via
// `facets` -- this element has no fetch of its own for it.
export interface SearchFacets {
  artist?: FacetEntry[];
  categories?: FacetEntry[];
  region?: FacetEntry[];
  era?: FacetEntry[];
  type?: FacetEntry[];
  color?: FacetEntry[];
}

interface SearchSuggestion {
  value: string;
  type: string;
  itemCount: number;
}

const SEARCH_HISTORY_KEY = "tranquilo:searchHistory";
const SEARCH_HISTORY_MAX = 8;
const CLOCK_SVG =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>';

const SEARCH_BAR_MARKUP = `
<div class="search-input-row">
  <input type="search" id="searchInput" placeholder="Search artist, title, category, era…" autocomplete="off" enterkeyhint="search">
  <button id="searchSubmit" type="button" aria-label="Run search">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
  </button>
  <button id="searchClose" type="button" aria-label="Close search">&times;</button>
</div>
<div class="search-results-line" id="searchResultsLine" aria-live="polite"></div>
<div class="search-suggestions" id="searchSuggestions"></div>
`;

function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A tiny local fetch helper rather than app.js's fetchJson()/apiUrl(),
// which are private closures unreachable from a sibling script.
// Deliberately without app.js's CACHE_BUST_VERSION param: items_vocab
// (what suggest/correction read) is already rebuilt nightly, so a few
// extra minutes of edge-cache staleness isn't worth two copies of the
// same magic number.
function fetchSearchJson(
  shape: "suggest" | "correction",
  q: string,
): Promise<Record<string, unknown>> {
  const url = `/api/items?shape=${shape}&q=${encodeURIComponent(q)}`;
  return fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`api/items ${shape} responded with ${res.status}`);
    }
    return res.json();
  });
}

export class TranquiloSearchBar extends HTMLElement {
  // Set once by app.js after its startup fetchFacets() resolves --
  // buildBrowseHint() below reads it. A plain public property since this
  // needs live data, not a string an HTML attribute could carry.
  facets: SearchFacets = {};

  private inputEl!: HTMLInputElement;
  private resultsLineEl!: HTMLElement;
  private suggestionsEl!: HTMLElement;

  private history: string[] = [];
  private highlightIndex = -1;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el)
      throw new Error(
        `<tranquilo-search-bar>: missing ${selector} in its own template`,
      );
    return el;
  }

  connectedCallback(): void {
    this.classList.add("search-bar");
    this.setAttribute("id", "searchBar");
    if (this.getAttribute("data-search-bar-mounted") === "1") return;
    this.setAttribute("data-search-bar-mounted", "1");

    this.style.display = "none";
    this.innerHTML = SEARCH_BAR_MARKUP;
    this.inputEl = this.requireEl<HTMLInputElement>("#searchInput");
    this.resultsLineEl = this.requireEl<HTMLElement>("#searchResultsLine");
    this.suggestionsEl = this.requireEl<HTMLElement>("#searchSuggestions");
    const submitBtn = this.requireEl<HTMLButtonElement>("#searchSubmit");
    const closeBtn = this.requireEl<HTMLButtonElement>("#searchClose");

    this.history = this.loadHistory();

    on(submitBtn, () => this.submit());
    on(closeBtn, () => this.requestClose());

    on(this.inputEl, "input", () => {
      this.setResultsLine("");
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(
        () => this.renderAutocomplete(this.inputEl.value),
        200,
      );
    });
    on(this.inputEl, "keydown", (e) => this.onInputKeydown(e as KeyboardEvent));
    // Not on()'s 3-arg form: TS's HTMLElementEventMap doesn't list the
    // native <input type="search"> "search" event (fired on Enter, and on
    // clearing via the input's own X on some platforms).
    this.inputEl.addEventListener("search", () => this.submit());

    // --search-bar-h stays in sync with the panel's actual rendered
    // height, self-managed the same way <tranquilo-topbar> manages
    // --topbar-h: app.js's adjustFeedScrollForHeightChange() captures the
    // one synchronous jump on open()/close(), but ongoing content-driven
    // resizes just need the var kept current, not feed-scroll compensation.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.style.display !== "none") {
          document.documentElement.style.setProperty(
            "--search-bar-h",
            `${this.offsetHeight}px`,
          );
        }
      });
      this.resizeObserver.observe(this);
    }
  }

  // ---- Public API (app.js calls in) ----

  open(prefill: string): void {
    this.style.display = "flex";
    document.documentElement.style.setProperty(
      "--search-bar-h",
      `${this.offsetHeight}px`,
    );
    this.inputEl.value = prefill;
    this.highlightIndex = -1;
    if (prefill) {
      // Reopening onto an already-active search -- nothing overlays the
      // feed in this state.
      this.suggestionsEl.innerHTML = "";
    } else {
      this.renderHistoryChips();
    }
    this.inputEl.focus();
  }

  close(): void {
    this.style.display = "none";
    this.suggestionsEl.innerHTML = "";
    this.highlightIndex = -1;
  }

  setResultsLine(html: string): void {
    this.resultsLineEl.innerHTML = html;
  }

  // Called by app.js's runSearch() at the top of every submit, before it
  // knows the outcome -- the dropdown clears immediately rather than
  // staying visible under whichever message replaces it.
  clearSuggestions(): void {
    this.suggestionsEl.innerHTML = "";
    this.highlightIndex = -1;
  }

  // ---- Submit / close: decisions, dispatched outward ----

  private submit(): void {
    this.dispatchEvent(
      new CustomEvent("search-submit", {
        detail: { query: this.inputEl.value },
        bubbles: true,
      }),
    );
  }

  private requestClose(): void {
    this.dispatchEvent(
      new CustomEvent("search-close-request", { bubbles: true }),
    );
  }

  private onInputKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      const navItems = this.getNavItems();
      const highlighted = navItems[this.highlightIndex];
      if (this.highlightIndex >= 0 && highlighted) {
        highlighted.click();
      } else {
        this.submit();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      this.moveHighlight(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.moveHighlight(-1);
    } else if (e.key === "Escape") {
      // Both calls matter: preventDefault stops the input's native
      // type="search" behavior from clearing its value and repopulating
      // the dropdown we're about to clear; stopPropagation keeps app.js's
      // document-level Escape handler from unconditionally closing the
      // whole panel in the same keystroke.
      e.preventDefault();
      e.stopPropagation();
      if (this.suggestionsEl.innerHTML.trim() !== "") {
        this.suggestionsEl.innerHTML = "";
        this.highlightIndex = -1;
      } else {
        this.requestClose();
      }
    }
  }

  // ---- Autocomplete ----

  // Asynchronous: the index it used to scan client-side no longer exists
  // in the browser. Called debounced, which makes a per-keystroke request
  // reasonable; the server answers below two characters without touching
  // Postgres.
  private getSuggestions(rawQuery: string): Promise<SearchSuggestion[]> {
    const q = String(rawQuery || "").trim();
    if (normalizeForSearch(q).length < 2) {
      return Promise.resolve([]);
    }
    return fetchSearchJson("suggest", q)
      .then((body) => (body.suggestions as SearchSuggestion[]) || [])
      .catch((err) => {
        // No suggestions is a quieter failure than a broken search box --
        // submitting the query itself doesn't depend on this.
        console.error("search: suggest failed", err);
        return [];
      });
  }

  // ---- Spell correction ("did you mean") ----
  // Only ever triggered by app.js on a submitted query that returned zero
  // literal results -- never per-keystroke.
  findCorrection(q: string): Promise<string | null> {
    return fetchSearchJson("correction", q)
      .then((body) => findDidYouMean(q, (body.candidates as string[]) || []))
      .catch((err) => {
        console.error("search: correction failed", err);
        return null;
      });
  }

  // Six pool categories, two picks each, for the "Browse by" chips shown
  // alongside recent-search history on a fresh (empty) open. Reads
  // `facets`, handed over once at startup.
  private buildBrowseHint(): string[] {
    const artistPool = (this.facets.artist || [])
      .filter((e) => isRealArtist(e.value))
      .map((e) => e.value);
    const categoryPool = (this.facets.categories || []).map((e) => e.value);
    const facetPool = ([] as FacetEntry[])
      .concat(
        this.facets.region || [],
        this.facets.era || [],
        this.facets.type || [],
        this.facets.color || [],
      )
      .map((e) => e.value);
    return shuffled(artistPool)
      .slice(0, 2)
      .concat(shuffled(categoryPool).slice(0, 2))
      .concat(shuffled(facetPool).slice(0, 2));
  }

  private highlightMatch(value: string, rawQuery: string): string {
    const normValue = normalizeForSearch(value);
    const normQuery = normalizeForSearch(rawQuery.trim());
    const idx = normQuery ? normValue.indexOf(normQuery) : -1;
    if (idx === -1) return escapeHtml(value);
    return `${escapeHtml(
      value.slice(0, idx),
    )}<mark>${escapeHtml(value.slice(idx, idx + normQuery.length))}</mark>${escapeHtml(
      value.slice(idx + normQuery.length),
    )}`;
  }

  private renderHistoryChips(): void {
    let html = "";
    if (this.history.length > 0) {
      html += `<div class="search-history-label">Recent searches</div><div class="search-history-chips">${this.history
        .map(
          (q) =>
            `<button type="button" class="search-history-chip">${CLOCK_SVG}<span>${escapeHtml(q)}</span></button>`,
        )
        .join("")}</div>`;
    }
    const hintTerms = this.buildBrowseHint();
    if (hintTerms.length > 0) {
      html += `<div class="search-hint-label">Browse by</div><div class="search-hint-chips">${hintTerms
        .map(
          (term) =>
            `<button type="button" class="search-hint-chip"><span>${escapeHtml(term)}</span></button>`,
        )
        .join("")}</div>`;
    }
    if (!html) {
      this.suggestionsEl.innerHTML = "";
      return;
    }
    this.suggestionsEl.innerHTML = html;
    this.suggestionsEl
      .querySelectorAll<HTMLButtonElement>(".search-history-chip")
      .forEach((chip, i) => {
        on(chip, () => {
          this.inputEl.value = this.history[i];
          this.submit();
        });
      });
    this.suggestionsEl
      .querySelectorAll<HTMLButtonElement>(".search-hint-chip")
      .forEach((chip, i) => {
        on(chip, () => {
          this.inputEl.value = hintTerms[i];
          this.submit();
        });
      });
  }

  private renderAutocomplete(rawValue: string): void {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      this.renderHistoryChips();
      return;
    }
    if (trimmed.length < 2) {
      this.suggestionsEl.innerHTML = "";
      return;
    }
    // The input value is re-checked on arrival: a slow response can land
    // after the visitor has typed on, and stale suggestions under a
    // newer query are worse than none.
    this.getSuggestions(trimmed).then((suggestions) => {
      if (this.inputEl.value.trim() !== trimmed) return;
      if (suggestions.length === 0) {
        this.suggestionsEl.innerHTML = "";
        return;
      }
      const groups: Record<string, SearchSuggestion[]> = {};
      const order: string[] = [];
      suggestions.forEach((s) => {
        if (!groups[s.type]) {
          groups[s.type] = [];
          order.push(s.type);
        }
        groups[s.type].push(s);
      });
      const html = order
        .map(
          (type) =>
            `<div class="search-suggestion-group-label">${escapeHtml(type)}</div><ul class="search-suggestion-list">${groups[
              type
            ]
              .map(
                (entry) =>
                  `<li><button type="button" class="search-suggestion-item"><span>${this.highlightMatch(entry.value, trimmed)}</span><span class="search-suggestion-count">${entry.itemCount}</span></button></li>`,
              )
              .join("")}</ul>`,
        )
        .join("");
      this.suggestionsEl.innerHTML = html;
      const flatEntries = order.reduce<SearchSuggestion[]>(
        (acc, type) => acc.concat(groups[type]),
        [],
      );
      this.suggestionsEl
        .querySelectorAll<HTMLButtonElement>(".search-suggestion-item")
        .forEach((btn, i) => {
          on(btn, () => {
            this.inputEl.value = flatEntries[i].value;
            this.submit();
          });
        });
    });
  }

  private getNavItems(): HTMLElement[] {
    return Array.from(
      this.suggestionsEl.querySelectorAll<HTMLElement>(
        ".search-suggestion-item, .search-history-chip, .search-hint-chip",
      ),
    );
  }

  private moveHighlight(delta: number): void {
    const navItems = this.getNavItems();
    if (navItems.length === 0) return;
    this.highlightIndex =
      (((this.highlightIndex + delta) % navItems.length) + navItems.length) %
      navItems.length;
    navItems.forEach((btn, i) => {
      btn.classList.toggle("highlighted", i === this.highlightIndex);
    });
    navItems[this.highlightIndex].scrollIntoView({ block: "nearest" });
  }

  // ---- Recent-search history (sessionStorage) ----

  private loadHistory(): string[] {
    try {
      const raw = sessionStorage.getItem(SEARCH_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Called once a submitted query actually produces results -- history
  // only records searches that went somewhere.
  pushHistory(q: string): void {
    const normalized = normalizeForSearch(q);
    this.history = this.history.filter(
      (entry) => normalizeForSearch(entry) !== normalized,
    );
    this.history.unshift(q);
    this.history = this.history.slice(0, SEARCH_HISTORY_MAX);
    try {
      sessionStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      /* private-browsing quota etc -- history just won't persist this tab */
    }
  }
}

customElements.define("tranquilo-search-bar", TranquiloSearchBar);
