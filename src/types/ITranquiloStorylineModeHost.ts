// The host contract <tranquilo-storyline-mode> talks to
// (`storylineModeEl.app = {...}`) -- app.js is the mediator, and neither
// component reaches into the other directly.
//
// One exception: opening the detail panel from a chapter is not part of
// this host. This element dispatches "open-detail" on itself, and app.js
// relays it into <tranquilo-detail-modal>'s own storyline-handoff-open event.
import type { Item } from "./Item";
import type { Storyline } from "./Storyline";

export interface ITranquiloStorylineModeHost {
  // A storyline's chapters are items the feed's recycling window has no
  // reason to have hydrated; open() checks getItem() before falling back
  // to resolveItemsByIds().
  getItem(id: string): Item | undefined;
  resolveItemsByIds(ids: string[]): Promise<Item[]>;
  // Same sync-getter/async-fetch-and-cache pair as above, for the
  // storyline's own full content instead of its chapter items.
  getStorylineDetail(id: string): Storyline | undefined;
  resolveStorylineDetail(id: string): Promise<Storyline | null>;
  applyNudityGate(frame: HTMLElement, item: Item, compact?: boolean): void;
  trackEvent(name: string, props: Record<string, unknown>): void;
  openLightbox(src: string, alt: string, item: Item): void;
  shareStoryline(storyline: Storyline): void;
  // Every overlay pushes one history entry on open so the hardware back
  // button closes it instead of leaving the app; requestOverlayClose routes
  // an explicit close through history.back() when an entry is pending.
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
}
