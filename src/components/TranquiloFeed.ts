// The feed itself (the paged, infinitely-scrolling column of artwork
// slides), as a native custom element wrapping the slide-DOM primitives
// and paging/recycling-window logic extracted earlier.
//
// Same property-assignment host as ITopbarHost (`feedEl.app = {...}`),
// same reason. Unlike the topbar, render() rebuilds the whole feed from
// scratch on every mode switch, so it has to ASK app.js which filter is
// active on every call rather than being told. See
// src/types/ITranquiloFeedHost.ts for the full contract.
//
// app.js still creates one shared slideBuilder and one shared
// recycleWindow instance, reached through the host like every other
// extracted module. slideRecords is the exception: truly feed-exclusive,
// so it lives here as a public property that app.js's
// createRecycleWindow() setup reads by reference.
//
// Renders into light DOM: every style already lives in css/style.css.
// Unlike the topbar/search bar, this element's content is entirely
// data-driven and only changes because app.js called render();
// index.html's "feed-loading" placeholder is left alone until then.

import type { Pager } from "../feed/recycleWindow";
import { HERO_COUNT, pickHeroes } from "../logic/logic";
import type {
  FeedFilterState,
  ITranquiloFeedHost,
} from "../types/ITranquiloFeedHost";
import type { Item } from "../types/Item";
import type { SlideRecord } from "../types/SlideRecord";

declare global {
  interface Window {
    // render() is async, so its return doesn't imply "up to date". A
    // counter rather than an event: a test can read it before acting and
    // wait for it to change, race-free in a way an event isn't. See
    // tests/e2e/harness.mts.
    __tranquiloFeedRenders?: number;
    // Set by a test to get a deterministic hero pick instead of
    // Math.random() -- see heroRandom() below.
    __tranquiloHeroSeed?: number;
  }
}

// ---- Feed ordering: anchored opening + randomized, decluttered tail ----
// "All Works" opens on hand-picked pieces, then a shuffle that's fixed for
// the session -- filtering into a category and back doesn't reshuffle. The
// pool lives in Postgres (sql/027_hero_items.sql), fetched once at
// startup; pickHeroes() draws HERO_COUNT per session, avoiding two
// consecutive items of the same medium.
//
// Resolved by id, only for the "All" feed -- a category chip does not
// exclude heroes, so one still appears inline in its own chip's order.
// Shown only to a first-time visitor, since a returning supporter wants
// the catalogue, not the welcome mat.
const SEEN_FEED_KEY = "tranquilo:hasSeenFeed";

function shouldShowHeroes(): boolean {
  try {
    return !localStorage.getItem(SEEN_FEED_KEY);
  } catch (_e) {
    return true; // private mode: treat as first visit
  }
}

function markFeedSeen(): void {
  try {
    localStorage.setItem(SEEN_FEED_KEY, "1");
  } catch (_e) {
    // best-effort
  }
}

// Randomness is injectable so e2e tests can be deterministic -- rotating
// heroes made slide positions vary per load, flaking position-dependent
// tests. Production gets Math.random; a test sets window.__tranquiloHeroSeed.
function heroRandom(): (() => number) | null {
  const seed = window.__tranquiloHeroSeed;
  if (typeof seed !== "number") return null; // -> pickHeroes uses Math.random
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// How close to the end of the loaded shells the visitor gets before the
// next page is requested -- comfortably more than RECYCLE_RADIUS, so the
// fetch is already in flight by the time the recycling window wants those
// slides.
const FEED_PREFETCH_SLIDES = 20;

// Debounced and gated on the value actually changing, since
// updateRecycleWindow() runs every animation frame and browsers throttle
// or warn about rapid history writes.
const URL_SYNC_DEBOUNCE_MS = 250;

// Same transform as encodeSlugId() in src/app.ts, duplicated per this
// codebase's convention of not cross-importing small pure functions
// between src/ modules -- see that copy for why this isn't encodeURI().
// Only "%", "/", "#", "?" and whitespace are escaped; Unicode letters pass
// through as literal text.
function encodeSlugId(source: string, rawId: string): string {
  let idPart = rawId;
  let m: any;
  if (source === "commons" && idPart.slice(0, 5) === "File:") {
    idPart = idPart.slice(5);
  } else if (source === "europeana") {
    m = /^\/([0-9]+)\/(.+)$/.exec(idPart);
    if (m) idPart = `${m[1]}-${m[2]}`;
  }
  return idPart.replace(/[%/#?\s]/g, encodeURIComponent);
}

export class TranquiloFeed extends HTMLElement {
  app: ITranquiloFeedHost | null = null;

  // One record per child, in DOM order, including the intro slide (marked
  // permanent) -- keeps record index and DOM child index the same number.
  //
  // READ BEFORE TOUCHING ANYTHING THAT MAPS A POSITION TO AN ITEM: record
  // index and DOM index agree, but record index and ITEM index do NOT, and
  // how far they disagree depends on the mode ("All" has an intro slide at
  // 0 so item N is record N+1; search/artist/concept and deep links have
  // no intro so item N is record N; an empty collection is one non-item
  // slide alone). This off-by-one has caused real bugs before (a "skip the
  // intro" flag set in a branch that never appended one silently opened a
  // deep link on the wrong artwork). The rule that prevents it: record
  // whether a non-item slide was actually appended, and derive any
  // positional decision from that fact -- never assert an offset a branch
  // didn't create. render()'s `introAdded` is the worked example.
  //
  // Public: app.js's createRecycleWindow() setup needs the same array, by
  // reference.
  slideRecords: SlideRecord[] = [];

  // The hero-rotation pool (sql/027_hero_items.sql), assigned once by
  // app.ts's init fetch. Each entry is {source, native_id, media_type};
  // pickHeroes() below narrows it to one session's actual pick.
  heroPool: { source: string; native_id: string; media_type: string }[] = [];

  private feedPager: Pager | null = null;
  private activeRenderToken = 0;
  private feedRenderCount = 0;
  private urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncedUrl: string | null = null;

  // Picked once per page load, so filtering into a category and back to
  // "All" keeps the same opening rather than reshuffling under the visitor.
  // null until the first render() that actually needs it.
  private sessionHeroes:
    | { source: string; native_id: string; media_type: string }[]
    | null = null;

  private pickSessionHeroes(): {
    source: string;
    native_id: string;
    media_type: string;
  }[] {
    if (this.sessionHeroes) return this.sessionHeroes;
    this.sessionHeroes = pickHeroes(this.heroPool, HERO_COUNT, heroRandom());
    return this.sessionHeroes;
  }

  connectedCallback(): void {
    // The markup this replaces was a <main>, with an implicit `main`
    // landmark role -- a custom element gets no such default.
    this.setAttribute("role", "main");
  }

  private requireApp(): ITranquiloFeedHost {
    if (!this.app) {
      throw new Error("<tranquilo-feed>: called before app was set");
    }
    return this.app;
  }

  // onSettled (optional) fires once every slide for this render pass is
  // actually in the DOM, synchronously or after the background append.
  //
  // Each mode resolves to a set of server parameters rather than a
  // predicate, mirroring app.js's mutually-exclusive activeCategory/
  // activeSearch/activeArtist/activeCollectionFilter chain, with
  // activeStorylineFilter ANDing on top.
  //
  // Two modes are deliberately not paged, since both are already bounded:
  // the collection (capped by MAX_IDS) and a deep link (one item deciding
  // where the ordinary feed starts).
  render(onSettled?: () => void): void {
    const host = this.requireApp();
    host.resetScrollDepthTracking();
    host.resetRecycleWindow();
    this.innerHTML = "";
    this.feedPager = null;
    // Invalidated so a page still in flight from the previous mode can't
    // append its shells into this one -- otherwise switching category
    // mid-fetch splices old items into the new feed.
    const renderToken = ++this.activeRenderToken;

    const state: FeedFilterState = host.getFilterState();
    // Single-use, so a second render() never re-honours a link already
    // resolved.
    const deepLinkSlug = host.consumeDeepLinkSlug();

    const params: Record<string, unknown> = {};
    let checkCategory = false;
    // Tracks whether an intro slide was actually added -- see
    // slideRecords' header comment on the off-by-one this guards against.
    let introAdded = false;
    let leadingItems: Item[] | null = null; // heroes, ahead of the pager's first page
    let fixedItems: Item[] | null = null; // a complete, unpaged set (collection)

    if (state.concept) {
      // Each CONCEPT_MAP entry names a server filter rather than a
      // predicate over an array the client no longer has.
      const filter = state.concept.filter;
      Object.keys(filter).forEach((k) => {
        params[k] = filter[k];
      });
    } else if (state.search) {
      params.q = state.search;
    } else if (state.artist) {
      params.artist = state.artist;
    } else if (state.collectionFilter) {
      fixedItems = [];
    } else if (deepLinkSlug) {
      // A deep link is honoured by ordering, not scrolling -- see
      // resolveSlug() below. No intro slide: the deep-linked item is
      // record 0.
    } else {
      const introEl = host.buildIntroSlide();
      this.appendChild(introEl);
      this.slideRecords.push({
        el: introEl,
        item: null,
        permanent: true,
        hydrated: true,
      });
      introAdded = true;
      if (state.category === "All") {
        checkCategory = true;
        // Heroes lead the unfiltered "All" feed only -- with the storyline
        // filter on, prepending openers that haven't been through it would
        // put untagged items in a feed claiming everything carries a
        // storyline. Only for a first-time visitor: shouldShowHeroes() is
        // per-device (localStorage), deliberately, since a returning
        // visitor is returning whether or not they closed the tab.
        if (!state.storylineFilter && shouldShowHeroes()) leadingItems = [];
      } else {
        params.category = state.category;
      }
    }

    if (state.storylineFilter) {
      params.has_storyline = "1";
    }

    // Derived, never set by a branch. An intro is skipped only when one
    // exists and the visitor asked for something specific.
    const skipIntroToFirstItem =
      introAdded && (state.category !== "All" || state.storylineFilter);

    // Everything below settles the first screenful, then hands off to the
    // pager -- one promise chain so every mode finishes through the same
    // path.
    let firstBatch: Promise<Item[]>;
    if (fixedItems) {
      const collected = host.getCollection();
      const ids = collected.map((entry) => {
        // A collection entry is either a source-qualified key or a bare id
        // depending on when it was saved; ?ids= matches native_id, so the
        // qualifier is stripped here.
        const colon = String(entry).indexOf(":");
        return colon === -1 ? String(entry) : String(entry).slice(colon + 1);
      });
      firstBatch = ids.length
        ? host
            .resolveItemsByIds(ids)
            .then((rows) =>
              // Same membership test as the client filter, applied to what
              // came back rather than the catalogue.
              rows.filter(
                (i) =>
                  collected.indexOf(host.collectionKeyFor(i)) !== -1 ||
                  collected.indexOf(String(i.id)) !== -1,
              ),
            )
            .catch((err) => {
              console.error("items: collection lookup failed", err);
              return [];
            })
        : Promise.resolve([]);
    } else if (deepLinkSlug) {
      firstBatch = this.resolveSlug(deepLinkSlug).then((target) => {
        const pager = host.createPager(params, checkCategory);
        if (target && typeof target.shuffle_key === "number") {
          pager.start = target.shuffle_key;
        }
        this.feedPager = pager;
        return host
          .loadNextPage(pager)
          .then((page) => host.fillFirstScreen(pager, page));
      });
    } else {
      let heroExclusions: Record<string, boolean> | null = null;
      if (leadingItems) {
        heroExclusions = {};
        const exclusions = heroExclusions;
        // Only what this session opens with -- excluding the whole pool
        // would hide the rest of its good items from the tail.
        this.pickSessionHeroes().forEach((h) => {
          exclusions[String(h.native_id)] = true;
        });
      }
      const pager = host.createPager(params, checkCategory, heroExclusions);
      this.feedPager = pager;
      firstBatch = (leadingItems ? this.fetchHeroItems() : Promise.resolve([]))
        .then((heroes) => {
          leadingItems = heroes;
          return host.loadNextPage(pager);
        })
        .then((page) => host.fillFirstScreen(pager, page));
    }

    firstBatch
      .then((firstPage) => {
        // A mode switch landed while this was in flight; its shells belong
        // to a feed that no longer exists.
        if (renderToken !== this.activeRenderToken) return;

        let initial = (leadingItems || []).concat(firstPage || []);
        if (fixedItems) initial = firstPage || [];
        // Only once something is genuinely on screen -- marking it at
        // render start would burn the first impression on a failed load.
        if (initial.length) markFeedSeen();

        if (!initial.length && state.collectionFilter) {
          const emptyEl = host.buildEmptyCollectionSlide();
          this.appendChild(emptyEl);
          this.slideRecords.push({
            el: emptyEl,
            item: null,
            permanent: true,
            hydrated: true,
          });
          this.scrollTop = 0;
          host.observeMusicSlides();
          this.markFeedSettled(onSettled);
          return;
        }

        this.appendSlides(initial);

        // scrollTop has to be set after the shells are in the DOM -- earlier
        // just gets clamped back to 0.
        const secondChild = this.children[1];
        if (skipIntroToFirstItem && secondChild) {
          this.scrollTop = (secondChild as HTMLElement).offsetTop;
        } else {
          this.scrollTop = 0;
        }
        host.observeMusicSlides();
        host.updateRecycleWindow();
        this.markFeedSettled(onSettled);
      })
      .catch((err) => {
        // A failed render still settles -- a waiter that never resolves
        // turns one broken fetch into a hung page.
        console.error("items: feed render failed", err);
        this.markFeedSettled(onSettled);
      });
  }

  private markFeedSettled(onSettled?: () => void): void {
    this.feedRenderCount++;
    window.__tranquiloFeedRenders = this.feedRenderCount;
    if (onSettled) onSettled();
  }

  // Shells for a batch of items, appended in one fragment. data-category
  // rides on the shell so the music observer sees every slide regardless
  // of hydration and never needs re-targeting -- hence observeMusicSlides()
  // re-running after append.
  private appendSlides(batch: Item[]): void {
    if (!batch?.length) return;
    const host = this.requireApp();
    const fragment = document.createDocumentFragment();
    batch.forEach((item) => {
      const shell = host.createSlideShell(item);
      fragment.appendChild(shell);
      this.slideRecords.push({
        el: shell,
        item,
        permanent: false,
        hydrated: false,
      });
    });
    this.appendChild(fragment);
  }

  // Called from the recycling window every frame. Requests the next page
  // once the visitor is within FEED_PREFETCH_SLIDES of the end of what's
  // loaded. loadNextPage() collapses concurrent calls onto one request,
  // which is what makes calling this per frame safe.
  maybeLoadMoreSlides(): void {
    const host = this.requireApp();
    if (!this.feedPager || this.feedPager.exhausted || this.feedPager.inFlight)
      return;
    if (
      host.activeSlideIndex() <
      this.slideRecords.length - FEED_PREFETCH_SLIDES
    )
      return;
    const token = this.activeRenderToken;
    const pager = this.feedPager;
    host.loadNextPage(pager).then((page) => {
      if (token !== this.activeRenderToken || pager !== this.feedPager) return;
      if (!page.length) return;
      this.appendSlides(page);
      host.observeMusicSlides();
      host.updateRecycleWindow();
    });
  }

  // Resolve a share slug to its item. slugFor() is `(source||"met")+"-"+id`,
  // so the source is everything before the first hyphen (ids legitimately
  // contain hyphens, sources don't). The source then disambiguates, since
  // ?ids= matches native_id alone and some items share one across sources.
  private resolveSlug(slug: string): Promise<Item | null> {
    const host = this.requireApp();
    const raw = String(slug || "");
    const cut = raw.indexOf("-");
    if (cut === -1) return Promise.resolve(null);
    const source = raw.slice(0, cut);
    const id = raw.slice(cut + 1);
    if (!id) return Promise.resolve(null);
    return host
      .fetchItemsByIds([id])
      .then((body) => {
        const rows = host.absorbPage(body.items || []);
        const exact = rows.filter((i) => (i.source || "met") === source);
        return exact[0] || rows[0] || null;
      })
      .catch((err) => {
        // A feed starting at a random offset beats no feed, so a failed
        // lookup degrades to an ordinary session.
        console.error("items: deep-link lookup failed", err);
        return null;
      });
  }

  private fetchHeroItems(): Promise<Item[]> {
    const host = this.requireApp();
    const picked = this.pickSessionHeroes();
    // resolveItemsByIds(), not fetchItemsByIds()+absorbPage(): absorbPage()
    // marks rows `_full = false`, which is wrong here since ?ids= returns
    // fully hydrated rows -- absorbing them as unhydrated made the
    // recycling window immediately re-fetch the same ids.
    return host
      .resolveItemsByIds(picked.map((h) => h.native_id))
      .catch((err) => {
        // A missing opener is a worse feed, not a broken one.
        console.error("items: hero lookup failed", err);
        return [];
      });
  }

  // Keeps the address bar pointing at whatever is on screen, so the URL is
  // a copyable reference to a specific artwork. replaceState, not
  // pushState: pushing an entry per slide would turn the back button into
  // a slide-by-slide rewind.
  private syncUrlToActiveSlide(): void {
    const host = this.requireApp();
    if (!this.slideRecords.length) return;
    const rec = this.slideRecords[host.activeSlideIndex()];
    // The intro slide has no item; that is the top of the feed, which is "/".
    const url =
      rec?.item != null
        ? `/v/${rec.item.source || "met"}-${encodeSlugId(rec.item.source || "met", rec.item.id)}`
        : "/";
    if (url === this.lastSyncedUrl) return;
    this.lastSyncedUrl = url;
    try {
      history.replaceState(null, "", url);
    } catch {
      // A file:// origin or a sandboxed frame rejects this; the feed works
      // fine without a synced URL, so this must never be fatal.
    }
  }

  // Called from the recycling window every frame, debounced since
  // updateRecycleWindow() runs every animation frame and browsers throttle
  // or warn about rapid history writes.
  scheduleUrlSync(): void {
    if (this.urlSyncTimer) clearTimeout(this.urlSyncTimer);
    this.urlSyncTimer = setTimeout(
      () => this.syncUrlToActiveSlide(),
      URL_SYNC_DEBOUNCE_MS,
    );
  }
}

customElements.define("tranquilo-feed", TranquiloFeed);
