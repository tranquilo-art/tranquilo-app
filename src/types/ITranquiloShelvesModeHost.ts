// The host contract <tranquilo-shelves-mode> talks to
// (`shelvesModeEl.app = {...}`) -- app.js is the mediator to the shared
// itemsById/storylinesById state and the detail panel.
//
// SHELVES itself is handed over as a plain property
// (`shelvesModeEl.shelves = SHELVES`) rather than through this host.
import type { Item } from "./Item";
import type { StorylineIndexEntry } from "./Storyline";

export interface ITranquiloShelvesModeHost {
  apiUrl(params: Record<string, unknown>): string;
  fetchJson(url: string, what: string): Promise<{ items?: unknown[] }>;
  // Merges fetched rows into app.js's own itemsById/items state, returning
  // the resolved Item objects a rule shelf's qualifying set draws from.
  absorbPage(rows: unknown[]): Item[];
  // Resolves a hero shelf's itemIds in order, dropping whatever no longer
  // exists rather than rendering a blank card.
  resolveItemsByIds(ids: string[]): Promise<Item[]>;
  hydrateItems(items: Item[]): Promise<void>;
  applyNudityGate(frame: HTMLElement, item: Item, compact?: boolean): void;
  storylineFor(item: Item): StorylineIndexEntry | null;
  trackEvent(name: string, props: Record<string, unknown>): void;
  openDetailModal(
    item: Item,
    shelfContext: { items: Item[]; index: number },
  ): void;
  // Every overlay pushes one history entry on open so the hardware back
  // button closes it instead of leaving the app; requestOverlayClose routes
  // an explicit close through history.back() when an entry is pending.
  pushOverlayHistoryState(name: string): void;
  requestOverlayClose(closeFn: () => void): void;
}
