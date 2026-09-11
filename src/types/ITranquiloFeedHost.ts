// The host contract <tranquilo-feed> talks to (`feedEl.app = {...}`).
// Unlike ITopbarHost, most of this interface is the feed asking app.js for
// something rather than telling it what happened -- render() rebuilds the
// whole feed on every mode switch, so it re-reads the active filter every
// time rather than being told once. Forwards into the one shared
// slideBuilder/recycleWindow instance the lightbox, detail modal,
// storylines and shelves all reach into directly.

import type { Pager } from "../feed/recycleWindow";
import type { Item } from "./Item";

// What renderFeed() reads via FilterState rather than owning itself --
// just a snapshot, re-read at the top of every render().
export interface FeedFilterState {
  category: string;
  artist: string | null;
  search: string | null;
  concept: { label: string; filter: Record<string, unknown> } | null;
  collectionFilter: boolean;
  storylineFilter: boolean;
}

export interface ITranquiloFeedHost {
  // ---- Paging and the recycling window, one shared instance.
  createPager(
    params: Record<string, unknown>,
    checkCategory?: boolean,
    excludeIds?: Record<string, boolean> | null,
  ): Pager;
  loadNextPage(pager: Pager): Promise<Item[]>;
  fillFirstScreen(pager: Pager, firstPage?: Item[]): Promise<Item[]>;
  activeSlideIndex(): number;
  updateRecycleWindow(): void;
  resetRecycleWindow(): void;

  // ---- Item resolution/cache (app.js's private network + cache layer,
  // shared with shelves and storylines, not feed-exclusive).
  resolveItemsByIds(ids: (string | number)[]): Promise<Item[]>;
  fetchItemsByIds(
    ids: string[],
  ): Promise<{ items?: Item[]; missing?: string[] }>;
  absorbPage(rows: Item[]): Item[];

  // ---- Slide DOM, the same shared slideBuilder instance.
  createSlideShell(item: Item): HTMLElement;

  // ---- The saved collection (app.js-owned, localStorage-backed) -- read
  // wholesale here for collection-filtered mode, one item at a time
  // elsewhere via ISlideBuilderHost's isCollected/toggleCollect.
  getCollection(): string[];
  collectionKeyFor(item: Item): string;

  // ---- Which mode is active right now.
  getFilterState(): FeedFilterState;
  // Read-and-clear atomically so a second render() never re-honours a
  // link already consumed.
  consumeDeepLinkSlug(): string | null;

  // ---- Slide templates that need app.js's own private `facets`/copy.
  buildIntroSlide(): HTMLElement;
  buildEmptyCollectionSlide(): HTMLElement;

  // ---- Analytics bookkeeping unrelated to feed mechanics, reset per
  // render() since a freshly filtered view is a new scroll session.
  resetScrollDepthTracking(): void;

  // ---- Sibling component wiring app.js still mediates -- this element
  // does not reach into <tranquilo-music-toggle> directly.
  observeMusicSlides(): void;
}
