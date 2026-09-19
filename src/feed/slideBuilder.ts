// The "given an item, build/wire its slide DOM" layer, split out of
// app.js. Not a custom element -- called as plain functions via
// createSlideBuilder() below, consumed the same way by <tranquilo-feed>.
//
// wireArtworkImageState()/applyNudityGate()/sampleArtworkColor() are used
// well beyond the feed -- the lightbox, detail modal, storyline mode and
// shelves all call them too, so they stay exported here rather than
// three-times-duplicated.
//
// buildSlideContents()/buildSlide() are the per-item orchestrator,
// reaching the lightbox, detail modal, storyline mode and collection
// through a host object (same shape as ITopbarHost) rather than importing
// them directly, avoiding a circular dependency between the slide layer
// and every overlay it can open. This module owns the DOM; everything
// the DOM triggers that isn't purely local goes through the host.
//
// escapeHtml/SHARE_SVG are exported for TranquiloStorylineMode.ts, which
// used to read them as classic-script globals.

import {
  deriveTint,
  hexToRgb,
  rgbToHsl,
  shouldLogFailure,
  shouldSkipAutomaticLoad,
} from "../logic/logic";
import type { Item } from "../types/Item";
import type { SetOfWorkIndexEntry } from "../types/SetOfWork";
import type { StorylineIndexEntry } from "../types/Storyline";

// document.startViewTransition() isn't in this TS version's DOM lib yet
// (Chromium-only browser API) -- a minimal local shape rather than `any`,
// scoped to just the members this module actually calls.
interface ViewTransition {
  finished: Promise<void>;
}
type DocumentWithViewTransitions = Document & {
  startViewTransition?(callback: () => void): ViewTransition;
};

// The shared name a feed thumbnail and the lightbox's own
// <img> both carry for the duration of one open() transition, so the
// browser morphs between their positions/sizes instead of cross-fading the
// whole page. See TranquiloLightbox.ts's open()/close() for the lightbox
// side of this same name.
const LIGHTBOX_VIEW_TRANSITION_NAME = "tranquilo-lightbox-artwork";

export interface ImageState {
  isFailed(): boolean;
  retry(): void;
  // Stops this wiring's pending timeout/observer/listeners from firing
  // after the fact -- a slide the recycling window released, or a
  // lightbox/detail-modal image torn down mid-load.
  cancel(): void;
}

export interface ISlideBuilderHost {
  trackEvent(name: string, props: Record<string, unknown>): void;
  isCollected(item: Item): boolean;
  // Persists the toggle and performs every side effect tied to a
  // collect/uncollect from this button (analytics, the bookmark badge, a
  // feed re-render if a collection-filtered view lost its last item) --
  // returns the new collected state.
  toggleCollect(item: Item): boolean;
  openLightbox(src: string, alt: string, item: Item): void;
  openDetailModal(item: Item): void;
  openStorylineMode(storylineId: string): void;
  openSetOfWorksMode(setOfWorkId: string): void;
  shareItem(item: Item): void;
}

export function escapeHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Returns the slug in its raw form, deliberately -- an identity, not a
// URL. e2e tests build the exact same `[data-slug="source-id"]` selector,
// so encoding here would break every one of them; that belongs at the
// point a URL is actually built (src/app.ts's encodeSlugId()).
function slugFor(item: Item): string {
  return `${item.source || "met"}-${item.id}`;
}

const IMAGE_LOAD_TIMEOUT_MS = 8000;

const IMAGE_ERROR_SVG =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
// Nudity tap-to-reveal gate, scoped strictly to items where
// category === "Photography" AND contains_nudity === true.
const NUDITY_GATE_SVG =
  '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
const TWIST_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
const STORYLINE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
// Two overlapping objects, distinct from STORYLINE_SVG's stacked layers.
const SET_OF_WORKS_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const BOOKMARK_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
export const SHARE_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>';

export function createSlideBuilder(
  host: ISlideBuilderHost,
  config: {
    pageLoadId: string;
    // The lightweight index (id/cover_item_id/chapter id+position), not
    // the full Storyline -- this is a chip label, never needs a chapter's
    // caption text.
    storylinesById: Record<string, StorylineIndexEntry>;
    // Same lightweight-index reasoning, for the set-of-works chip.
    setOfWorksById: Record<string, SetOfWorkIndexEntry>;
  },
) {
  const colorCache: Record<string, string | false> = {};

  function sampleArtworkColor(
    item: Item,
    callback: (tint: string | null) => void,
  ): void {
    if (Object.hasOwn(colorCache, item.id)) {
      callback(colorCache[item.id] || null);
      return;
    }
    const rgb = hexToRgb(item.accentColor);
    if (!rgb) {
      colorCache[item.id] = false;
      callback(null);
      return;
    }
    const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    const tint = deriveTint(hsl[0], hsl[1]);
    colorCache[item.id] = tint ?? false;
    callback(tint);
  }

  function storylineFor(item: Item): StorylineIndexEntry | null {
    const id = item.storyline_ids?.[0];
    return id ? config.storylinesById[id] || null : null;
  }

  function storylinePositionLabel(
    item: Item,
    storyline: StorylineIndexEntry,
  ): string {
    let idx = -1;
    // String() on both sides: storylines.js has literal number tokens;
    // item.id always comes back as a string from Postgres's native_id.
    storyline.items.forEach((si, i) => {
      if (String(si.id) === String(item.id)) idx = i;
    });
    return `${idx + 1} of ${storyline.items.length}`;
  }

  // Same shape as storylineFor()/storylinePositionLabel() above --
  // single id (set_of_work_id), not an array, so no [0] needed.
  function setOfWorkFor(item: Item): SetOfWorkIndexEntry | null {
    const id = item.set_of_work_id;
    return id ? config.setOfWorksById[id] || null : null;
  }

  function setOfWorkPositionLabel(
    item: Item,
    setOfWork: SetOfWorkIndexEntry,
  ): string {
    let idx = -1;
    setOfWork.items.forEach((member, i) => {
      if (String(member.id) === String(item.id)) idx = i;
    });
    return `${idx + 1} of ${setOfWork.items.length} in set`;
  }

  function itemNeedsNudityGate(item: Item | null | undefined): boolean {
    return (
      !!item && item.category === "Photography" && item.contains_nudity === true
    );
  }

  function applyNudityGate(
    frame: HTMLElement,
    item: Item,
    compact?: boolean,
  ): void {
    if (!itemNeedsNudityGate(item)) return;
    frame.classList.add("nudity-gated");
    const overlay = document.createElement("button");
    overlay.type = "button";
    overlay.className = `nudity-gate-overlay${compact ? " compact" : ""}`;
    overlay.setAttribute(
      "aria-label",
      "This image may contain nudity. Tap to reveal.",
    );
    overlay.innerHTML = `${NUDITY_GATE_SVG}<span>May contain nudity<br>Tap to reveal</span>`;
    overlay.addEventListener("click", (e) => {
      e.stopPropagation();
      frame.classList.remove("nudity-gated");
      overlay.remove();
    });
    frame.appendChild(overlay);
  }

  // source:id known to have failed this session -- without this, switching
  // category/search or reopening the detail modal rebuilds the <img> from
  // scratch and re-triggers both a fresh analytics event and a fresh
  // network request against a resource that doesn't recover on retry.
  const reportedImageFailures = new Set<string>();
  // frame/detail-modal <img>s are always fresh elements; the lightbox's
  // is the one persistent, reused <img> across every open, which is why
  // its listeners need explicit cleanup below.
  const wiredImageListeners = new WeakMap<
    HTMLImageElement,
    { load: EventListener; error: EventListener }
  >();
  // Gates when each <img> starts loading, and when the 8s failure timer
  // starts, on genuine proximity to the viewport -- the sole gate, not
  // combined with native img.loading="lazy". No `root` option, so the
  // default top-level viewport also covers the detail modal's image,
  // which lives outside the feed's own scroll container.
  const pendingImageLoads = new WeakMap<HTMLElement, () => void>();
  const imageVisibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        imageVisibilityObserver.unobserve(entry.target);
        const start = pendingImageLoads.get(entry.target as HTMLElement);
        pendingImageLoads.delete(entry.target as HTMLElement);
        if (start) start();
      });
    },
    { rootMargin: "800px 0px 800px 0px" },
  );

  function wireArtworkImageState(
    frame: HTMLElement,
    skeleton: HTMLElement,
    img: HTMLImageElement,
    src: string,
    item: Item,
    tier: string,
    onLoaded?: () => void,
  ): ImageState {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    // Tier-scoped, not just source:id -- display and lightbox are
    // separate fetches with different reliability profiles, and a bare
    // source:id key once let a slow lightbox timeout blacklist the
    // already-fast display tier too.
    const key = `${item.source}:${item.id}:${tier}`;

    function renderFailedUI(): void {
      frame.classList.remove("loading");
      frame.classList.add("failed");
      skeleton.innerHTML = `${IMAGE_ERROR_SVG}<span>Couldn&rsquo;t load image &mdash; tap to retry</span>`;
    }

    function markFailed(isManualRetry: boolean, reason?: string): void {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      // A category/search switch tears down every slide from scratch, and
      // removing an <img> mid-request can itself fire a real `error` for
      // the aborted load, not a genuinely broken image. isManualRetry is
      // exempt: that's a click on a still-connected frame by definition.
      if (!isManualRetry && !img.isConnected) return;
      renderFailedUI();
      if (shouldLogFailure(key, isManualRetry, reportedImageFailures)) {
        reportedImageFailures.add(key);
        host.trackEvent("image_load_failed", {
          source: item.source,
          id: item.id,
          reason: reason || "unknown",
          tier,
          page_load: config.pageLoadId,
        });
      }
    }

    function markLoaded(): void {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      frame.classList.remove("loading", "failed");
      // hidden, not skeleton.remove(): the lightbox's skeleton is a
      // single persistent element reused across every open.
      skeleton.hidden = true;
      reportedImageFailures.delete(key); // a later real success un-fails it for the rest of the session
      onLoaded?.();
    }

    function startLoad(isManualRetry: boolean): void {
      if (shouldSkipAutomaticLoad(key, isManualRetry, reportedImageFailures)) {
        renderFailedUI();
        return;
      }
      frame.classList.add("loading");
      frame.classList.remove("failed");
      skeleton.hidden = false;
      skeleton.innerHTML = "";
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(
        () => markFailed(isManualRetry, "timeout"),
        IMAGE_LOAD_TIMEOUT_MS,
      );
      img.src = src;
    }

    // Removes any listeners a previous call attached to this same <img> --
    // a no-op for fresh feed/detail-modal images, but required for the
    // lightbox's one persistent, reused element.
    const previousListeners = wiredImageListeners.get(img);
    if (previousListeners) {
      img.removeEventListener("load", previousListeners.load);
      img.removeEventListener("error", previousListeners.error);
    }
    const onLoadListener = markLoaded;
    const onErrorListener = () => markFailed(false, "error");
    img.addEventListener("load", onLoadListener);
    img.addEventListener("error", onErrorListener);
    wiredImageListeners.set(img, {
      load: onLoadListener,
      error: onErrorListener,
    });
    // Only starts loading (and the 8s failure clock) once frame is near
    // the viewport -- a slide already within rootMargin fires on the very
    // next observer callback, effectively immediately.
    pendingImageLoads.set(frame, () => startLoad(false));
    imageVisibilityObserver.observe(frame);

    return {
      isFailed: () => frame.classList.contains("failed"),
      retry: () => startLoad(true),
      cancel: () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        imageVisibilityObserver.unobserve(frame);
        pendingImageLoads.delete(frame);
        img.removeEventListener("load", onLoadListener);
        img.removeEventListener("error", onErrorListener);
        wiredImageListeners.delete(img);
      },
    };
  }

  // A slide is split into a cheap shell and expensive contents, since the
  // feed recycles. The shell carries data-slug and data-category -- all
  // the feed needs from a slide it isn't currently showing, since .slide
  // is height:100svh and its geometry doesn't depend on contents.
  function createSlideShell(item: Item): HTMLElement {
    const el = document.createElement("section");
    el.className = "slide";
    el.dataset.slug = slugFor(item);
    el.dataset.category = item.category ?? "";
    return el;
  }

  // Returns the imageState handle, which the recycling window needs in
  // order to cancel() a pending load when releasing a slide.
  function buildSlideContents(item: Item, el: HTMLElement): ImageState {
    const frame = document.createElement("div");
    frame.className = "art-frame loading";
    // Paints instantly from data already in this response, sitting behind
    // the skeleton/real <img> until either renders on top.
    if (item.blur_placeholder) {
      frame.style.backgroundImage = `url(${item.blur_placeholder})`;
      frame.style.backgroundSize = "cover";
      frame.style.backgroundPosition = "center";
    }

    const storyline = storylineFor(item);
    const setOfWork = setOfWorkFor(item);
    if (storyline) {
      const stackDepth = Math.min(2, storyline.items.length - 1);
      for (let layerIdx = 1; layerIdx <= stackDepth; layerIdx++) {
        const stackLayer = document.createElement("div");
        stackLayer.className = `art-stack-layer layer-${layerIdx}`;
        frame.appendChild(stackLayer);
      }
    }

    const skeleton = document.createElement("div");
    skeleton.className = "art-skeleton";
    frame.appendChild(skeleton);

    const img = document.createElement("img");
    // No loading="lazy" -- imageVisibilityObserver is the sole gate.
    img.alt = item.title || "Untitled";
    // Width/height attributes (not CSS) give the browser
    // the image's real aspect ratio via its UA stylesheet (`img{
    // aspect-ratio: attr(width) / attr(height) }`), the standard way to
    // avoid a layout shift on decode -- .art-frame img's own
    // max-width/max-height:100% + object-fit:contain still governs the
    // actual display size, this only hints the ratio. Absent (null) for
    // any item not yet backfilled; the image falls back to today's
    // behavior with no ratio hint.
    if (item.img_width && item.img_height) {
      img.width = item.img_width;
      img.height = item.img_height;
    }
    frame.appendChild(img);
    applyNudityGate(frame, item);

    const imageState = wireArtworkImageState(
      frame,
      skeleton,
      img,
      item.img,
      item,
      "display",
      () => {
        sampleArtworkColor(item, (tint) => {
          if (tint) el.style.backgroundColor = tint;
        });
      },
    );

    frame.addEventListener("click", () => {
      if (imageState.isFailed()) {
        imageState.retry();
        return;
      }
      // Opens on the display image, already loaded, so the lightbox
      // paints instantly; the host upgrades to lightbox tier in the background.
      const openLightbox = (): void =>
        host.openLightbox(item.img, item.title || "Untitled", item);
      // Feature-detected, scoped to exactly this thumbnail -> lightbox
      // transition -- not applied anywhere else this
      // frame's img is used. Named only for the duration of the
      // transition: set right before starting it, cleared once it
      // resolves, so a later click on a *different* thumbnail can safely
      // reuse the same name without colliding with this one.
      const doc = document as DocumentWithViewTransitions;
      if (typeof doc.startViewTransition !== "function") {
        openLightbox();
        return;
      }
      img.style.viewTransitionName = LIGHTBOX_VIEW_TRANSITION_NAME;
      doc.startViewTransition(openLightbox).finished.finally(() => {
        img.style.viewTransitionName = "";
      });
    });

    const caption = document.createElement("div");
    caption.className = "caption";

    const artistLine = item.artist
      ? `<span class="artist">${escapeHtml(item.artist)}</span>`
      : "";
    const dateLine = item.date
      ? `<span class="sep">&middot;</span>${escapeHtml(item.date)}`
      : "";

    caption.innerHTML = `<div class="caption-inner">
<div class="cat-label">${escapeHtml(item.category)}</div>
<h2 class="art-title"><button type="button" class="art-title-btn">${escapeHtml(item.title || "Untitled")}</button></h2>
<p class="art-meta">${artistLine}${dateLine}</p>
<p class="art-medium">${escapeHtml(item.medium || "")}</p>
${item.twist_category ? `<p class="twist-hook">${TWIST_SVG}<span>${escapeHtml(item.twist_hook || "")}</span></p>` : ""}
${storyline ? `<button class="storyline-chip" type="button">${STORYLINE_SVG}<span>Storyline &middot; ${storylinePositionLabel(item, storyline)}</span></button>` : ""}
${setOfWork ? `<button class="set-of-works-chip" type="button">${SET_OF_WORKS_SVG}<span>${setOfWorkPositionLabel(item, setOfWork)}</span></button>` : ""}
<div class="caption-actions">
<button class="btn-collect" type="button">${BOOKMARK_SVG}</button>
<button class="btn-share" type="button" aria-label="Copy share link">${SHARE_SVG}</button>
</div>
</div>`;

    el.appendChild(frame);
    el.appendChild(caption);

    const detailsBtn = caption.querySelector(".art-title-btn") as HTMLElement;
    detailsBtn.addEventListener("click", () => {
      host.openDetailModal(item);
    });

    const storylineChipBtn = caption.querySelector(".storyline-chip");
    if (storylineChipBtn && storyline) {
      storylineChipBtn.addEventListener("click", () => {
        host.openStorylineMode(storyline.id);
      });
    }

    const setOfWorksChipBtn = caption.querySelector(".set-of-works-chip");
    if (setOfWorksChipBtn && setOfWork) {
      setOfWorksChipBtn.addEventListener("click", () => {
        host.openSetOfWorksMode(setOfWork.id);
      });
    }

    const collectBtn = caption.querySelector(".btn-collect") as HTMLElement;
    function refreshCollectBtn(): void {
      const collected = host.isCollected(item);
      collectBtn.classList.toggle("active", collected);
      collectBtn.setAttribute("aria-pressed", collected ? "true" : "false");
      collectBtn.setAttribute(
        "aria-label",
        collected ? "Remove from collection" : "Collect this piece",
      );
    }
    refreshCollectBtn();
    collectBtn.addEventListener("click", () => {
      host.toggleCollect(item);
      refreshCollectBtn();
    });

    const shareBtn = caption.querySelector(".btn-share") as HTMLElement;
    shareBtn.addEventListener("click", () => {
      host.shareItem(item);
    });

    return imageState;
  }

  // A complete slide in one call -- shell plus contents, permanently
  // hydrated. Used for slides that are never recycled, and kept as the
  // simple thing to reach for outside the feed.
  function buildSlide(item: Item): HTMLElement {
    const el = createSlideShell(item);
    buildSlideContents(item, el);
    return el;
  }

  return {
    createSlideShell,
    buildSlideContents,
    buildSlide,
    wireArtworkImageState,
    sampleArtworkColor,
    itemNeedsNudityGate,
    applyNudityGate,
    storylineFor,
    storylinePositionLabel,
    setOfWorkFor,
    setOfWorkPositionLabel,
  };
}

export type SlideBuilder = ReturnType<typeof createSlideBuilder>;
