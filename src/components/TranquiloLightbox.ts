// The full-screen artwork lightbox (image, loading skeleton,
// upgrade-to-full-resolution indicator, source link, pinch/pan/zoom), as a
// native custom element.
//
// Same property-assignment host as ITopbarHost/ITranquiloFeedHost
// (`lightboxEl.app = {...}`), same reason. Everything this element can't
// do on its own -- shared slideBuilder calls, analytics, source-link copy,
// six-overlay history coordination -- goes through
// ITranquiloLightboxHost. See src/types/ITranquiloLightboxHost.ts for the
// full contract.
//
// app.js still owns the six-overlay popstate/Escape handler, since it
// coordinates overlays this element knows nothing about, and reads this
// element's classList/aria-hidden exactly as it read the plain div before
// this was a custom element.
//
// Renders into light DOM: every style already lives in css/style.css.

import type { ImageState } from "../feed/slideBuilder";
import type { ITranquiloLightboxHost } from "../types/ITranquiloLightboxHost";
import type { Item } from "../types/Item";
import { on } from "../utils/on";

const LIGHTBOX_MARKUP = `
<button class="lightbox-close" id="lightboxClose" aria-label="Close">&times;</button>
<div class="art-skeleton" id="lightboxSkeleton"></div>
<img id="lightboxImg" src="" alt="">
<div class="lightbox-upgrading" aria-live="polite">
  <span class="lightbox-spinner" aria-hidden="true"></span>
  <span>Loading full resolution&hellip;</span>
</div>
<a class="lightbox-source-link source-link" id="lightboxSourceLink" href=""
   target="_blank" rel="noopener" hidden><span class="link-text"></span><span
   class="link-arrow" aria-hidden="true">&rarr;</span></a>
`;

// ---- Pinch / pan / double-tap zoom ----
// Hand-rolled, no dependency. Pointer Events unify mouse, touch and pen
// into one code path; wheel covers desktop trackpad/scroll-to-zoom on top.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;
const TAP_MOVE_SLOP = 10;
const TAP_MAX_MS = 300;

// Fetch the good version in the background, and say so meanwhile. The
// lightbox admission threshold is 2, so the first request for an uncached
// item is deliberately refused and served from the display blob -- this
// upgrade request is also the second request admission is waiting for.
// Two attempts, not a loop: retrying forever would be the same mistake as
// the removed 429 retry.
const UPGRADE_RETRY_MS = 1400;

interface PointerPoint {
  x: number;
  y: number;
}

interface VelocitySample extends PointerPoint {
  t: number;
}

export class TranquiloLightbox extends HTMLElement {
  app: ITranquiloLightboxHost | null = null;

  private imgEl!: HTMLImageElement;
  private skeletonEl!: HTMLElement;
  private sourceLinkEl!: HTMLAnchorElement;
  private closeBtn!: HTMLButtonElement;

  // Reassigned on every open; the retry click handler always reads the
  // latest.
  private imageState: ImageState | null = null;
  private upgradeToken = 0;

  private zoomState = { scale: 1, tx: 0, ty: 0 };
  private zoomPointers: Record<number, PointerPoint> = {};
  private pinchStart: { dist: number; scale: number } | null = null;
  private panLast: PointerPoint | null = null;
  private panStart: { x: number; y: number; time: number } | null = null;
  private velocitySamples: VelocitySample[] = [];
  private lastTapInfo: { time: number; x: number; y: number } | null = null;
  private momentumFrame: number | null = null;

  // Throws a clear error instead of a silent null if LIGHTBOX_MARKUP and a
  // selector below ever drift apart.
  private requireEl<T extends Element>(selector: string): T {
    const el = this.querySelector<T>(selector);
    if (!el) {
      throw new Error(
        `<tranquilo-lightbox>: missing ${selector} in its own template`,
      );
    }
    return el;
  }

  private requireApp(): ITranquiloLightboxHost {
    if (!this.app) {
      throw new Error("<tranquilo-lightbox>: called before app was set");
    }
    return this.app;
  }

  connectedCallback(): void {
    if (this.getAttribute("data-lightbox-mounted") === "1") return;
    this.setAttribute("data-lightbox-mounted", "1");

    this.innerHTML = LIGHTBOX_MARKUP;
    this.imgEl = this.requireEl<HTMLImageElement>("#lightboxImg");
    this.skeletonEl = this.requireEl<HTMLElement>("#lightboxSkeleton");
    this.sourceLinkEl = this.requireEl<HTMLAnchorElement>(
      "#lightboxSourceLink",
    );
    this.closeBtn = this.requireEl<HTMLButtonElement>("#lightboxClose");

    on(this.closeBtn, () =>
      this.requireApp().requestOverlayClose(() => this.close()),
    );
    on(this, (e) => {
      if (e.target === this)
        this.requireApp().requestOverlayClose(() => this.close());
    });
    on(this.skeletonEl, () => {
      if (this.imageState?.isFailed()) this.imageState.retry();
    });

    this.wireZoomListeners();
  }

  // Links to `url` (the object page), not `full_img` (the raw original):
  // full_img was audited across all live rows and turned out to be four
  // different things wearing one name (a .tif Chrome downloads instead of
  // showing, a download endpoint, an extensionless or non-image document,
  // and only two sources where it behaves as a plain .jpg). The object
  // page is the one URL reliably human-facing across all sources, and it
  // keeps licence/attribution beside the file, which hotlinking strips.
  //
  // Copy differs for aggregators, since "full resolution at europeana.eu"
  // would be a promise on another institution's behalf we can't keep.
  //
  // Rebuilt on every open: this is a single persistent element reused for
  // every item, so a stale href would quietly offer the previous artwork's
  // museum page. An item with no `url` hides the link rather than
  // rendering a dead one.
  private updateSourceLink(item: Item | null): void {
    const href = item?.url;
    if (!href) {
      this.sourceLinkEl.hidden = true;
      this.sourceLinkEl.removeAttribute("href");
      return;
    }
    const host = this.requireApp();
    const copy = host.isAggregatorSource(item)
      ? `Source record at ${host.sourceLinkLabel(item)}`
      : `Full resolution at ${host.sourceLinkLabel(item)}`;
    this.sourceLinkEl.href = href;
    const linkText = this.sourceLinkEl.querySelector(".link-text");
    if (linkText) linkText.textContent = copy;
    // Screen readers get the destination named in full, since the visible
    // copy is thin as a link name out of context.
    this.sourceLinkEl.setAttribute("aria-label", `${copy}, opens in a new tab`);
    this.sourceLinkEl.hidden = false;
  }

  private upgrade(item: Item | null): void {
    if (!item?.lightbox_img) return;
    const mine = ++this.upgradeToken;
    const baseWidth = this.imgEl.naturalWidth || 0;
    this.classList.add("upgrading");

    const attempt = (n: number): void => {
      // Cache-buster on the retry only -- the refused first response
      // carries a 120s max-age, so without it the browser would answer
      // attempt 2 from cache and the upgrade would silently never happen.
      const url = item.lightbox_img + (n > 1 ? `&upgrade=${n}` : "");
      const probe = new Image();
      probe.onload = () => {
        if (mine !== this.upgradeToken) return; // a newer lightbox opened
        if (probe.naturalWidth > baseWidth) {
          this.imgEl.src = probe.src;
          this.classList.remove("upgrading");
          return;
        }
        if (n < 2) setTimeout(() => attempt(n + 1), UPGRADE_RETRY_MS);
        else this.classList.remove("upgrading");
      };
      probe.onerror = () => {
        if (mine !== this.upgradeToken) return;
        // A 503 here is the honest "nothing is cached and I will not
        // fetch it" -- the visitor keeps the display image, not an error.
        if (n < 2) setTimeout(() => attempt(n + 1), UPGRADE_RETRY_MS);
        else this.classList.remove("upgrading");
      };
      probe.src = url;
    };
    attempt(1);
  }

  open(src: string, alt: string | null, item: Item | null): void {
    const host = this.requireApp();
    // TRA-274 Phase 2: shared-element view transition target. Harmless to
    // set unconditionally -- a view-transition-name with no active
    // document.startViewTransition() capturing it (unsupported browser, or
    // this element opened some other way) has no visible effect. The
    // matching feed thumbnail sets the same name only for the duration of
    // its own startViewTransition() call; see slideBuilder.ts's frame
    // click handler. Cleared in close(), not just left to be overwritten
    // next open(), so a stale name here can't collide with a *different*
    // feed thumbnail naming itself the same thing on the next transition.
    this.imgEl.style.viewTransitionName = "tranquilo-lightbox-artwork";
    this.imgEl.alt = alt || "";
    this.updateSourceLink(item);
    this.imageState = host.wireArtworkImageState(
      this,
      this.skeletonEl,
      this.imgEl,
      src,
      item as Item,
      "lightbox",
    );
    this.classList.add("open");
    this.setAttribute("aria-hidden", "false");
    // Fired after the lightbox is open, deliberately: trackEvent() reads
    // localStorage outside its own try/catch, so calling it first in a
    // context where storage throws would abort open() before the class
    // was ever set. Measurement must never sit upstream of the thing it
    // measures.
    host.trackEvent("lightbox_open", { id: item?.id, source: item?.source });
    this.style.backgroundColor = "";
    // Fresh gate state per open -- a prior item's revealed/gated class
    // must never carry over into this persistent element.
    this.classList.remove("nudity-gated");
    const staleGate = this.querySelector(".nudity-gate-overlay");
    staleGate?.remove();
    if (item) host.applyNudityGate(this, item);
    this.resetZoomState(false);
    if (item) {
      host.sampleArtworkColor(item, (tint) => {
        if (tint) this.style.backgroundColor = tint;
      });
    }
    host.pushOverlayHistoryState("lightbox");
    this.upgrade(item);
  }

  close(): void {
    // Invalidate any in-flight upgrade: its onload must not write into a
    // lightbox showing a different artwork.
    this.upgradeToken++;
    this.classList.remove("upgrading");
    this.classList.remove("open");
    this.setAttribute("aria-hidden", "true");
    this.imageState?.cancel();
    this.imgEl.src = "";
    this.imgEl.style.viewTransitionName = "";
    this.resetZoomState(false);
  }

  private setZoomTransform(animated: boolean): void {
    this.imgEl.style.transition = animated
      ? "transform 0.25s cubic-bezier(.2,.7,.3,1)"
      : "none";
    this.imgEl.style.transform =
      `translate(${this.zoomState.tx.toFixed(1)}px,${this.zoomState.ty.toFixed(1)}px) ` +
      `scale(${this.zoomState.scale.toFixed(3)})`;
    this.imgEl.style.cursor = this.zoomState.scale > 1.01 ? "grab" : "zoom-in";
    // Get the source link out of the way while zoomed -- it would
    // otherwise swallow any pan drag starting over it, silently failing
    // the gesture.
    this.classList.toggle("zoomed", this.zoomState.scale > 1.01);
  }

  private cancelMomentum(): void {
    if (this.momentumFrame) {
      cancelAnimationFrame(this.momentumFrame);
      this.momentumFrame = null;
    }
  }

  private resetZoomState(animated: boolean): void {
    this.cancelMomentum();
    this.zoomPointers = {};
    this.pinchStart = null;
    this.panLast = null;
    this.panStart = null;
    this.velocitySamples = [];
    this.lastTapInfo = null;
    this.zoomState.scale = 1;
    this.zoomState.tx = 0;
    this.zoomState.ty = 0;
    this.setZoomTransform(animated);
  }

  private panBounds(): PointerPoint {
    const w = this.imgEl.offsetWidth * this.zoomState.scale;
    const h = this.imgEl.offsetHeight * this.zoomState.scale;
    return {
      x: Math.max(0, (w - this.clientWidth) / 2),
      y: Math.max(0, (h - this.clientHeight) / 2),
    };
  }

  private clampZoomPan(rubberFactor: number): void {
    const b = this.panBounds();
    const clampAxis = (v: number, max: number): number => {
      if (Math.abs(v) <= max) return v;
      if (!rubberFactor) return v > 0 ? max : -max;
      const over = Math.abs(v) - max;
      return (v > 0 ? 1 : -1) * (max + over * rubberFactor);
    };
    this.zoomState.tx = clampAxis(this.zoomState.tx, b.x);
    this.zoomState.ty = clampAxis(this.zoomState.ty, b.y);
  }

  private snapWithinBounds(): void {
    const b = this.panBounds();
    this.zoomState.tx = Math.max(-b.x, Math.min(b.x, this.zoomState.tx));
    this.zoomState.ty = Math.max(-b.y, Math.min(b.y, this.zoomState.ty));
    this.setZoomTransform(true);
  }

  private zoomTowardPoint(
    newScale: number,
    pointX: number,
    pointY: number,
  ): void {
    const rect = this.getBoundingClientRect();
    const cx = pointX - (rect.left + rect.width / 2);
    const cy = pointY - (rect.top + rect.height / 2);
    const oldScale = this.zoomState.scale;
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newScale));
    this.zoomState.tx = cx - (cx - this.zoomState.tx) * (clamped / oldScale);
    this.zoomState.ty = cy - (cy - this.zoomState.ty) * (clamped / oldScale);
    this.zoomState.scale = clamped;
    this.clampZoomPan(0);
  }

  private toggleDoubleTapZoom(x: number, y: number): void {
    if (this.zoomState.scale > 1.01) {
      this.resetZoomState(true);
    } else {
      this.zoomTowardPoint(DOUBLE_TAP_ZOOM, x, y);
      this.setZoomTransform(true);
    }
  }

  private startMomentum(vx: number, vy: number): void {
    this.cancelMomentum();
    let lastTime: number | null = null;
    let velX = vx;
    let velY = vy;
    const step = (time: number): void => {
      if (lastTime == null) {
        lastTime = time;
        this.momentumFrame = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(32, time - lastTime) / 1000;
      lastTime = time;
      this.zoomState.tx += velX * dt;
      this.zoomState.ty += velY * dt;
      const friction = 0.02 ** dt;
      velX *= friction;
      velY *= friction;

      const b = this.panBounds();
      if (
        Math.abs(this.zoomState.tx) > b.x ||
        Math.abs(this.zoomState.ty) > b.y
      ) {
        this.snapWithinBounds();
        this.momentumFrame = null;
        return;
      }
      this.setZoomTransform(false);
      if (Math.hypot(velX, velY) < 8) {
        this.momentumFrame = null;
        return;
      }
      this.momentumFrame = requestAnimationFrame(step);
    };
    this.momentumFrame = requestAnimationFrame(step);
  }

  private wireZoomListeners(): void {
    const pointerDist = (a: PointerPoint, b: PointerPoint): number =>
      Math.hypot(a.x - b.x, a.y - b.y);
    const pointerMid = (a: PointerPoint, b: PointerPoint): PointerPoint => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    on(this.imgEl, "pointerdown", (e) => {
      try {
        this.imgEl.setPointerCapture(e.pointerId);
      } catch {
        // best-effort
      }
      this.zoomPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      this.cancelMomentum();
      const ids = Object.keys(this.zoomPointers);
      if (ids.length === 1) {
        this.panLast = { x: e.clientX, y: e.clientY };
        this.panStart = { x: e.clientX, y: e.clientY, time: performance.now() };
        this.velocitySamples = [
          { x: e.clientX, y: e.clientY, t: performance.now() },
        ];
      } else if (ids.length === 2) {
        this.panStart = null;
        const pts = ids.map((id) => this.zoomPointers[Number(id)]);
        this.pinchStart = {
          dist: pointerDist(pts[0], pts[1]),
          scale: this.zoomState.scale,
        };
      }
    });

    on(this.imgEl, "pointermove", (e) => {
      if (!this.zoomPointers[e.pointerId]) return;
      this.zoomPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      const ids = Object.keys(this.zoomPointers);

      if (ids.length === 2 && this.pinchStart) {
        const pts = ids.map((id) => this.zoomPointers[Number(id)]);
        const dist = pointerDist(pts[0], pts[1]);
        const mid = pointerMid(pts[0], pts[1]);
        this.zoomTowardPoint(
          this.pinchStart.scale * (dist / this.pinchStart.dist),
          mid.x,
          mid.y,
        );
        this.setZoomTransform(false);
        return;
      }

      if (ids.length === 1 && this.zoomState.scale > 1.01 && this.panLast) {
        const dx = e.clientX - this.panLast.x;
        const dy = e.clientY - this.panLast.y;
        this.zoomState.tx += dx;
        this.zoomState.ty += dy;
        this.clampZoomPan(0.35);
        this.setZoomTransform(false);
        this.panLast = { x: e.clientX, y: e.clientY };

        const now = performance.now();
        this.velocitySamples.push({ x: e.clientX, y: e.clientY, t: now });
        if (this.velocitySamples.length > 5) this.velocitySamples.shift();
      } else if (ids.length === 1 && this.panStart) {
        if (
          Math.hypot(e.clientX - this.panStart.x, e.clientY - this.panStart.y) >
          TAP_MOVE_SLOP
        ) {
          this.panStart = null;
        }
      }
    });

    const endZoomPointer = (e: PointerEvent): void => {
      delete this.zoomPointers[e.pointerId];
      const ids = Object.keys(this.zoomPointers);

      if (ids.length === 0) {
        if (this.zoomState.scale > 1.01 && this.velocitySamples.length >= 2) {
          const first = this.velocitySamples[0];
          const last = this.velocitySamples[this.velocitySamples.length - 1];
          const dt = (last.t - first.t) / 1000;
          const vx = dt > 0 ? (last.x - first.x) / dt : 0;
          const vy = dt > 0 ? (last.y - first.y) / dt : 0;
          if (Math.hypot(vx, vy) > 80) {
            this.startMomentum(vx, vy);
          } else {
            this.snapWithinBounds();
          }
        } else if (this.zoomState.scale > 1.01) {
          this.snapWithinBounds();
        }

        if (this.panStart) {
          const elapsed = performance.now() - this.panStart.time;
          if (elapsed <= TAP_MAX_MS) {
            const tapX = this.panStart.x;
            const tapY = this.panStart.y;
            if (
              this.lastTapInfo &&
              performance.now() - this.lastTapInfo.time < DOUBLE_TAP_MS &&
              Math.hypot(tapX - this.lastTapInfo.x, tapY - this.lastTapInfo.y) <
                DOUBLE_TAP_SLOP
            ) {
              this.toggleDoubleTapZoom(tapX, tapY);
              this.lastTapInfo = null;
            } else {
              this.lastTapInfo = { time: performance.now(), x: tapX, y: tapY };
            }
          }
        }
        this.panStart = null;
        this.panLast = null;
        this.pinchStart = null;
      } else if (ids.length === 1) {
        // Dropped from a pinch (2 pointers) to 1 -- resume single-finger
        // panning cleanly rather than treating it as a fresh tap.
        this.pinchStart = null;
        const remaining = this.zoomPointers[Number(ids[0])];
        this.panLast = { x: remaining.x, y: remaining.y };
        this.panStart = null;
        this.velocitySamples = [
          { x: remaining.x, y: remaining.y, t: performance.now() },
        ];
      }
    };
    on(this.imgEl, "pointerup", endZoomPointer);
    on(this.imgEl, "pointercancel", endZoomPointer);

    on(
      this.imgEl,
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomTowardPoint(
          this.zoomState.scale * 1.0015 ** -e.deltaY,
          e.clientX,
          e.clientY,
        );
        this.setZoomTransform(false);
      },
      { passive: false },
    );
  }
}

customElements.define("tranquilo-lightbox", TranquiloLightbox);
