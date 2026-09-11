// Server paging and the recycling window, split out of app.js. Not a
// custom element -- called as plain functions via createRecycleWindow()
// below, consumed the same way by <tranquilo-feed>.
//
// State genuinely this module's own (the hydrated band, hydrate
// queue/debounce, in-flight tracking) stays internal. State shared with
// app.js's feed code (the item cache, DOM-order slide records) is passed
// in via `config` by reference. One exception: resetRecycleWindow() must
// empty slideRecords in place (`slideRecords.length = 0`) rather than
// reassign it, or app.js's own binding would go stale.
//
// What this module can't do without reaching into app.js's private
// closures -- fetching a feed page, resolving ids, building a hydrated
// slide's DOM, extending the feed when the visitor nears the end -- goes
// through the host object: this module owns paging and the hydrated
// band, app.js owns the network layer and the feed-extension decision.

import {
  declusterPageOrder,
  recycleDelta,
  recycleWindowFor,
} from "../logic/logic";
import type { Item } from "../types/Item";
import type { SlideRecord } from "../types/SlideRecord";
import type { ImageState } from "./slideBuilder";

export interface Pager {
  params: Record<string, unknown>;
  // Ids this pager must not return, because something else already put
  // them on screen (the five hero items leading the "All" feed). A
  // Record used as a set, mirroring app.js's own `{ id: true }` shape.
  excludeIds: Record<string, boolean> | null;
  start: number;
  cursor: string | null;
  carry: Item | null;
  exhausted: boolean;
  inFlight: Promise<Item[]> | null;
  checkCategory: boolean;
}

interface FeedPageResponse {
  items?: Item[];
  next_cursor?: string | null;
}

interface IdsResponse {
  items?: Item[];
  missing?: string[];
}

export interface IRecycleWindowHost {
  fetchFeedPage(params: Record<string, unknown>): Promise<FeedPageResponse>;
  fetchItemsByIds(ids: string[]): Promise<IdsResponse>;
  // Folds fetched rows into the shared item cache, preserving object
  // identity for rows already seen, since the feed, collection and every
  // SlideRecord alias these objects.
  absorbPage(rows: Item[]): Item[];
  // Fills a hydrated slide's real DOM, injected via config so a test can
  // substitute its own stub without depending on slideBuilder.ts.
  buildSlideContents(item: Item, el: HTMLElement): ImageState;
  // Extends the feed itself near the end of what's loaded -- a decision
  // about the feed, not the hydrated band this module owns.
  maybeLoadMoreSlides(): void;
  // Called once per scheduleRecycleUpdate() rAF pass, after
  // updateRecycleWindow() -- app.js hooks scheduleUrlSync() here.
  onWindowUpdated(): void;
}

export function createRecycleWindow(
  host: IRecycleWindowHost,
  config: {
    feedEl: HTMLElement;
    items: Item[];
    itemsById: Record<string, Item>;
    itemsByKey: Record<string, Item>;
    slideRecords: SlideRecord[];
    feedPageSize: number;
  },
) {
  // ---- Pager ----
  //
  // A pager holds one feed mode (the filters that define it), where paging
  // has reached, and the carry item. Switching category or search builds a
  // new one; scrolling extends the current one.
  function createPager(
    params: Record<string, unknown>,
    checkCategory?: boolean,
    excludeIds?: Record<string, boolean> | null,
  ): Pager {
    return {
      params,
      excludeIds: excludeIds || null,
      // The per-session start offset -- variety comes from this plus the
      // nightly re-keying of shuffle_key, not a per-request sort the
      // database can't index.
      start: Math.random(),
      cursor: null,
      carry: null,
      exhausted: false,
      inFlight: null,
      // declusterOrder()'s category constraint is only satisfiable across
      // a mixed set, so it stays on for the "All" tail and off elsewhere.
      checkCategory: !!checkCategory,
    };
  }

  // One page, declustered against the previous one. Concurrent calls
  // collapse onto the in-flight request, since updateRecycleWindow() runs
  // every frame and a fast scroll would otherwise fire the same fetch
  // repeatedly.
  function loadNextPage(pager: Pager): Promise<Item[]> {
    if (pager.exhausted) return Promise.resolve([]);
    if (pager.inFlight) return pager.inFlight;
    const q: Record<string, unknown> = {};
    Object.keys(pager.params).forEach((k) => {
      q[k] = pager.params[k];
    });
    if (pager.cursor) {
      q.cursor = pager.cursor;
    } else {
      q.start = pager.start;
    }
    pager.inFlight = host
      .fetchFeedPage(q)
      .then((body) => {
        pager.inFlight = null;
        pager.cursor = body.next_cursor ?? null;
        // null means the session has seen the whole filtered set -- the
        // server pages forward from the start offset, wraps once, stops.
        if (!body.next_cursor) pager.exhausted = true;
        let page = host.absorbPage(body.items || []);
        if (pager.excludeIds) {
          const exclude = pager.excludeIds;
          page = page.filter((i) => !exclude[String(i.id)]);
        }
        const ordered = declusterPageOrder(
          page,
          pager.carry,
          pager.checkCategory,
        );
        if (ordered.length) pager.carry = ordered[ordered.length - 1];
        return ordered;
      })
      .catch((err) => {
        pager.inFlight = null;
        // Stop paging rather than retrying forever -- the feed keeps
        // whatever it has, a short feed rather than a broken one.
        pager.exhausted = true;
        console.error("items: feed page failed", err);
        return [];
      });
    return pager.inFlight;
  }

  // Load pages until there are enough items to fill the opening screen, or
  // the pager runs out. One page isn't one screenful, since a session
  // starts at a random offset and the first phase only returns rows above
  // it -- a narrow filter can otherwise look like it found far fewer
  // matches until the wrap delivers the rest.
  function fillFirstScreen(pager: Pager, firstPage?: Item[]): Promise<Item[]> {
    let collected = firstPage || [];
    function more(): Promise<Item[]> {
      if (collected.length >= config.feedPageSize || pager.exhausted) {
        return Promise.resolve(collected);
      }
      return loadNextPage(pager).then((page) => {
        if (!page.length && pager.exhausted) return collected;
        collected = collected.concat(page);
        return more();
      });
    }
    return more();
  }

  // ---- The recycling window ----
  //
  // Paging removes the bounded, one-time catalogue cost that let nothing
  // ever release a slide before -- without a window, scrolling far enough
  // grows the DOM and decoded-image set without limit. So: keep
  // RECYCLE_RADIUS slides hydrated either side of the active one and
  // release the rest, making peak cost a constant instead of a function
  // of scroll distance.
  //
  // Three things keep this cheap: .slide is height:100svh so an emptied
  // slide keeps its exact geometry (no spacers, no jitter);
  // blur_placeholder is on the item so a re-entering slide paints
  // immediately from memory; data-category lives on the shell so the
  // music observer sees every slide regardless of hydration.
  const RECYCLE_RADIUS = 5;
  let hydratedLo = 0;
  let hydratedHi = -1; // inclusive; empty when hi < lo

  function hydrateSlide(rec: SlideRecord): void {
    if (rec.permanent || rec.hydrated) return;
    // The manifest has no title, medium or image URL, so there's nothing
    // to build yet -- the slide stays an empty shell until
    // buildWindowContents() picks it up once ensureHydrated() lands data.
    if (!rec.item?._full) return;
    rec.imageState = host.buildSlideContents(rec.item, rec.el);
    rec.hydrated = true;
  }

  function dehydrateSlide(rec: SlideRecord): void {
    if (rec.permanent || !rec.hydrated) return;
    // cancel() is not optional: a pending failure timer on a slide
    // nobody's looking at would fire and permanently blacklist the item,
    // and it unobserves the frame since the shared visibility observer
    // holds a strong reference to everything it observes.
    rec.imageState?.cancel();
    // Drop the src before detaching so the decoded bitmap is collectable
    // promptly. removeAttribute, not src="", which some browsers treat as
    // a request for the page URL; cancel() already removed the listeners.
    const img = rec.el.querySelector("img");
    if (img) img.removeAttribute("src");
    rec.el.textContent = "";
    rec.imageState = null;
    rec.hydrated = false;
  }

  // Builds anything inside the current band that has data but no DOM yet.
  // Cheap and idempotent, so it's safe to call whenever data arrives
  // without tracking which slide was waiting on what.
  function buildWindowContents(): void {
    for (let i = hydratedLo; i <= hydratedHi; i++) {
      const rec = config.slideRecords[i];
      if (rec && !rec.permanent && !rec.hydrated && rec.item?._full) {
        hydrateSlide(rec);
      }
    }
  }

  // Data runs well ahead of the DOM: building a slide is expensive and
  // bounded to RECYCLE_RADIUS, but fetching one is cheap and should be far
  // enough ahead that scrolling never catches up. 30 either side is ~61
  // ids, comfortably inside the endpoint's MAX_IDS of 500.
  const HYDRATE_RADIUS = 30;
  const hydrateInFlight: Record<string, boolean> = {};

  // Requests are coalesced before sending -- issuing a fetch per window
  // change would mean a fetch per animation frame (measured: a single
  // scroll from top to slide 60 once produced 44 separate requests). Ids
  // accumulate into a queue and flush together on a short timer.
  const HYDRATE_DEBOUNCE_MS = 120;
  let hydrateQueue: Record<string, boolean> = {};
  let hydrateTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureHydrated(lo: number, hi: number): void {
    let queued = false;
    for (
      let i = Math.max(0, lo);
      i <= Math.min(config.slideRecords.length - 1, hi);
      i++
    ) {
      const rec = config.slideRecords[i];
      if (!rec || rec.permanent || !rec.item) continue;
      if (
        rec.item._full ||
        hydrateInFlight[rec.item.id] ||
        hydrateQueue[rec.item.id]
      )
        continue;
      hydrateQueue[rec.item.id] = true;
      queued = true;
    }
    if (queued && !hydrateTimer) {
      hydrateTimer = setTimeout(flushHydrateQueue, HYDRATE_DEBOUNCE_MS);
    }
  }

  function flushHydrateQueue(): void {
    hydrateTimer = null;
    const need = Object.keys(hydrateQueue);
    hydrateQueue = {};
    if (!need.length) return;
    // A band of 61 can't reach MAX_IDS (500), but a coalesced burst across
    // several band moves could, so this is chunked rather than trusted to
    // stay small.
    const MAX_PER_REQUEST = 200;
    for (let start = 0; start < need.length; start += MAX_PER_REQUEST) {
      fetchHydrationBatch(need.slice(start, start + MAX_PER_REQUEST));
    }
  }

  function fetchHydrationBatch(need: string[]): void {
    need.forEach((id) => {
      hydrateInFlight[id] = true;
    });
    host
      .fetchItemsByIds(need)
      .then((body) => {
        (body.items || []).forEach((full) => {
          const target = config.itemsById[full.id];
          // Merged into the existing object, never swapped -- items,
          // itemsById and every SlideRecord.item alias the same reference.
          if (target) {
            for (const k in full) {
              if (Object.hasOwn(full, k)) {
                (target as unknown as Record<string, unknown>)[k] = (
                  full as unknown as Record<string, unknown>
                )[k];
              }
            }
            target._full = true;
          }
        });
        // Anything the server couldn't return must not be retried forever
        // -- marking it _full leaves it a permanent empty shell instead.
        if (body.missing?.length) {
          body.missing.forEach((id) => {
            const target = config.itemsById[id];
            if (target) {
              target._full = true;
              target._unavailable = true;
            }
          });
          console.warn(
            `items: ${body.missing.length} id(s) could not be loaded`,
          );
        }
        need.forEach((id) => {
          delete hydrateInFlight[id];
        });
        buildWindowContents();
      })
      .catch((err) => {
        // Release the in-flight marks so a later pass can retry.
        need.forEach((id) => {
          delete hydrateInFlight[id];
        });
        console.error("items: hydration failed", err);
      });
  }

  // Hydrate an explicit set of items and resolve when ready. The window
  // hydrates what the feed is about to show; everything else that renders
  // an item -- storyline chapters, shelves, the detail modal -- has to ask.
  function hydrateItems(items: Item[]): Promise<void> {
    const need: string[] = [];
    (items || []).forEach((i) => {
      if (i && !i._full && need.indexOf(i.id) === -1) need.push(i.id);
    });
    if (!need.length) return Promise.resolve();
    return host
      .fetchItemsByIds(need)
      .then((body) => {
        (body.items || []).forEach((full) => {
          const target = config.itemsById[full.id];
          if (target) {
            for (const k in full) {
              if (Object.hasOwn(full, k)) {
                (target as unknown as Record<string, unknown>)[k] = (
                  full as unknown as Record<string, unknown>
                )[k];
              }
            }
            target._full = true;
          }
        });
        (body.missing || []).forEach((id) => {
          const target = config.itemsById[id];
          if (target) {
            target._full = true;
            target._unavailable = true;
          }
        });
      })
      .catch((err) => {
        // Render with what we have rather than showing nothing -- a
        // caption without its image beats a blank overlay.
        console.error("items: hydration for a curated surface failed", err);
      });
  }

  // Resolve ids to full items, whether or not the feed has met them --
  // `itemsById` only holds pages this session has actually paged through,
  // so a curated surface naming specific ids routinely references items
  // never loaded. Returns items in the given order, omitting ids the
  // catalogue no longer has.
  function resolveItemsByIds(ids: (string | number)[]): Promise<Item[]> {
    const wanted: string[] = [];
    (ids || []).forEach((id) => {
      const key = String(id);
      if (wanted.indexOf(key) === -1) wanted.push(key);
    });
    if (!wanted.length) return Promise.resolve([]);
    const missing = wanted.filter((id) => {
      const have = config.itemsById[id];
      return !have?._full;
    });
    const done = missing.length
      ? host
          .fetchItemsByIds(missing)
          .then((body) => {
            (body.items || []).forEach((full) => {
              const target = config.itemsById[full.id];
              if (target) {
                for (const k in full) {
                  if (Object.hasOwn(full, k)) {
                    (target as unknown as Record<string, unknown>)[k] = (
                      full as unknown as Record<string, unknown>
                    )[k];
                  }
                }
                target._full = true;
              } else {
                // Never seen: adopt it so every later lookup aliases the
                // same object.
                full._full = true;
                config.items.push(full);
                config.itemsById[full.id] = full;
                config.itemsByKey[`${full.source}:${full.id}`] = full;
              }
            });
            (body.missing || []).forEach((id) => {
              const target = config.itemsById[id];
              if (target) {
                target._full = true;
                target._unavailable = true;
              }
            });
          })
          .catch((err) => {
            // Render with whatever resolved rather than showing nothing.
            console.error("items: id resolution failed", err);
          })
      : Promise.resolve();
    return done.then(() =>
      wanted.map((id) => config.itemsById[id]).filter(Boolean),
    );
  }

  // Every slide is exactly one feed-viewport tall (.slide and .feed are
  // both 100svh), so the active index is a division rather than a
  // per-slide getBoundingClientRect sweep.
  function activeSlideIndex(): number {
    const h = config.feedEl.clientHeight;
    if (!h) return 0;
    return Math.round(config.feedEl.scrollTop / h);
  }

  // The index arithmetic lives in logic.ts so the offline suite can test
  // it directly -- an off-by-one here shows up as a blank slide or one
  // that never releases, and neither announces itself.
  function updateRecycleWindow(): void {
    if (!config.slideRecords.length) return;
    const band = recycleWindowFor(
      activeSlideIndex(),
      config.slideRecords.length,
      RECYCLE_RADIUS,
    );
    if (band.lo === hydratedLo && band.hi === hydratedHi) return;
    const delta = recycleDelta(hydratedLo, hydratedHi, band.lo, band.hi);
    delta.release.forEach((i) => {
      dehydrateSlide(config.slideRecords[i]);
    });
    hydratedLo = band.lo;
    hydratedHi = band.hi;
    delta.hydrate.forEach((i) => {
      hydrateSlide(config.slideRecords[i]);
    });
    // Fetch a much wider band than we build, so scrolling rarely outruns data.
    const active = activeSlideIndex();
    ensureHydrated(active - HYDRATE_RADIUS, active + HYDRATE_RADIUS);
    // Extend the feed itself when the end comes into range -- cheap to
    // call per frame, returns immediately unless near the end.
    host.maybeLoadMoreSlides();
  }

  function resetRecycleWindow(): void {
    // Truncated in place, not reassigned -- shared by reference with
    // app.js's own binding (see this file's header comment).
    config.slideRecords.length = 0;
    hydratedLo = 0;
    hydratedHi = -1;
    // Deliberately not clearing hydrateInFlight: those requests are still
    // wanted regardless of which view is showing the items.
  }

  let recycleFrame: number | null = null;
  function scheduleRecycleUpdate(): void {
    if (recycleFrame) return;
    recycleFrame = requestAnimationFrame(() => {
      recycleFrame = null;
      updateRecycleWindow();
      host.onWindowUpdated();
    });
  }

  return {
    createPager,
    loadNextPage,
    fillFirstScreen,
    hydrateSlide,
    dehydrateSlide,
    buildWindowContents,
    ensureHydrated,
    flushHydrateQueue,
    resolveItemsByIds,
    hydrateItems,
    fetchHydrationBatch,
    activeSlideIndex,
    updateRecycleWindow,
    resetRecycleWindow,
    scheduleRecycleUpdate,
  };
}

export type RecycleWindow = ReturnType<typeof createRecycleWindow>;
