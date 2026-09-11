// Storyline mode (intro "trailer" page plus one chapter per item,
// horizontal scroll-snap navigation, a dot timeline), as a native custom
// element. escapeHtml/SHARE_SVG are imported from slideBuilder.ts rather
// than duplicated.
//
// Storyline content is fetched from Postgres, not a module-level constant
// -- open() fetches lazily through the host.
//
// Same property-assignment host as ITopbarHost/ITranquiloDetailModalHost
// (`storylineModeEl.app = {...}`), same reason. See
// src/types/ITranquiloStorylineModeHost.ts for the full contract.
//
// One exception, same shape as ITranquiloDetailModalHost's storyline-
// handoff events: opening the detail panel from a chapter is not part of
// that host, since neither component owns the other. This element
// dispatches "open-detail" on itself (see openDetailFromChapter()); app.js
// relays it into <tranquilo-detail-modal>'s storyline-handoff-open event.
//
// app.js still owns the six-overlay popstate/Escape handler and reads this
// element's classList/aria-hidden exactly as it read the plain div before
// this was a custom element -- see TranquiloLightbox.ts's header.
//
// Renders into light DOM: every style already lives in css/style.css.

import { escapeHtml, SHARE_SVG } from "../feed/slideBuilder";
import type { ITranquiloStorylineModeHost } from "../types/ITranquiloStorylineModeHost";
import type { Item } from "../types/Item";
import type { Storyline, StorylineChapter } from "../types/Storyline";

// The prev/next buttons are the only way to traverse a storyline with a
// pointing device -- the track is overflow-x:auto with its scrollbar
// hidden, so a mouse has no scrollbar or gesture. Hidden under
// (pointer: coarse) in CSS, where the swipe is the affordance instead.
const STORYLINE_MARKUP = `
<div class="storyline-header">
  <div class="storyline-header-title" id="storylineHeaderTitle"></div>
  <button class="storyline-close" id="storylineClose" type="button" aria-label="Close storyline">&times;</button>
</div>
<div class="storyline-track" id="storylineTrack"></div>
<button class="storyline-nav storyline-nav-prev" type="button"
        data-storyline-nav="prev" aria-label="Previous page" disabled>&#8249;</button>
<button class="storyline-nav storyline-nav-next" type="button"
        data-storyline-nav="next" aria-label="Next page">&#8250;</button>
<div class="storyline-timeline" id="storylineTimeline"></div>
`;

const AI_CORRECTIONS_EMAIL = "hello@tranquilo.art";
const AI_HELP_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<circle cx="12" cy="12" r="9"></circle>' +
  '<path d="M9.4 9.3a2.6 2.6 0 1 1 3.4 2.5c-.7.25-1 .75-1 1.4v.5"></path>' +
  '<line x1="12" y1="17.3" x2="12" y2="17.3"></line>' +
  "</svg>";
const AI_DISCLOSURE_HTML =
  `<button class="ai-badge" type="button" data-ai-disclosure ` +
  `aria-expanded="false" aria-label="How this text was written">${
    AI_HELP_SVG
  }</button>` +
  `<span class="ai-badge-note" data-ai-disclosure-text role="note">` +
  `Drafted with AI help; edited and reviewed by a person. ` +
  `Spotted an error? <a href="mailto:${AI_CORRECTIONS_EMAIL}">${AI_CORRECTIONS_EMAIL}</a>` +
  `</span>`;

export interface OpenDetailEventDetail {
  item: Item;
  storylineId: string;
  position: number;
}

export class TranquiloStorylineMode extends HTMLElement {
  app: ITranquiloStorylineModeHost | null = null;

  private headerTitleEl!: HTMLElement;
  private closeBtn!: HTMLButtonElement;
  private trackEl!: HTMLElement;
  private navPrevEl!: HTMLButtonElement;
  private navNextEl!: HTMLButtonElement;
  private timelineEl!: HTMLElement;

  private observer: IntersectionObserver | null = null;
  private visited: Record<number, boolean> = {};
  // Set in open(), read by updateTimeline() for storyline_chapter_view.
  private currentStorylineId: string | null = null;
  // Which storyline's resolveStorylineDetail() is in flight, or null.
  // open()'s .then() checks this before acting, so a superseded request
  // (a different storyline opened, or this one closed) is dropped rather
  // than rendering into a track the reader already left. close() clears
  // it for the same reason.
  private pendingStorylineId: string | null = null;
  // Where a click-driven scroll is heading, or null at rest. The track
  // scrolls smoothly, so scrollLeft mid-animation sits between two pages --
  // basing the next step on that reading made two quick clicks advance
  // only one page. A click now steps from the pending target when there
  // is one, clearing it once the track arrives.
  private navTarget: number | null = null;

  // Throws a clear error instead of a silent null if STORYLINE_MARKUP and
  // a selector below ever drift apart.
  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) {
      throw new Error(
        `<tranquilo-storyline-mode>: missing ${selector} in its own template`,
      );
    }
    return el;
  }

  private requireApp(): ITranquiloStorylineModeHost {
    if (!this.app) {
      throw new Error("<tranquilo-storyline-mode>: called before app was set");
    }
    return this.app;
  }

  connectedCallback(): void {
    if (this.getAttribute("data-storyline-mode-mounted") === "1") return;
    this.setAttribute("data-storyline-mode-mounted", "1");

    this.innerHTML = STORYLINE_MARKUP;
    this.headerTitleEl = this.requireEl("#storylineHeaderTitle");
    this.closeBtn = this.requireEl<HTMLButtonElement>("#storylineClose");
    this.trackEl = this.requireEl("#storylineTrack");
    this.navPrevEl = this.requireEl<HTMLButtonElement>(
      '[data-storyline-nav="prev"]',
    );
    this.navNextEl = this.requireEl<HTMLButtonElement>(
      '[data-storyline-nav="next"]',
    );
    this.timelineEl = this.requireEl("#storylineTimeline");

    this.closeBtn.addEventListener("click", () => {
      this.requireApp().requestOverlayClose(() => this.close());
    });
    this.navPrevEl.addEventListener("click", () => this.step(-1));
    this.navNextEl.addEventListener("click", () => this.step(1));

    this.trackEl.addEventListener(
      "scroll",
      () => {
        if (
          this.navTarget !== null &&
          Math.abs(
            this.trackEl.scrollLeft - this.navTarget * this.trackEl.clientWidth,
          ) < 2
        ) {
          this.navTarget = null;
        }
        this.updateNav();
      },
      { passive: true },
    );

    // Arrow keys worked only when the track had focus (native scroll-
    // container behaviour), depending on the reader clicking it first.
    // Bound at the document instead, so it works from the moment it opens.
    document.addEventListener("keydown", (e) => {
      if (!this.classList.contains("open")) return;
      // Leave typing and the browser's own shortcuts alone.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.step(-1);
      }
    });
  }

  // `pointer: fine` rather than a width breakpoint: the question is what
  // the visitor is pointing with. A phone gets the swipe it already had
  // and no buttons over the artwork.
  private hasFinePointer(): boolean {
    return !!window.matchMedia?.("(pointer: fine)").matches;
  }

  private beginHintText(): string {
    // Chosen in JS rather than CSS-hidden, since a CSS-hidden span still
    // contributes to textContent and would leave the wrong instruction
    // readable to assistive tech.
    return this.hasFinePointer()
      ? "Use the arrows to begin →"
      : "Swipe to begin →";
  }

  private buildIntroPage(storyline: Storyline): HTMLElement {
    const host = this.requireApp();
    const page = document.createElement("div");
    page.className = "storyline-page storyline-intro-page";
    const coverItem = host.getItem(String(storyline.cover_item_id));
    const stackDepth = Math.min(2, storyline.items.length - 1);
    let ghosts = "";
    for (let i = 1; i <= stackDepth; i++) {
      ghosts += `<div class="stack-ghost layer-${i}"></div>`;
    }
    page.innerHTML =
      `<div class="storyline-intro-eyebrow">${storyline.items.length}-part storyline</div>${
        coverItem
          ? `<div class="storyline-intro-stack">${ghosts}<img src="${coverItem.img}" alt=""></div>`
          : ""
      }<h2 class="storyline-intro-title">${escapeHtml(storyline.title)}</h2>` +
      // The intro caption is AI-drafted narrative. The badge goes here
      // rather than on every chapter, since twelve badges down a
      // twelve-chapter storyline would be noise.
      `<p class="storyline-intro-caption">${escapeHtml(storyline.intro_caption)}${AI_DISCLOSURE_HTML}</p>` +
      // Share sits on the intro page only: a storyline is shared as a
      // whole, and repeating it per chapter would be ambiguous between
      // the story and the artwork on screen.
      `<div class="caption-actions storyline-intro-actions">` +
      `<button class="btn-share" type="button" aria-label="Copy link to this storyline">${SHARE_SVG}</button>` +
      `</div>` +
      `<div class="storyline-intro-hint">${this.beginHintText()}</div>`;
    const introStack = page.querySelector<HTMLElement>(
      ".storyline-intro-stack",
    );
    if (introStack && coverItem)
      host.applyNudityGate(introStack, coverItem, true);
    const introShareBtn = page.querySelector<HTMLButtonElement>(".btn-share");
    introShareBtn?.addEventListener("click", () => {
      host.shareStoryline(storyline);
    });
    return page;
  }

  private buildChapterPage(
    storyline: Storyline,
    storyItem: StorylineChapter,
  ): HTMLElement {
    const host = this.requireApp();
    const item = host.getItem(String(storyItem.id));
    const page = document.createElement("div");
    page.className = "storyline-page storyline-chapter-page";
    page.dataset.storylinePosition = String(storyItem.position);
    if (!item) return page;
    // Both the title and the artwork are routes out to more about it,
    // without losing the story.
    page.innerHTML =
      `<div class="storyline-chapter-frame"><img src="${item.img}" alt="${escapeHtml(item.title || "Untitled")}"></div>` +
      `<div class="storyline-chapter-meta">Chapter ${storyItem.position} of ${storyline.items.length} &middot; ` +
      `<button type="button" class="storyline-chapter-title">${escapeHtml(item.title || "Untitled")}</button></div>` +
      `<p class="storyline-chapter-caption">${escapeHtml(storyItem.chapter_caption)}</p>`;
    // Always rendered together by the template above, so guaranteed present.
    const frame = page.querySelector(".storyline-chapter-frame") as HTMLElement;
    host.applyNudityGate(frame, item);

    // The detail panel sits below storyline mode (z-index 200 vs 250), so
    // it can't open on top -- stepping the storyline aside and restoring
    // it on the way back is the same trade Discover makes for shelf cards.
    // Remembering the chapter is what makes it a round trip.
    const titleBtn = page.querySelector(
      ".storyline-chapter-title",
    ) as HTMLButtonElement;
    titleBtn.addEventListener("click", () => {
      this.openDetailFromChapter(item, storyline.id, storyItem.position);
    });

    // The lightbox is the topmost overlay in the app, so unlike the
    // detail panel it can open over the storyline -- staying in the
    // story, looking closer.
    const frameImg = frame.querySelector("img") as HTMLImageElement;
    frameImg.addEventListener("click", () => {
      if (frame.classList.contains("nudity-gated")) return;
      host.openLightbox(item.img, item.title || "", item);
    });
    return page;
  }

  // Hides the overlay and leaves its history entry standing, same pattern
  // as a shelf card: the stack becomes [storyline][detail], so one back
  // press closes the detail panel and restores the storyline.
  //
  // Routing through closeOverlaySync() instead was the first attempt and
  // is wrong: history.back() is async, so its popstate arrives after the
  // detail modal pushes its own entry, closing the panel that just opened
  // in the same tick -- caught by the tests.
  //
  // Dispatched as a CustomEvent rather than a direct call, since neither
  // component owns the other; app.js relays this into
  // <tranquilo-detail-modal>'s "open-detail" listener.
  private openDetailFromChapter(
    item: Item,
    storylineId: string,
    position: number,
  ): void {
    this.close();
    this.dispatchEvent(
      new CustomEvent<OpenDetailEventDetail>("open-detail", {
        detail: { item, storylineId, position },
        bubbles: true,
      }),
    );
  }

  private renderTimeline(storyline: Storyline): void {
    this.timelineEl.innerHTML = "";
    storyline.items.forEach((storyItem) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "storyline-dot";
      dot.dataset.position = String(storyItem.position);
      dot.setAttribute("aria-label", `Go to chapter ${storyItem.position}`);
      dot.addEventListener("click", () => {
        const target = this.trackEl.querySelector<HTMLElement>(
          `.storyline-chapter-page[data-storyline-position="${storyItem.position}"]`,
        );
        target?.scrollIntoView({
          behavior: "smooth",
          inline: "start",
          block: "nearest",
        });
      });
      this.timelineEl.appendChild(dot);
    });
  }

  private updateTimeline(currentPosition: number | null): void {
    // Fired once per chapter per session, answering whether a visitor
    // finishes a storyline or bails early, not just whether they opened
    // one. Reuses the existing first-visit bookkeeping rather than a
    // second tracker.
    if (currentPosition && !this.visited[currentPosition]) {
      this.requireApp().trackEvent("storyline_chapter_view", {
        storyline_id: this.currentStorylineId,
        position: currentPosition,
      });
    }
    if (currentPosition) this.visited[currentPosition] = true;
    this.timelineEl
      .querySelectorAll<HTMLElement>(".storyline-dot")
      .forEach((dot) => {
        const pos = Number.parseInt(dot.dataset.position || "", 10);
        dot.classList.toggle("current", pos === currentPosition);
        dot.classList.toggle("visited", !!this.visited[pos]);
      });
  }

  private observeTrack(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          const position = (entry.target as HTMLElement).dataset
            .storylinePosition;
          if (
            entry.isIntersecting &&
            position &&
            (!best || entry.intersectionRatio > best.intersectionRatio)
          ) {
            best = entry;
          }
        }
        if (best) {
          const position = (best.target as HTMLElement).dataset
            .storylinePosition;
          this.updateTimeline(Number.parseInt(position || "", 10));
        }
      },
      { root: this.trackEl, threshold: 0.6 },
    );
    this.trackEl.querySelectorAll(".storyline-page").forEach((page) => {
      this.observer?.observe(page);
    });
  }

  private pageCount(): number {
    return this.trackEl.querySelectorAll(".storyline-page").length;
  }

  private currentPage(): number {
    const w = this.trackEl.clientWidth;
    return w ? Math.round(this.trackEl.scrollLeft / w) : 0;
  }

  private updateNav(): void {
    const i = this.currentPage();
    const last = this.pageCount() - 1;
    // Driven by where the track actually is, never a click count -- swipes
    // and arrow keys move it too, desynchronising a counter immediately.
    this.navPrevEl.disabled = i <= 0;
    this.navNextEl.disabled = i >= last;
    const show = this.hasFinePointer() && last > 0;
    this.navPrevEl.hidden = !show;
    this.navNextEl.hidden = !show;
  }

  private goToPage(i: number): void {
    const last = this.pageCount() - 1;
    const target = Math.max(0, Math.min(last, i));
    this.navTarget = target;
    // scrollTo, not assigning scrollLeft: this is a navigation, unlike
    // open()'s opening jump, which must not animate.
    this.trackEl.scrollTo({ left: target * this.trackEl.clientWidth });
    this.updateNav();
  }

  private step(dir: number): void {
    const base = this.navTarget === null ? this.currentPage() : this.navTarget;
    this.goToPage(base + dir);
  }

  // Shown while resolveStorylineDetail() is in flight, so a reader tapping
  // a storyline chip sees something happen immediately rather than a
  // silent pause.
  private showLoadingSkeleton(): void {
    this.headerTitleEl.textContent = "";
    this.trackEl.innerHTML =
      '<div class="storyline-loading" aria-hidden="true"></div>';
    this.timelineEl.innerHTML = "";
    this.navPrevEl.hidden = true;
    this.navNextEl.hidden = true;
  }

  // `atPosition` opens straight to a chapter, used when returning from an
  // artwork's detail panel. Undefined everywhere else.
  open(storylineId: string, atPosition?: number): void {
    const host = this.requireApp();
    const storyline = host.getStorylineDetail(storylineId);

    // Full storyline content is fetched lazily, one at a time, unlike the
    // lightweight index the feed chip already has. Not cached means not
    // fetched, so kick that off and show a loading skeleton meanwhile;
    // re-invoking open() once it resolves is the same self-recursion the
    // chapter-item resolution below uses.
    if (!storyline) {
      this.pendingStorylineId = storylineId;
      this.currentStorylineId = storylineId;
      this.showLoadingSkeleton();
      if (!this.classList.contains("open")) {
        this.classList.add("open");
        this.setAttribute("aria-hidden", "false");
        host.pushOverlayHistoryState("storyline");
      }
      host.resolveStorylineDetail(storylineId).then((resolved) => {
        // A newer open() or a close() while this was in flight superseded
        // it -- drop a stale result rather than render into an
        // abandoned track. close() clears pendingStorylineId for this check.
        if (this.pendingStorylineId !== storylineId) return;
        if (!resolved) {
          this.close();
          return;
        }
        this.open(storylineId, atPosition);
      });
      return;
    }
    this.pendingStorylineId = null;

    // A storyline is a handful of items the feed's recycling window has
    // no reason to have hydrated -- fetch them first or every chapter
    // renders a blank frame. Deliberately silent, unlike the
    // storyline-detail fetch above.
    const chapterIds = storyline.items.map((si) => String(si.id));
    const chapterItems = chapterIds
      .map((id) => host.getItem(id))
      .filter((i): i is Item => !!i);
    // "Do we have it" and "is it hydrated" are different questions;
    // resolving by id covers both.
    if (
      chapterItems.length !== chapterIds.length ||
      chapterItems.some((i) => !i._full)
    ) {
      host.resolveItemsByIds(chapterIds).then(() => {
        this.open(storylineId, atPosition);
      });
      return;
    }
    host.trackEvent("storyline_open", { storyline_id: storylineId });
    this.currentStorylineId = storylineId;
    this.visited = {};
    this.headerTitleEl.textContent = storyline.title;
    this.trackEl.innerHTML = "";
    this.trackEl.appendChild(this.buildIntroPage(storyline));
    storyline.items.forEach((storyItem) => {
      this.trackEl.appendChild(this.buildChapterPage(storyline, storyItem));
    });
    this.renderTimeline(storyline);
    // Already true when this is the second half of the storyline-detail
    // fetch above; only a genuine first entry needs both here.
    if (!this.classList.contains("open")) {
      this.classList.add("open");
      this.setAttribute("aria-hidden", "false");
      host.pushOverlayHistoryState("storyline");
    }
    // Direct assignment, not scrollIntoView: this is the opening
    // position, not a navigation, so it must not animate.
    const landing =
      atPosition &&
      this.trackEl.querySelector<HTMLElement>(
        `.storyline-chapter-page[data-storyline-position="${atPosition}"]`,
      );
    this.trackEl.scrollLeft = landing ? landing.offsetLeft : 0;
    this.observeTrack();
    this.navTarget = null;
    this.updateNav();
    if (atPosition) this.updateTimeline(atPosition);
  }

  close(): void {
    this.classList.remove("open");
    this.setAttribute("aria-hidden", "true");
    this.observer?.disconnect();
    this.observer = null;
    // Invalidates any in-flight resolveStorylineDetail() via open()'s guard.
    this.pendingStorylineId = null;
  }
}

customElements.define("tranquilo-storyline-mode", TranquiloStorylineMode);
