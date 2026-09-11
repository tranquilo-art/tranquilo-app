// The top bar (wordmark, music/search/discover/collection toggles, the
// category chip row and its overflow menu, and the filter banner), as a
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
import type { ITopbarHost } from "../types/ITopbarHost";
import { on } from "../utils/on";

const TOPBAR_MARKUP = `
<div class="topbar-row1">
  <a class="wordmark" href="/" aria-label="Tranquilo, back to the top"><img class="wordmark-mark" src="${tranquiloFlowerVioletUrl}" alt="" width="30" height="41" aria-hidden="true"><span>Tranquilo</span></a>
  <div class="topbar-icons">
    <button class="music-toggle" id="musicToggle" type="button" aria-pressed="false" aria-label="Toggle music">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
    </button>
    <button class="search-toggle" id="searchToggle" type="button" aria-label="Search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
    </button>
    <button class="discover-toggle" id="discoverToggle" type="button" aria-label="Discover shelves">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
    </button>
    <button class="collection-toggle" id="collectionToggle" type="button" aria-label="My Collection">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg><span class="collection-count" id="collectionCount" aria-hidden="true"></span>
    </button>
  </div>
</div>
<nav class="chips" id="chips"></nav>
<div class="filter-banner" id="filterBanner" style="display:none;">
  <span id="filterBannerLabel"></span>
  <button id="filterBannerExport" type="button" style="display:none;">Export</button>
  <button id="filterBannerClear" type="button">Show all &times;</button>
</div>
`;

export class TranquiloTopbar extends HTMLElement {
  app: ITopbarHost | null = null;

  private chipsEl!: HTMLElement;
  private filterBannerEl!: HTMLElement;
  private filterBannerLabelEl!: HTMLElement;
  private filterBannerExportEl!: HTMLButtonElement;
  private musicToggleEl!: HTMLButtonElement;
  private searchToggleEl!: HTMLButtonElement;
  private collectionToggleEl!: HTMLButtonElement;
  private collectionCountEl!: HTMLElement;

  // The chips row's overflow ("More") menu. .chips is overflow-x:auto
  // with the scrollbar suppressed, unreachable with a mouse, so past
  // 720px wide this menu keeps the row one line tall instead of wrapping.
  // Mobile is untouched, since swiping is correct on touch there.
  private chipsMoreBtn: HTMLButtonElement | null = null;
  private chipsMoreMenu: HTMLDivElement | null = null;
  private chipsReflowTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private filterBannerResizeObserver: ResizeObserver | null = null;

  // Throws a clear error instead of a silent null if TOPBAR_MARKUP and a
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

    this.innerHTML = TOPBAR_MARKUP;
    this.chipsEl = this.requireEl<HTMLElement>("#chips");
    this.filterBannerEl = this.requireEl<HTMLElement>("#filterBanner");
    this.filterBannerLabelEl =
      this.requireEl<HTMLElement>("#filterBannerLabel");
    this.filterBannerExportEl = this.requireEl<HTMLButtonElement>(
      "#filterBannerExport",
    );
    this.musicToggleEl = this.requireEl<HTMLButtonElement>("#musicToggle");
    this.searchToggleEl = this.requireEl<HTMLButtonElement>("#searchToggle");
    this.collectionToggleEl =
      this.requireEl<HTMLButtonElement>("#collectionToggle");
    this.collectionCountEl = this.requireEl<HTMLElement>("#collectionCount");
    const discoverToggleEl =
      this.requireEl<HTMLButtonElement>("#discoverToggle");
    const filterBannerClearEl =
      this.requireEl<HTMLButtonElement>("#filterBannerClear");

    on(this.musicToggleEl, () => this.app?.onMusicToggle());
    on(this.searchToggleEl, () => this.app?.onSearchToggle());
    on(discoverToggleEl, () => this.app?.onDiscoverToggle());
    on(this.collectionToggleEl, () => this.app?.onCollectionToggle());
    on(filterBannerClearEl, () => this.app?.onFilterBannerClear());
    on(this.filterBannerExportEl, () => this.app?.onFilterBannerExport());

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
    if (typeof ResizeObserver !== "undefined") {
      this.filterBannerResizeObserver = new ResizeObserver(() => {
        if (this.filterBannerEl.style.display !== "none") {
          document.documentElement.style.setProperty(
            "--filter-banner-h",
            `${this.filterBannerEl.offsetHeight}px`,
          );
        }
      });
      this.filterBannerResizeObserver.observe(this.filterBannerEl);
    }

    on(window, "resize", () => {
      if (this.chipsReflowTimer) clearTimeout(this.chipsReflowTimer);
      this.chipsReflowTimer = setTimeout(() => {
        this.reflowChips();
        this.positionChipsMenu();
      }, 120);
    });
  }

  // ---- Chips ----

  // `categories` is passed in on every call and this rebuilds the whole
  // row, which is why setCollectionCount() avoids calling this: rebuilding
  // resets the row's horizontal scroll, and saving an item shouldn't snap
  // a mid-browse chip row back to the start.
  setChips(
    categories: readonly string[],
    activeCategory: string,
    opts: { collectionActive: boolean; storylineActive: boolean },
  ): void {
    this.chipsEl.innerHTML = "";
    categories.forEach((cat) => {
      const chip = document.createElement("button");
      chip.className = `chip${cat === activeCategory && !opts.collectionActive ? " active" : ""}`;
      chip.textContent = cat;
      on(chip, () => this.app?.onCategorySelect(cat));
      this.chipsEl.appendChild(chip);
    });

    // The Storyline toggle sits at the end of the same row, singular to
    // match the item-level chip's wording.
    const storylineChip = document.createElement("button");
    storylineChip.id = "storylineChip";
    // No bespoke class: .chip.active already reads as related to the
    // item-level chip's own active color without inventing a variant.
    storylineChip.className = `chip${opts.storylineActive ? " active" : ""}`;
    storylineChip.textContent = "Storyline";
    storylineChip.setAttribute(
      "aria-pressed",
      opts.storylineActive ? "true" : "false",
    );
    on(storylineChip, () => this.app?.onStorylineFilterToggle());
    this.chipsEl.appendChild(storylineChip);
    this.reflowChips();
  }

  private chipsOverflowEnabled(): boolean {
    return window.matchMedia("(min-width: 720px)").matches;
  }

  private closeChipsMenu(): void {
    if (this.chipsMoreMenu) this.chipsMoreMenu.hidden = true;
    if (this.chipsMoreBtn)
      this.chipsMoreBtn.setAttribute("aria-expanded", "false");
  }

  // Both nodes are always created together (first call only) -- returning
  // them lets callers use a local, non-null reference instead of
  // re-reading the nullable instance fields.
  private ensureChipsMoreNodes(): {
    btn: HTMLButtonElement;
    menu: HTMLDivElement;
  } {
    if (this.chipsMoreBtn && this.chipsMoreMenu) {
      return { btn: this.chipsMoreBtn, menu: this.chipsMoreMenu };
    }

    const menu = document.createElement("div");
    menu.id = "chipsMoreMenu";
    menu.hidden = true;
    // Appended to the topbar host, not .chips: .chips is an overflow
    // container and would clip a panel inside it.
    this.appendChild(menu);

    const btn = document.createElement("button");
    btn.id = "chipsMore";
    btn.type = "button";
    btn.className = "chip chip-more";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "More";
    on(btn, (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) this.positionChipsMenu();
    });

    on(document, (e) => {
      if (menu.hidden) return;
      if (menu.contains(e.target as Node) || btn.contains(e.target as Node))
        return;
      this.closeChipsMenu();
    });
    on(document, "keydown", (e) => {
      if (e.key === "Escape") this.closeChipsMenu();
    });

    this.chipsMoreBtn = btn;
    this.chipsMoreMenu = menu;
    return { btn, menu };
  }

  // Anchors the panel under the button that summons it. Measured in JS
  // since the panel can't live inside .chips, so there's no positioned
  // ancestor that tracks the button.
  private positionChipsMenu(): void {
    if (!this.chipsMoreMenu || !this.chipsMoreBtn || this.chipsMoreMenu.hidden)
      return;
    const btn = this.chipsMoreBtn.getBoundingClientRect();
    const bar = this.getBoundingClientRect();
    this.chipsMoreMenu.style.right = "auto";
    this.chipsMoreMenu.style.top = `${btn.bottom - bar.top + 6}px`;
    this.chipsMoreMenu.style.left = `${btn.left - bar.left}px`;
    // Clamp to the viewport: a menu from a button near the right edge
    // would otherwise run off the screen.
    const menu = this.chipsMoreMenu.getBoundingClientRect();
    const overflowRight = menu.right - (window.innerWidth - 12);
    if (overflowRight > 0) {
      this.chipsMoreMenu.style.left = `${btn.left - bar.left - overflowRight}px`;
    }
  }

  // Moves trailing category chips into the menu until the row fits on one
  // line. "All" stays put, since it's the reset, and so does the
  // Storyline toggle, a different kind of control.
  private reflowChips(): void {
    if (!this.chipsEl) return;
    // Put everything back in the row before measuring. Never clear the
    // menu by wiping innerHTML: this also runs on resize without a
    // preceding setChips(), so parked chips are the only copies of themselves.
    const returnChipsToRow = () => {
      const menu = this.chipsMoreMenu;
      if (!menu) return;
      const parked = Array.from(menu.children);
      const anchor = this.querySelector("#storylineChip");
      for (const child of parked) {
        this.chipsEl.insertBefore(child, anchor || this.chipsMoreBtn || null);
      }
    };

    if (!this.chipsOverflowEnabled()) {
      returnChipsToRow();
      if (this.chipsMoreBtn?.parentNode) this.chipsMoreBtn.remove();
      this.closeChipsMenu();
      return;
    }
    const { btn: moreBtn, menu: moreMenu } = this.ensureChipsMoreNodes();
    returnChipsToRow();
    this.closeChipsMenu();
    this.chipsEl.appendChild(moreBtn);
    moreBtn.hidden = false;

    const movable = () =>
      Array.from(this.chipsEl.children).filter((c) => {
        // Never bury the active filter -- otherwise the only indication
        // of what's filtering the page hides inside a closed menu, and
        // picking from the menu would make the chosen chip vanish back
        // into it.
        return (
          c !== moreBtn &&
          c.id !== "storylineChip" &&
          c.textContent !== "All" &&
          !c.classList.contains("active")
        );
      });
    // Guard against a pathological loop: at most one pass per chip.
    let budget = movable().length;
    while (
      budget-- > 0 &&
      this.chipsEl.scrollWidth > this.chipsEl.clientWidth + 1
    ) {
      const candidates = movable();
      if (!candidates.length) break;
      const last = candidates[candidates.length - 1];
      moreMenu.insertBefore(last, moreMenu.firstChild);
    }

    const overflowed = moreMenu.children.length > 0;
    moreBtn.hidden = !overflowed;
    if (!overflowed && moreBtn.parentNode) moreBtn.remove();
  }

  // ---- Filter banner ----
  // The chips row is suppressed while a filter banner is up, since the
  // banner already says what the feed is showing. display:none (not
  // visibility:hidden) collapses the row's height, and --topbar-h is
  // written synchronously rather than waiting for the ResizeObserver, so
  // whatever sits below moves up in the same frame.
  private setChipsHidden(hidden: boolean): void {
    this.chipsEl.style.display = hidden ? "none" : "";
    document.documentElement.style.setProperty(
      "--topbar-h",
      `${this.offsetHeight}px`,
    );
  }

  // Full show: label, layout, hides the chip row, sizes --filter-banner-h.
  // app.js still owns the surrounding feed-scroll compensation; this only
  // does the topbar's own part of that synchronous DOM write.
  showFilterBanner(html: string): void {
    this.filterBannerLabelEl.innerHTML = html;
    this.filterBannerEl.style.display = "flex";
    this.setChipsHidden(true);
    document.documentElement.style.setProperty(
      "--filter-banner-h",
      `${this.filterBannerEl.offsetHeight}px`,
    );
  }

  // Full hide: also resets the export button and restores the chip row.
  hideFilterBanner(): void {
    this.filterBannerEl.style.display = "none";
    this.filterBannerExportEl.style.display = "none";
    this.setChipsHidden(false);
  }

  // A raw display toggle, short of hideFilterBanner()'s full reset --
  // app.js's openSearch() uses this to hide the banner while the search
  // panel covers that space without losing the export button's visibility
  // or the remembered label, both restored once the panel closes.
  setFilterBannerVisible(visible: boolean): void {
    this.filterBannerEl.style.display = visible ? "flex" : "none";
  }

  setFilterBannerExportVisible(visible: boolean): void {
    this.filterBannerExportEl.style.display = visible ? "inline-block" : "none";
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
      n === 0
        ? "My Collection, empty"
        : `My Collection, ${n} ${n === 1 ? "item" : "items"}`,
    );
  }
}

customElements.define("tranquilo-topbar", TranquiloTopbar);
