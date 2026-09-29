// The top bar (wordmark, the search/discover/collection/music button group, the
// Category and Palette filter dropdowns, and the filter banner), as a
// native custom element.
//
// app.ts hands it a plain object implementing ITopbarHost via a property
// assignment, not an attribute, since HTML attributes can only hold
// strings and this needs live functions. The topbar calls into that
// object on every interaction; app.ts calls back into the topbar via the
// setter methods below whenever its own state changes. Neither side
// reaches into the other's internals.
//
// Renders into light DOM: every style already lives in css/style.css.
// Light DOM also keeps every id this file renders reachable via plain
// getElementById, both from app.js's remaining direct references and the
// existing Playwright suite.

// A real asset import, not a hardcoded "/assets/..." path -- Vite hashes
// build output filenames, so a string literal in a template can't resolve
// once bundled. This gives the real, current URL either way.
import tranquiloFlowerVioletUrl from "../../assets/tranquilo-flower-violet.svg";
import type { ArtistProfile } from "../data/artist-profiles";
import {
  currentLocale,
  facetLabel,
  pagePath,
  setLocale,
  switcherLocales,
  t,
  tn,
} from "../i18n/index";
import type { ITopbarHost } from "../types/ITopbarHost";
import { on } from "../utils/on";

// Duplicated rather than imported from app.ts/slideBuilder.ts: small,
// fully static, cheaper to copy once than to add an import for -- same
// call TranquiloDetailModal.ts already made for its own copy.
function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Built when the element mounts (not at module load) and escaped on the way
// in: text comes from src/i18n, and translations are contributed text that
// must never be parsed as markup. The icon buttons repeat their label as a
// title so a pointer user gets a hover tooltip; the collection button's
// aria-label later gains a count (setCollectionCount), its title doesn't.
const h = (s: string) => escapeHtml(s);
const topbarMarkup = () => `
<div class="share-banner" id="shareBanner" style="display:none;">
  <span>${h(t("topbar.shareBanner.text"))}</span>
  <div class="share-banner-actions">
    <button id="shareBannerNewsletter" type="button" data-open-newsletter><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 6-10 7L2 6"></path></svg>${h(t("topbar.shareBanner.newsletter"))}</button>
    <a id="shareBannerInvolved" href="${pagePath("get-involved.html")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>${h(t("topbar.shareBanner.involved"))}</a>
    <button id="shareBannerClose" type="button" aria-label="${h(t("topbar.shareBanner.dismiss"))}">&times;</button>
  </div>
</div>
<div class="topbar-row1">
  <a class="wordmark" href="/" aria-label="${h(t("topbar.home"))}"><img class="wordmark-mark" src="${tranquiloFlowerVioletUrl}" alt="" width="30" height="41" aria-hidden="true"><span>Tranquilo</span></a>
  <div class="topbar-icons" role="group">
    <button class="search-toggle" id="searchToggle" type="button" aria-label="${h(t("topbar.search"))}" title="${h(t("topbar.search"))}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
    </button>
    <button class="discover-toggle" id="discoverToggle" type="button" aria-label="${h(t("topbar.discover"))}" title="${h(t("topbar.discover"))}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
    </button>
    <button class="collection-toggle" id="collectionToggle" type="button" aria-label="${h(t("topbar.collection.label"))}" title="${h(t("topbar.collection.label"))}">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg><span class="collection-count" id="collectionCount" aria-hidden="true"></span>
    </button>
    <button class="music-toggle" id="musicToggle" type="button" aria-pressed="false" aria-label="${h(t("topbar.music"))}" title="${h(t("topbar.music"))}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
    </button>${languageToggleMarkup()}
  </div>
</div>
<nav class="chips" id="chips"></nav>
<div class="filter-banner" id="filterBanner" style="display:none;">
  <span class="filter-banner-pill">
    <span id="filterBannerLabel"></span>
    <button id="filterBannerClear" type="button" aria-label="${h(t("topbar.filter.clear"))}">&times;</button>
  </span>
  <button id="filterBannerExport" type="button" style="display:none;">${h(t("topbar.filter.export"))}</button>
</div>
<div class="filter-banner-card" id="filterBannerCard" style="display:none;"></div>
`;

// The language switcher's globe closes the icon group. Icon-only, like its
// neighbours, so a longer translation can't push the top bar onto another
// line on a phone; the menu lists languages by their own names (never
// flags, which name countries), so it grows to any number of them. Not
// rendered at all when there is nothing to switch to -- see
// switcherLocales() for which languages appear.
function languageToggleMarkup(): string {
  if (switcherLocales().length < 2) return "";
  const name = h(t("language.label"));
  return `
    <button class="language-toggle" id="languageToggle" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="languageMenu" aria-label="${name}" title="${name}">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
    </button>`;
}

// Text already on screen was drawn in the old language and components
// don't re-render on a locale change, so a switch reloads the page.
// ?lang= is dropped first: on a preview link it would otherwise win again
// on the reload and undo the choice just made.
function switchLanguage(code: string): void {
  setLocale(code);
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  history.replaceState(history.state, "", url);
  location.reload();
}

export class TranquiloTopbar extends HTMLElement {
  app: ITopbarHost | null = null;

  private chipsEl!: HTMLElement;
  private shareBannerEl!: HTMLElement;
  private filterBannerEl!: HTMLElement;
  private filterBannerLabelEl!: HTMLElement;
  private filterBannerExportEl!: HTMLButtonElement;
  private filterBannerCardEl!: HTMLElement;
  private musicToggleEl!: HTMLButtonElement;
  private searchToggleEl!: HTMLButtonElement;
  private collectionToggleEl!: HTMLButtonElement;
  private collectionCountEl!: HTMLElement;

  private resizeObserver: ResizeObserver | null = null;
  private filterBannerResizeObserver: ResizeObserver | null = null;

  // Throws a clear error instead of a silent null if topbarMarkup() and a
  // selector below ever drift apart.
  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el)
      throw new Error(
        `<tranquilo-topbar>: missing ${selector} in its own template`,
      );
    return el;
  }

  connectedCallback(): void {
    this.classList.add("topbar");
    // The markup this replaces was a <header>, with an implicit `banner`
    // landmark role -- a custom element gets no such default.
    this.setAttribute("role", "banner");
    if (this.getAttribute("data-topbar-mounted") === "1") return;
    this.setAttribute("data-topbar-mounted", "1");

    this.innerHTML = topbarMarkup();
    this.chipsEl = this.requireEl<HTMLElement>("#chips");
    this.shareBannerEl = this.requireEl<HTMLElement>("#shareBanner");
    const shareBannerNewsletterEl = this.requireEl<HTMLButtonElement>(
      "#shareBannerNewsletter",
    );
    const shareBannerInvolvedEl = this.requireEl<HTMLAnchorElement>(
      "#shareBannerInvolved",
    );
    const shareBannerCloseEl =
      this.requireEl<HTMLButtonElement>("#shareBannerClose");
    this.filterBannerEl = this.requireEl<HTMLElement>("#filterBanner");
    this.filterBannerLabelEl =
      this.requireEl<HTMLElement>("#filterBannerLabel");
    this.filterBannerExportEl = this.requireEl<HTMLButtonElement>(
      "#filterBannerExport",
    );
    this.filterBannerCardEl = this.requireEl<HTMLElement>("#filterBannerCard");
    this.musicToggleEl = this.requireEl<HTMLButtonElement>("#musicToggle");
    this.searchToggleEl = this.requireEl<HTMLButtonElement>("#searchToggle");
    this.collectionToggleEl =
      this.requireEl<HTMLButtonElement>("#collectionToggle");
    this.collectionCountEl = this.requireEl<HTMLElement>("#collectionCount");
    const discoverToggleEl =
      this.requireEl<HTMLButtonElement>("#discoverToggle");
    const filterBannerClearEl =
      this.requireEl<HTMLButtonElement>("#filterBannerClear");

    this.setUpLanguageMenu();
    on(this.musicToggleEl, () => this.app?.onMusicToggle());
    on(this.searchToggleEl, () => this.app?.onSearchToggle());
    on(discoverToggleEl, () => this.app?.onDiscoverToggle());
    on(this.collectionToggleEl, () => this.app?.onCollectionToggle());
    on(filterBannerClearEl, () => this.app?.onFilterBannerClear());
    on(this.filterBannerExportEl, () => this.app?.onFilterBannerExport());
    on(shareBannerCloseEl, () => {
      this.hideShareBanner();
      this.app?.onShareBannerDismiss();
    });
    // Fires alongside (not instead of) TranquiloNewsletterModal's own
    // delegated [data-open-newsletter] document listener, which actually
    // opens the dialog -- this just reports the click for the funnel.
    on(shareBannerNewsletterEl, () =>
      this.app?.onShareBannerCtaClick("newsletter"),
    );
    on(shareBannerInvolvedEl, () =>
      this.app?.onShareBannerCtaClick("get_involved"),
    );

    // --topbar-h stays in sync with the topbar's actual rendered height
    // (it grows on mobile, two rows) so .search-bar/.filter-banner can
    // position below it instead of a guessed constant. Self-managed since
    // it's the topbar's own height.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        document.documentElement.style.setProperty(
          "--topbar-h",
          `${this.offsetHeight}px`,
        );
      });
      this.resizeObserver.observe(this);
    }
    // Set once synchronously too -- a ResizeObserver's first callback
    // fires on a later frame, and the search bar/filter banner position
    // off this var from the very first paint.
    document.documentElement.style.setProperty(
      "--topbar-h",
      `${this.offsetHeight}px`,
    );

    // Same pattern for --filter-banner-h: the banner can wrap to a second
    // line on a narrow viewport with a long label, so it stays
    // measurement-driven for its whole life, not just when it appears.
    // Observes both #filterBanner and #filterBannerCard (a sibling, not a
    // child -- see updateFilterBannerHeight()'s own comment on why) so the
    // feed push accounts for the card's height too, not just the row's.
    if (typeof ResizeObserver !== "undefined") {
      this.filterBannerResizeObserver = new ResizeObserver(() =>
        this.updateFilterBannerHeight(),
      );
      this.filterBannerResizeObserver.observe(this.filterBannerEl);
      this.filterBannerResizeObserver.observe(this.filterBannerCardEl);
    }

    on(document, "click", (e) => {
      if ((e.target as HTMLElement).closest(".filter-dropdown")) return;
      this.closeAllFilterDropdowns();
    });
    on(document, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") this.closeAllFilterDropdowns();
    });
  }

  // ---- Language menu ----

  // Appended to the host rather than inside .topbar-icons, which clips its
  // overflow.
  private setUpLanguageMenu(): void {
    const toggle = this.querySelector<HTMLButtonElement>("#languageToggle");
    if (!toggle) return;
    // Not <html lang>: this runs while modules are still evaluating, which
    // can be before startup has set it.
    const current = currentLocale();
    const menu = document.createElement("div");
    menu.id = "languageMenu";
    menu.hidden = true;
    menu.setAttribute("aria-label", t("language.label"));
    for (const { code, nativeName } of switcherLocales()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "chip";
      item.lang = code;
      item.textContent = nativeName;
      if (code === current) {
        item.classList.add("active");
        item.setAttribute("aria-current", "true");
      }
      on(item, () => {
        if (code === current) this.closeLanguageMenu();
        else switchLanguage(code);
      });
      menu.appendChild(item);
    }
    this.appendChild(menu);

    on(toggle, (e) => {
      e.stopPropagation();
      if (menu.hidden) this.openLanguageMenu();
      else this.closeLanguageMenu();
    });
    on(document, (e) => {
      if (menu.hidden || menu.contains(e.target as Node)) return;
      this.closeLanguageMenu();
    });
    on(document, "keydown", (e) => {
      if (e.key !== "Escape" || menu.hidden) return;
      this.closeLanguageMenu();
      toggle.focus();
    });
    on(window, "resize", () => this.positionLanguageMenu());
  }

  private openLanguageMenu(): void {
    const menu = this.querySelector<HTMLElement>("#languageMenu");
    const toggle = this.querySelector<HTMLElement>("#languageToggle");
    if (!menu || !toggle) return;
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    this.positionLanguageMenu();
    menu.querySelector<HTMLElement>("[aria-current]")?.focus();
  }

  private closeLanguageMenu(): void {
    const menu = this.querySelector<HTMLElement>("#languageMenu");
    if (menu) menu.hidden = true;
    this.querySelector("#languageToggle")?.setAttribute(
      "aria-expanded",
      "false",
    );
  }

  // Right-aligned under the globe: it sits at the screen's right edge, so a
  // left-anchored panel would run off it.
  private positionLanguageMenu(): void {
    const menu = this.querySelector<HTMLElement>("#languageMenu");
    const toggle = this.querySelector<HTMLElement>("#languageToggle");
    if (!menu || !toggle || menu.hidden) return;
    const btn = toggle.getBoundingClientRect();
    const bar = this.getBoundingClientRect();
    menu.style.top = `${btn.bottom - bar.top + 6}px`;
    menu.style.left = "auto";
    menu.style.right = `${bar.right - btn.right}px`;
  }

  // ---- Filter dropdowns ----

  private closeAllFilterDropdowns(): void {
    this.querySelectorAll(".filter-dropdown-menu").forEach((menu) => {
      (menu as HTMLElement).hidden = true;
    });
    this.querySelectorAll(".filter-dropdown-trigger").forEach((trigger) => {
      trigger.setAttribute("aria-expanded", "false");
    });
  }

  // A native <select> cannot render a colour swatch inside its options.
  private buildSwatchDropdown(config: {
    ariaLabel: string;
    defaultLabel: string;
    options: { value: string; label: string; swatch: string }[];
    activeValue: string | null;
    onSelect: (value: string | null) => void;
  }): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "filter-dropdown";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "filter-select filter-dropdown-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", config.ariaLabel);

    const menu = document.createElement("div");
    menu.className = "filter-dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    const paintTrigger = (swatch: string, label: string, active: boolean) => {
      trigger.innerHTML = "";
      const dot = document.createElement("span");
      dot.className = "filter-dropdown-swatch";
      dot.style.background = swatch;
      const text = document.createElement("span");
      text.className = "filter-dropdown-trigger-label";
      text.textContent = label;
      trigger.appendChild(dot);
      trigger.appendChild(text);
      trigger.classList.toggle("filter-select-active", active);
    };

    on(trigger, () => {
      const wasOpen = !menu.hidden;
      this.closeAllFilterDropdowns();
      if (wasOpen) return;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    });

    const addOption = (value: string, label: string, swatch: string) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "filter-dropdown-option";
      option.setAttribute("role", "option");
      option.dataset.value = value;
      const isActive = value === (config.activeValue || "");
      option.setAttribute("aria-selected", isActive ? "true" : "false");
      const dot = document.createElement("span");
      dot.className = "filter-dropdown-swatch";
      dot.style.background = swatch;
      const text = document.createElement("span");
      text.textContent = label;
      option.appendChild(dot);
      option.appendChild(text);
      on(option, () => {
        this.closeAllFilterDropdowns();
        config.onSelect(value || null);
      });
      menu.appendChild(option);
      if (isActive) paintTrigger(swatch, label, !!value);
    };

    addOption("", config.defaultLabel, "transparent");
    config.options.forEach((o) => {
      addOption(o.value, o.label, o.swatch);
    });

    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  }

  // Rebuilds the whole row on every call.
  setFilters(opts: {
    categories: readonly string[];
    activeCategory: string;
    paletteBuckets: readonly { value: string; swatch: string }[];
    activePaletteBucket: string | null;
    collectionActive: boolean;
  }): void {
    this.chipsEl.innerHTML = "";

    const categorySelect = document.createElement("select");
    categorySelect.id = "categorySelect";
    categorySelect.className = "filter-select";
    categorySelect.setAttribute("aria-label", t("filters.category"));
    opts.categories.forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat;
      option.textContent =
        cat === "All"
          ? t("filters.allCategories")
          : facetLabel("category", cat);
      categorySelect.appendChild(option);
    });
    categorySelect.value = opts.collectionActive ? "All" : opts.activeCategory;
    categorySelect.classList.toggle(
      "filter-select-active",
      categorySelect.value !== "All",
    );
    on(categorySelect, "change", () =>
      this.app?.onCategorySelect(categorySelect.value),
    );
    this.chipsEl.appendChild(categorySelect);

    const paletteDropdown = this.buildSwatchDropdown({
      ariaLabel: t("filters.palette"),
      defaultLabel: t("filters.allPalettes"),
      options: opts.paletteBuckets.map((bucket) => ({
        value: bucket.value,
        label: facetLabel("palette", bucket.value),
        swatch: bucket.swatch,
      })),
      activeValue: opts.activePaletteBucket,
      onSelect: (bucket) => this.app?.onPaletteSelect(bucket),
    });
    paletteDropdown.id = "paletteSelect";
    this.chipsEl.appendChild(paletteDropdown);
  }

  // ---- Filter banner ----

  // #filterBannerCard is a sibling of #filterBanner, not a child of it --
  // it has to render as its own full-width line at desktop widths (see its
  // CSS rule's comment), which a single row-flex item can't do while also
  // sharing a line with the wordmark/icons. That means its height isn't
  // part of #filterBanner's own offsetHeight, so --filter-banner-h (what
  // #feed.filter-push subtracts) has to sum both rather than read one.
  private updateFilterBannerHeight(): void {
    if (this.filterBannerEl.style.display === "none") return;
    const cardH =
      this.filterBannerCardEl.style.display === "none"
        ? 0
        : this.filterBannerCardEl.offsetHeight;
    document.documentElement.style.setProperty(
      "--filter-banner-h",
      `${this.filterBannerEl.offsetHeight + cardH}px`,
    );
  }

  // The filter dropdowns stay visible while the banner is up.
  showFilterBanner(html: string): void {
    this.filterBannerLabelEl.innerHTML = html;
    this.filterBannerEl.style.display = "flex";
    this.updateFilterBannerHeight();
  }

  // Full hide: also resets the export button and the artist card.
  hideFilterBanner(): void {
    this.filterBannerEl.style.display = "none";
    this.filterBannerExportEl.style.display = "none";
    this.setArtistProfile(null);
  }

  // A raw display toggle, short of hideFilterBanner()'s full reset --
  // app.js's openSearch() uses this to hide the banner (and any open card)
  // while the search panel covers that space without losing the export
  // button's visibility or the remembered label/card, both restored once
  // the panel closes.
  setFilterBannerVisible(visible: boolean): void {
    this.filterBannerEl.style.display = visible ? "flex" : "none";
    if (this.filterBannerCardEl.innerHTML) {
      this.filterBannerCardEl.style.display = visible ? "block" : "none";
    }
  }

  setFilterBannerExportVisible(visible: boolean): void {
    this.filterBannerExportEl.style.display = visible ? "inline-block" : "none";
  }

  // Renders inline, immediately -- no chevron, no click to reveal. Shown
  // for every filter mode that resolved a profile (an artist filter or a
  // search matching one by name), hidden otherwise.
  setArtistProfile(profile: ArtistProfile | null): void {
    if (profile) {
      // The inner wrapper (not #filterBannerCard itself) carries the
      // visible card's width cap -- see its CSS rule's comment.
      this.filterBannerCardEl.innerHTML = `<div class="artist-card-inner">${this.renderArtistCard(profile)}</div>`;
      this.filterBannerCardEl.style.display = "block";
      // A fresh filter always lands back on its own first result (every
      // render() path resets scrollTop), so the card should always start
      // visible -- not wherever .is-scrolled happened to be left from
      // whatever was filtered before.
      this.filterBannerCardEl.classList.remove("is-scrolled");
    } else {
      this.filterBannerCardEl.innerHTML = "";
      this.filterBannerCardEl.style.display = "none";
    }
    // The ResizeObserver on filterBannerCardEl (above) would catch this on
    // its own a frame later; calling it synchronously here avoids a
    // one-frame flash of the feed sitting under the card before it's
    // pushed down.
    this.updateFilterBannerHeight();
  }

  // Collapses the card (CSS max-height/opacity transition, see its rule)
  // once the visitor scrolls past the first result of whatever's
  // filtered, and restores it on the way back -- app.ts drives this off
  // the feed's own scrollTop, not anything this component tracks itself.
  // A no-op when there's no card to begin with: toggling a class an empty,
  // hidden #filterBannerCard doesn't have content for is harmless.
  setArtistCardScrolled(scrolled: boolean): void {
    this.filterBannerCardEl.classList.toggle("is-scrolled", scrolled);
  }

  // Loosely modeled on a search engine's knowledge panel: photo + name up
  // top, facts and a short description below, a source link last.
  private renderArtistCard(profile: ArtistProfile): string {
    const dates =
      profile.birth || profile.death
        ? `${profile.birth ?? "?"}–${profile.death ?? "?"}`
        : null;
    const nationality = profile.nationality.join(", ") || null;
    const line1 = [dates, nationality].filter(Boolean).join(" · ");
    const line2 = profile.movement.join(", ");
    const sourceHref = profile.article ?? profile.wikidata ?? null;
    const sourceLabel = profile.article
      ? t("artistCard.wikipedia")
      : t("artistCard.wikidata");
    const photoHtml = profile.image
      ? `<img class="artist-card-photo" src="${escapeHtml(profile.image)}" alt="" loading="lazy">`
      : "";
    return (
      `<div class="artist-card-row">${photoHtml}` +
      `<div class="artist-card-text">` +
      `<div class="artist-card-name">${escapeHtml(profile.name)}</div>` +
      (line1
        ? `<div class="artist-card-meta">${escapeHtml(line1)}</div>`
        : "") +
      (line2
        ? `<div class="artist-card-meta artist-card-movement">${escapeHtml(line2)}</div>`
        : "") +
      (profile.description
        ? `<p class="artist-card-bio">${escapeHtml(profile.description)}</p>`
        : "") +
      (sourceHref
        ? `<a class="artist-card-source" href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener">${escapeHtml(sourceLabel)} <span aria-hidden="true">&rarr;</span></a>`
        : "") +
      `</div></div>`
    );
  }

  // Unlike showFilterBanner/hideFilterBanner, this never touches a CSS
  // var of its own: it's plain topbar content, picked up by the existing
  // whole-topbar --topbar-h ResizeObserver above for free, and (unlike
  // --filter-banner-h/--search-bar-h) nothing subtracts its height from
  // #feed/.slide -- it's an overlay, not a push, so it never needs to know
  // its own height.
  showShareBanner(): void {
    this.shareBannerEl.style.display = "flex";
  }

  hideShareBanner(): void {
    this.shareBannerEl.style.display = "none";
  }

  // ---- Icon button state ----

  setMusicActive(on: boolean): void {
    this.musicToggleEl.classList.toggle("active", on);
    this.musicToggleEl.setAttribute("aria-pressed", on ? "true" : "false");
  }

  setSearchActive(on: boolean): void {
    this.searchToggleEl.classList.toggle("active", on);
  }

  setCollectionActive(on: boolean): void {
    this.collectionToggleEl.classList.toggle("active", on);
  }

  // The bookmark button carries three states, since it's the only way
  // into the collection now: empty (outlined, nothing else); has saved
  // items (outlined, count inside the bookmark); viewing them (filled
  // violet, like an active category chip, since it's doing the same job).
  //
  // Capped at 9+: two digits inside a 17px bookmark are unreadable, and
  // past a handful the exact number stops being the point.
  setCollectionCount(n: number): void {
    this.collectionToggleEl.classList.toggle("has-items", n > 0);
    this.collectionCountEl.textContent = n > 9 ? "9+" : n ? String(n) : "";
    // The visible count is aria-hidden, so the button's label carries it
    // for a screen reader.
    this.collectionToggleEl.setAttribute(
      "aria-label",
      n === 0 ? t("topbar.collection.empty") : tn("topbar.collection.count", n),
    );
  }
}

customElements.define("tranquilo-topbar", TranquiloTopbar);
