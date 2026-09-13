// "Set of works" mode -- a small overlay showing every member of a Set of
// works side by side, each with the trait that makes it a genuinely
// different object, as a native custom element.
//
// Deliberately not a mirror of <tranquilo-storyline-mode>: that component
// is a scroll-snap chapter track for a narrative sequence of arbitrary
// length, while a Set of works is 2-3 items with no narrative arc and no
// share-URL scheme, so this carries a plain flex/grid of member panels
// with no scroll tracking.
//
// Same property-assignment host as every other overlay
// (`setOfWorksModeEl.app = {...}`), same reason. This host is smaller
// than ITranquiloStorylineModeHost: "View details" calls
// host.openDetailModal(item) directly rather than an open-detail/handoff
// round trip, since a one-way trip is enough for a 2-3-item comparison.
//
// Renders into light DOM: every style already lives in css/.

import { escapeHtml } from "../feed/slideBuilder";
import type { ITranquiloSetOfWorksModeHost } from "../types/ITranquiloSetOfWorksModeHost";
import type { Item } from "../types/Item";
import type { SetOfWorkMember } from "../types/SetOfWork";

const SET_OF_WORKS_MARKUP = `
<div class="set-of-works-header">
  <div class="set-of-works-header-title" id="setOfWorksHeaderTitle"></div>
  <button class="set-of-works-close" id="setOfWorksClose" type="button" aria-label="Close">&times;</button>
</div>
<div class="set-of-works-panels" id="setOfWorksPanels"></div>
`;

export class TranquiloSetOfWorksMode extends HTMLElement {
  app: ITranquiloSetOfWorksModeHost | null = null;

  private headerTitleEl!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private panelsEl!: HTMLElement;

  // Which set's resolve fetch is in flight, or null -- same guard as
  // TranquiloStorylineMode.ts's pendingStorylineId: a superseded request
  // must be dropped instead of rendering into panels the reader already
  // left.
  private pendingSetOfWorkId: string | null = null;

  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) {
      throw new Error(
        `<tranquilo-set-of-works-mode>: missing ${selector} in its own template`,
      );
    }
    return el;
  }

  private requireApp(): ITranquiloSetOfWorksModeHost {
    if (!this.app) {
      throw new Error(
        "<tranquilo-set-of-works-mode>: called before app was set",
      );
    }
    return this.app;
  }

  connectedCallback(): void {
    if (this.getAttribute("data-set-of-works-mode-mounted") === "1") return;
    this.setAttribute("data-set-of-works-mode-mounted", "1");

    this.innerHTML = SET_OF_WORKS_MARKUP;
    this.headerTitleEl = this.requireEl("#setOfWorksHeaderTitle");
    this.closeBtn = this.requireEl<HTMLButtonElement>("#setOfWorksClose");
    this.panelsEl = this.requireEl("#setOfWorksPanels");

    this.closeBtn.addEventListener("click", () => {
      this.requireApp().requestOverlayClose(() => this.close());
    });
  }

  private showLoadingSkeleton(): void {
    this.headerTitleEl.textContent = "";
    this.panelsEl.innerHTML =
      '<div class="set-of-works-loading" aria-hidden="true"></div>';
  }

  private buildMemberPanel(item: Item, member: SetOfWorkMember): HTMLElement {
    const host = this.requireApp();
    const panel = document.createElement("div");
    panel.className = "set-of-works-panel";
    const artistLine = item.artist
      ? `<span class="artist">${escapeHtml(item.artist)}</span>`
      : "";
    const dateLine = item.date
      ? `<span class="sep">&middot;</span>${escapeHtml(item.date)}`
      : "";
    panel.innerHTML =
      `<div class="set-of-works-frame"><img src="${item.img}" alt="${escapeHtml(item.title || "Untitled")}"></div>` +
      `<h3 class="set-of-works-title">${escapeHtml(item.title || "Untitled")}</h3>` +
      `<p class="set-of-works-meta">${artistLine}${dateLine}</p>` +
      `<p class="set-of-works-trait">${escapeHtml(member.distinguishing_trait)}</p>` +
      `<button type="button" class="set-of-works-details-btn">View details &rarr;</button>`;
    const frame = panel.querySelector(".set-of-works-frame") as HTMLElement;
    host.applyNudityGate(frame, item, true);
    const frameImg = frame.querySelector("img") as HTMLImageElement;
    frameImg.addEventListener("click", () => {
      if (frame.classList.contains("nudity-gated")) return;
      host.openLightbox(item.img, item.title || "Untitled", item);
    });
    const detailsBtn = panel.querySelector(
      ".set-of-works-details-btn",
    ) as HTMLButtonElement;
    detailsBtn.addEventListener("click", () => {
      // A one-way trip -- close this mode, then open the item's detail
      // panel, unlike the storyline chapter's round-trip handoff.
      this.close();
      host.openDetailModal(item);
    });
    return panel;
  }

  open(setOfWorkId: string): void {
    const host = this.requireApp();
    const setOfWork = host.getSetOfWorkDetail(setOfWorkId);

    // Full content is fetched lazily, one set at a time, unlike the
    // lightweight index the feed chip already has. Not cached means not
    // fetched, so kick that off and show a loading skeleton meanwhile;
    // re-invoking open() once it resolves is the same self-recursion
    // pattern TranquiloStorylineMode.ts uses.
    if (!setOfWork) {
      this.pendingSetOfWorkId = setOfWorkId;
      this.showLoadingSkeleton();
      if (!this.classList.contains("open")) {
        this.classList.add("open");
        this.setAttribute("aria-hidden", "false");
        host.pushOverlayHistoryState("set-of-works");
      }
      host.resolveSetOfWorkDetail(setOfWorkId).then((resolved) => {
        // A newer open() call superseded this fetch -- drop a stale
        // result rather than rendering into panels the reader already
        // left. close() clears pendingSetOfWorkId for this check.
        if (this.pendingSetOfWorkId !== setOfWorkId) return;
        if (!resolved) {
          this.close();
          return;
        }
        this.open(setOfWorkId);
      });
      return;
    }
    this.pendingSetOfWorkId = null;

    // A set's members are items the feed's recycling window has no
    // reason to have hydrated -- fetch them first or a panel renders a
    // blank frame.
    const memberIds = setOfWork.items.map((m) => m.id);
    const memberItems = memberIds
      .map((id) => host.getItem(id))
      .filter((i): i is Item => !!i);
    if (
      memberItems.length !== memberIds.length ||
      memberItems.some((i) => !i._full)
    ) {
      host.resolveItemsByIds(memberIds).then(() => {
        this.open(setOfWorkId);
      });
      return;
    }

    host.trackEvent("set_of_work_open", { set_of_work_id: setOfWorkId });
    this.headerTitleEl.textContent = setOfWork.title;
    this.panelsEl.innerHTML = "";
    setOfWork.items.forEach((member) => {
      const item = host.getItem(member.id);
      if (!item) return;
      this.panelsEl.appendChild(this.buildMemberPanel(item, member));
    });
    if (!this.classList.contains("open")) {
      this.classList.add("open");
      this.setAttribute("aria-hidden", "false");
      host.pushOverlayHistoryState("set-of-works");
    }
  }

  close(): void {
    this.classList.remove("open");
    this.setAttribute("aria-hidden", "true");
    // Invalidates any in-flight resolveSetOfWorkDetail() via open()'s guard.
    this.pendingSetOfWorkId = null;
  }
}

customElements.define("tranquilo-set-of-works-mode", TranquiloSetOfWorksMode);
