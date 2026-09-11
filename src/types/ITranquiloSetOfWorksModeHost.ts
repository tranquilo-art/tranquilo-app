// The host contract <tranquilo-set-of-works-mode> talks to
// (`setOfWorksModeEl.app = {...}`) -- app.ts is the one mediator between
// this element and everything else it needs to reach.
//
// Deliberately smaller than ITranquiloStorylineModeHost: no shareSetOfWork
// (a set of works isn't a standalone shareable page) and no open-detail
// handoff-event pair -- "View details" on a member calls openDetailModal()
// directly and this element closes itself, a one-way trip a 2-3-item
// comparison doesn't need.
import type { Item } from "./Item";
import type { SetOfWork } from "./SetOfWork";

export interface ITranquiloSetOfWorksModeHost {
  getItem(id: string): Item | undefined;
  resolveItemsByIds(ids: string[]): Promise<Item[]>;
  getSetOfWorkDetail(id: string): SetOfWork | undefined;
  resolveSetOfWorkDetail(id: string): Promise<SetOfWork | null>;
  applyNudityGate(frame: HTMLElement, item: Item, compact?: boolean): void;
  trackEvent(name: string, props: Record<string, unknown>): void;
  openLightbox(src: string, alt: string, item: Item): void;
  openDetailModal(item: Item): void;
  // Every overlay pushes one history entry on open so the hardware back
  // button closes it instead of leaving the app; requestOverlayClose routes
  // an explicit close through history.back() when an entry is pending.
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
}
