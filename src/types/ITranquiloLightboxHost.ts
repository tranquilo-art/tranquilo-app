// The host contract <tranquilo-lightbox> talks to (`lightboxEl.app =
// {...}`). Everything here is either app.js's own analytics/history
// machinery, or a call into the one shared slideBuilder instance the feed,
// detail modal, storylines and shelves all reach into.
import type { ImageState } from "../feed/slideBuilder";
import type { Item } from "./Item";

export interface ITranquiloLightboxHost {
  wireArtworkImageState(
    frame: HTMLElement,
    skeleton: HTMLElement,
    img: HTMLImageElement,
    src: string,
    item: Item,
    tier: string,
  ): ImageState;
  applyNudityGate(frame: HTMLElement, item: Item): void;
  sampleArtworkColor(item: Item, callback: (tint: string | null) => void): void;
  trackEvent(name: string, props: Record<string, unknown>): void;
  sourceLinkLabel(item: Item): string;
  isAggregatorSource(item: Item): boolean;
  // Every overlay pushes one history entry on open so the hardware back
  // button closes it instead of leaving the app; requestOverlayClose routes
  // an explicit close through history.back() when an entry is pending
  // (skipping this leaves a stale entry for the next back press to consume).
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
}
