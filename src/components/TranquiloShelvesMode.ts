// Discover/shelves mode (named sections of horizontal rails: a
// hand-curated "hero" shelf's fixed itemIds list, or a "rule" shelf's
// generic item-field filter gated by minItems), as a native custom
// element.
//
// SHELVES is handed over as a plain property once, read-only, the same
// shape TranquiloSearchBar uses for `facets`. Uses the ShelfType enum
// rather than raw "hero"/"rule" string literals.
//
// Same property-assignment host as ITopbarHost/ITranquiloStorylineModeHost
// (`shelvesModeEl.app = {...}`), same reason. See
// src/types/ITranquiloShelvesModeHost.ts for the full contract.
//
// app.js still owns the six-overlay popstate/Escape handler and reads
// this element's classList/aria-hidden exactly as it read the plain div
// before this was a custom element.
//
// Renders into light DOM: every style already lives in css/style.css.

// A real asset import, not a hardcoded "/assets/..." path -- Vite hashes
// build output filenames, so a string literal in a template can't resolve
// once bundled. This gives the real, current URL either way.
import tranquiloFlowerVioletUrl from "../../assets/tranquilo-flower-violet.svg";
import { ShelfType } from "../enums/ShelfType";
import { shelfRenderLimit } from "../logic/logic";
import type { ITranquiloShelvesModeHost } from "../types/ITranquiloShelvesModeHost";
import type { Item } from "../types/Item";
import type { Shelf } from "../types/Shelf";
import { on } from "../utils/on";

// The overlay covers the top bar, so without a mark of its own the tulip
// would disappear the moment Discover opens. It's a real link home,
// matching the topbar wordmark's own href="/" rather than merely closing
// the overlay, so it middle-clicks and opens in a new tab too. The
// heading beside it is deliberately outside the anchor, since the title
// of the page you're on shouldn't read as a way to leave it -- so the
// anchor needs its own aria-label or it announces as nothing.
const SHELVES_MARKUP = `
<div class="shelves-header">
  <div class="shelves-header-brand">
    <a class="shelves-mark-link" href="/" aria-label="Tranquilo, back to the homepage">
      <img class="shelves-mark" src="${tranquiloFlowerVioletUrl}" alt="" aria-hidden="true" width="26" height="36">
    </a>
    <h2 class="shelves-header-title">Discover</h2>
  </div>
  <button class="shelves-close" id="shelvesClose" type="button" aria-label="Close discover">&times;</button>
</div>
<div class="shelves-body" id="shelvesBody"></div>
`;

// Matches app.js's own escapeHtml (four replacements, no apostrophe)
// rather than slideBuilder.ts's five-replacement copy, since this is the
// one buildShelfRow/renderShelves actually called.
function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// How many cards per shelf get hydrated up front -- only the first few
// are visible before scrolling, and a rule shelf can qualify hundreds of
// items, which would otherwise fetch most of the catalogue to open Discover.
const SHELF_HYDRATE_LIMIT = 12;

// How many rows a rule shelf pulls to clear its minItems gate. 200 is
// api/items.js's MAX_LIMIT and comfortably above the largest minItems in
// SHELVES (10), so the gate is answered honestly without pulling a category.
const SHELF_FETCH_LIMIT = 200;

const SHELVES_MAX_SHOWN = 10;

export class TranquiloShelvesMode extends HTMLElement {
  app: ITranquiloShelvesModeHost | null = null;
  // Handed over once by app.js, read-only.
  shelves: Shelf[] = [];

  private closeBtn!: HTMLButtonElement;
  private bodyEl!: HTMLElement;

  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) {
      throw new Error(
        `<tranquilo-shelves-mode>: missing ${selector} in its own template`,
      );
    }
    return el;
  }

  private requireApp(): ITranquiloShelvesModeHost {
    if (!this.app) {
      throw new Error("<tranquilo-shelves-mode>: called before app was set");
    }
    return this.app;
  }

  connectedCallback(): void {
    if (this.getAttribute("data-shelves-mode-mounted") === "1") return;
    this.setAttribute("data-shelves-mode-mounted", "1");

    this.innerHTML = SHELVES_MARKUP;
    this.closeBtn = this.requireEl<HTMLButtonElement>("#shelvesClose");
    this.bodyEl = this.requireEl("#shelvesBody");

    on(this.closeBtn, () => {
      this.requireApp().requestOverlayClose(() => this.close());
    });
  }

  // Both shelf types resolve server-side. A hero shelf names its
  // itemIds, the same ?ids= path the collection view and storyline
  // chapters use. A rule shelf is a generic { field: value } match
  // against api/items.js's facet whitelist -- an un-whitelisted key is a
  // 400 rather than a silently empty shelf. region_primary keeps matching
  // alternates, since the server does it the same way.
  //
  // Ordered by the same shuffle key as the feed, so a shelf is a sample
  // rather than always the same first N rows. shelfRenderLimit() caps
  // what's drawn.
  private shelfQualifyingItems(shelf: Shelf): Promise<Item[]> {
    const host = this.requireApp();
    if (shelf.type === ShelfType.Hero) {
      // Curated order is the point of a hero shelf, and resolveItemsByIds()
      // returns items in the given order, dropping any that no longer
      // resolve rather than rendering a blank card.
      return host.resolveItemsByIds(shelf.itemIds.map(String)).catch((err) => {
        console.error("items: hero shelf lookup failed", err);
        return [];
      });
    }
    const p: Record<string, unknown> = {
      shape: "manifest",
      order: "shuffle",
      start: Math.random(),
      limit: SHELF_FETCH_LIMIT,
    };
    for (const [k, v] of Object.entries(shelf.filter)) {
      p[k] = v;
    }
    return host
      .fetchJson(host.apiUrl(p), "shelf")
      .then((body) => host.absorbPage(body.items || []))
      .catch((err) => {
        console.error("items: rule shelf query failed", err);
        return [];
      });
  }

  private buildShelfRow(
    shelf: Shelf,
    qualifying: Item[],
    suppressTitle: boolean,
  ): HTMLElement {
    const host = this.requireApp();
    const row = document.createElement("div");
    row.className = "shelf";
    // A shelf whose name the section header already states doesn't
    // repeat it. Compared rather than hardcoded, so a second hero shelf
    // with its own name still labels itself.
    if (!suppressTitle) {
      const titleEl = document.createElement("div");
      titleEl.className = "shelf-title";
      titleEl.textContent = shelf.title;
      row.appendChild(titleEl);
    }
    const track = document.createElement("div");
    track.className = "shelf-row";
    // Render exactly what was hydrated, no more. The cap applies to
    // rule-qualified shelves, not a curated list, since a hand-built
    // shelf's newest entry is the one most worth seeing.
    const renderCount = shelfRenderLimit(
      shelf,
      qualifying.length,
      SHELF_HYDRATE_LIMIT,
    );
    qualifying.slice(0, renderCount).forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.className = "shelf-item";
      btn.type = "button";
      // Storyline tiles get a distinct stack visual (the same "there's
      // more here" cue as the in-feed storyline stack layers) plus an "N
      // works" subtitle, so they read as different from a regular tile
      // at a glance.
      const storyline =
        shelf.id === "storylines" ? host.storylineFor(item) : null;
      const imgHtml = `<img src="${item.img}" alt="${escapeHtml(item.title || "Untitled")}">`;
      btn.innerHTML = `${
        storyline
          ? `<div class="shelf-item-stack"><div class="shelf-item-stack-ghost layer-1"></div><div class="shelf-item-stack-ghost layer-2"></div>${imgHtml}</div>`
          : imgHtml
      }<div class="shelf-item-title">${escapeHtml(item.title || "Untitled")}</div>${
        storyline
          ? `<div class="shelf-item-subtitle">${storyline.items.length} works</div>`
          : ""
      }`;
      host.applyNudityGate(btn, item, true);
      on(btn, () => {
        this.close();
        host.openDetailModal(item, { items: qualifying, index: idx });
      });
      track.appendChild(btn);
    });
    row.appendChild(track);
    return row;
  }

  private render(): void {
    const host = this.requireApp();
    this.bodyEl.innerHTML = "";
    // Every shelf is a server question, so the whole set resolves before
    // any of it is drawn. Promise.all rather than sequentially, since the
    // shelves are independent.
    Promise.all(
      this.shelves.map((shelf) =>
        this.shelfQualifyingItems(shelf).then((items) => ({ shelf, items })),
      ),
    )
      .then((resolved) => {
        const qualified = resolved.filter((entry) => {
          const floor =
            entry.shelf.type === ShelfType.Rule ? entry.shelf.minItems || 0 : 1;
          return entry.items.length >= floor;
        });
        // Shelf cards render item.img, which only exists on a hydrated
        // item; the qualifying sets come from facets the manifest does
        // carry, so the rows are correct, just missing pictures.
        const shown: Item[] = [];
        qualified.forEach((e) => {
          // Must use the same count buildShelfRow will render, or extra
          // cards come from unhydrated items as `<img src="undefined">`.
          const count = shelfRenderLimit(
            e.shelf,
            e.items.length,
            SHELF_HYDRATE_LIMIT,
          );
          e.items.slice(0, count).forEach((i) => {
            shown.push(i);
          });
        });
        if (shown.some((i) => !i._full)) {
          host.hydrateItems(shown).then(() => this.render());
          return;
        }
        // Two named sections rather than one stack, split on the
        // storylines shelf: one carries narrative sequences someone
        // wrote, the rest are moods.
        const storyline = qualified.filter((e) => e.shelf.id === "storylines");
        const moods = qualified
          .filter((e) => e.shelf.id !== "storylines")
          .sort((a, b) => {
            // Hand-picked shelves keep their authored order; rule-built
            // ones sort by size behind them, as they did before.
            if (a.shelf.type !== b.shelf.type) {
              return a.shelf.type === ShelfType.Hero ? -1 : 1;
            }
            if (a.shelf.type === ShelfType.Rule) {
              return b.items.length - a.items.length;
            }
            return 0;
          });
        let budget = SHELVES_MAX_SHOWN;
        const section = (
          title: string,
          subtitle: string,
          entries: { shelf: Shelf; items: Item[] }[],
        ): void => {
          if (!entries.length || budget <= 0) return;
          const head = document.createElement("div");
          head.className = "shelf-section";
          const h = document.createElement("h3");
          h.className = "shelf-section-title";
          h.textContent = title;
          const p = document.createElement("p");
          p.className = "shelf-section-sub";
          p.textContent = subtitle;
          head.appendChild(h);
          head.appendChild(p);
          this.bodyEl.appendChild(head);
          entries.slice(0, budget).forEach((entry) => {
            this.bodyEl.appendChild(
              this.buildShelfRow(
                entry.shelf,
                entry.items,
                entry.shelf.title === title,
              ),
            );
            budget--;
          });
        };
        section("Storylines", "Curated stories behind the art", storyline);
        section("Shelves, Curated by Hand", "Pick a mood and enjoy", moods);
      })
      .catch((err) => {
        console.error("items: shelves failed to render", err);
      });
  }

  // Reported externally as "Explore visits" -- this Discover/shelves
  // surface is what that name refers to.
  open(): void {
    const host = this.requireApp();
    host.trackEvent("discover_open", {});
    this.render();
    this.classList.add("open");
    this.setAttribute("aria-hidden", "false");
    host.pushOverlayHistoryState("shelves");
  }

  close(): void {
    this.classList.remove("open");
    this.setAttribute("aria-hidden", "true");
  }

  // Reopens without re-rendering or re-pushing history, for
  // <tranquilo-detail-modal>'s close() when reached by stepping aside
  // from a shelf card -- DOM/scroll position was never touched, so this
  // restores exactly what was there.
  restore(): void {
    this.classList.add("open");
    this.setAttribute("aria-hidden", "false");
  }
}

customElements.define("tranquilo-shelves-mode", TranquiloShelvesMode);
