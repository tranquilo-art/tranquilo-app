// The host contract <tranquilo-detail-modal> talks to
// (`detailModalEl.app = {...}`) -- app.js discovers this element at runtime
// rather than importing its class, so a property handoff is the contract.
//
// The storyline<->detail-modal handoff (a chapter opening the panel, the
// panel restoring the storyline on close) is deliberately not part of this
// host: it goes through CustomEvents dispatched on this element instead
// (storyline-handoff-open/storyline-handoff-restore), since neither
// component owns the other.
import type { ImageState } from "../feed/slideBuilder";
import type { Item } from "./Item";
import type { SetOfWorkIndexEntry } from "./SetOfWork";
import type { StorylineIndexEntry } from "./Storyline";

export interface ITranquiloDetailModalHost {
  // Forwards into the one shared slideBuilder instance the feed, lightbox,
  // storylines and shelves all reach into.
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
  storylineFor(item: Item): StorylineIndexEntry | null;
  storylinePositionLabel(item: Item, storyline: StorylineIndexEntry): string;
  setOfWorkFor(item: Item): SetOfWorkIndexEntry | null;
  setOfWorkPositionLabel(item: Item, setOfWork: SetOfWorkIndexEntry): string;

  trackEvent(name: string, props: Record<string, unknown>): void;
  // A shelf card or storyline chapter can hand this an item the feed's
  // recycling window never hydrated.
  hydrateItems(items: Item[]): Promise<void>;
  shareItem(item: Item): void;
  sourceLinkLabel(item: Item): string;
  setArtistFilter(artist: string): void;
  openStorylineMode(storylineId: string): void;
  openSetOfWorksMode(setOfWorkId: string): void;
  // Every overlay pushes one history entry on open so the hardware back
  // button closes it instead of leaving the app; requestOverlayClose routes
  // an explicit close through history.back() when an entry is pending
  // (skipping this leaves a stale entry for the next back press to consume).
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
  // Reopens Discover (shelvesMode) on close, but only when this panel was
  // the reason it was hidden -- shelvesMode closes itself before this panel
  // opens since its z-index sits above it.
  reopenShelvesMode(): void;
  showToast(msg: string): void;
}
