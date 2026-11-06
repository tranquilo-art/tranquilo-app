// app.ts is the single entry point -- index.html loads it via
// `<script type="module" src="src/app.ts">` and nothing else, so every
// other browser module is imported directly here. The custom-element
// imports below are side-effect-only; app.ts never constructs them,
// it looks them up via document.getElementById() once they've upgraded.

import { Analytics } from "./app/Analytics";
import { ArtworkViewTracker } from "./app/ArtworkViewTracker";
import { wireAiDisclosureToggle } from "./app/aiDisclosureToggle";
import { CatalogueCache } from "./app/CatalogueCache";
import { COLLECTION_SOURCES, CollectionStore } from "./app/CollectionStore";
import { ExportService } from "./app/ExportService";
import { FilterState } from "./app/FilterState";
import { ItemsApiClient } from "./app/ItemsApiClient";
import { OverlayHistoryManager } from "./app/OverlayHistoryManager";
import { ScrollDepthTracker } from "./app/ScrollDepthTracker";
import { ScrollTelemetry } from "./app/ScrollTelemetry";
import { SearchController } from "./app/SearchController";
import { ShareService } from "./app/ShareService";
import { SlugCodec } from "./app/SlugCodec";
import {
  isAggregatorSource,
  sourceLinkLabel,
  sourceLinkText,
} from "./app/sourceLinks";
import type { ArtistProfile } from "./data/artist-profiles";
import {
  findArtistProfileForQuery,
  getArtistProfile,
} from "./data/artist-profiles";
import { TRANQUILO_CONFIG } from "./data/config.generated";
import { renderErrorState } from "./errorState";
import { buildEmptyCollectionSlide, buildIntroSlide } from "./feed/introSlides";
import { createRecycleWindow } from "./feed/recycleWindow";
import { createSlideBuilder } from "./feed/slideBuilder";
import {
  applyDocumentLocale,
  currentLocale,
  formatNumber,
  t,
  tHtml,
} from "./i18n/index";
import { hasMasterSize, printLinkEnabled } from "./logic/printOptions";
import type { ITopbarHost } from "./types/ITopbarHost";
import type { ITranquiloDetailModalHost } from "./types/ITranquiloDetailModalHost";
import type { ITranquiloExportModalHost } from "./types/ITranquiloExportModalHost";
import type { ITranquiloFeedHost } from "./types/ITranquiloFeedHost";
import type { ITranquiloLightboxHost } from "./types/ITranquiloLightboxHost";
import type { ITranquiloSetOfWorksModeHost } from "./types/ITranquiloSetOfWorksModeHost";
import type { ITranquiloShelfModeHost } from "./types/ITranquiloShelfModeHost";
import type { ITranquiloShelvesModeHost } from "./types/ITranquiloShelvesModeHost";
import type { ITranquiloStorylineModeHost } from "./types/ITranquiloStorylineModeHost";
import type { Category, Item } from "./types/Item";
import type { MusicBucketKey } from "./types/MusicBucket";
import type { PrintQuoteResult } from "./types/PrintQuote";
import type { SetOfWork, SetOfWorkIndexEntry } from "./types/SetOfWork";
import type { HeroShelf } from "./types/Shelf";
import type { Storyline, StorylineIndexEntry } from "./types/Storyline";

import "./components/TranquiloSupportStrip";
import "./components/TranquiloNewsletterModal";
import type { TranquiloTopbar } from "./components/TranquiloTopbar";
import "./components/TranquiloTopbar";
import type { TranquiloMusicToggle } from "./components/TranquiloMusicToggle";
import "./components/TranquiloMusicToggle";
import type { TranquiloSearchBar } from "./components/TranquiloSearchBar";
import "./components/TranquiloSearchBar";
import type { TranquiloLightbox } from "./components/TranquiloLightbox";
import "./components/TranquiloLightbox";
import type { TranquiloDetailModal } from "./components/TranquiloDetailModal";
import "./components/TranquiloDetailModal";
import type { TranquiloStorylineMode } from "./components/TranquiloStorylineMode";
import "./components/TranquiloStorylineMode";
import type { TranquiloSetOfWorksMode } from "./components/TranquiloSetOfWorksMode";
import "./components/TranquiloSetOfWorksMode";
import type { TranquiloShelvesMode } from "./components/TranquiloShelvesMode";
import "./components/TranquiloShelvesMode";
import type { TranquiloShelfMode } from "./components/TranquiloShelfMode";
import "./components/TranquiloShelfMode";
import type { TranquiloExportModal } from "./components/TranquiloExportModal";
import "./components/TranquiloExportModal";
import type { TranquiloUpsellToast } from "./components/TranquiloUpsellToast";
import "./components/TranquiloUpsellToast";
import type { TranquiloFeed } from "./components/TranquiloFeed";
import "./components/TranquiloFeed";

import "./analytics/cloudflareBeacon";
import "./analytics/posthog";

class TranquiloApp {
  async start() {
    // First, so <html lang> names the language actually rendered (index.html
    // ships lang="en" as the no-JS default).
    applyDocumentLocale();

    const COLLECTION_KEY = "tranquilo:collection";
    const LAST_TOAST_KEY = "tranquilo:lastToastShownAt";
    const SESSION_TOAST_KEY = "tranquilo:toastShownThisSession";
    const SESSION_SHARE_BANNER_KEY = "tranquilo:shareBannerShownThisSession";
    // Team member's own device-level opt-out (?tranquilo_internal=1/0),
    // not IP-based since dev/team IPs change and there's no server-side
    // beacon filter without Zaraz.
    const INTERNAL_TRAFFIC_KEY = "tranquilo:internalTraffic";

    // One-time localStorage key migration across each rename
    // (artscroll -> Curio -> Tranquilo) so existing collections survive.
    (function migrateLegacyStorageKeys() {
      const legacyMap: Record<string, string> = {
        "artscroll:collection": COLLECTION_KEY,
        "artscroll:lastToastShownAt": LAST_TOAST_KEY,
        "curio:collection": COLLECTION_KEY,
        "curio:lastToastShownAt": LAST_TOAST_KEY,
        "curio:toastShownThisSession": SESSION_TOAST_KEY,
        "curio:musicOn": "tranquilo:musicOn",
        "curio:searchHistory": "tranquilo:searchHistory",
      };
      Object.keys(legacyMap).forEach((oldKey) => {
        const newKey = legacyMap[oldKey];
        const oldValue = localStorage.getItem(oldKey);
        if (oldValue !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, oldValue);
        }
        if (oldValue !== null) {
          localStorage.removeItem(oldKey);
        }
      });
    })();

    // Mirrors each static page's own inline ?tranquilo_internal handling;
    // localStorage is per-origin, so any one page's URL covers the rest.
    (function syncInternalTrafficFlag() {
      const params = new URLSearchParams(location.search);
      if (!params.has("tranquilo_internal")) return;
      if (params.get("tranquilo_internal") === "0") {
        localStorage.removeItem(INTERNAL_TRAFFIC_KEY);
      } else {
        localStorage.setItem(INTERNAL_TRAFFIC_KEY, "1");
      }
    })();

    // ?resetUpsell=1 re-arms the once-per-session Collect toast for
    // testing; clears only the session flag, not the collection itself.
    (function resetUpsellThrottle() {
      const params = new URLSearchParams(location.search);
      if (params.get("resetUpsell") !== "1") return;
      sessionStorage.removeItem(SESSION_TOAST_KEY);
    })();

    // ?resetShareBanner=1 re-arms the once-per-session deep-link share
    // banner for testing, same shape as resetUpsellThrottle above.
    (function resetShareBanner() {
      const params = new URLSearchParams(location.search);
      if (params.get("resetShareBanner") !== "1") return;
      sessionStorage.removeItem(SESSION_SHARE_BANNER_KEY);
    })();

    // Bumping CACHE_BUST_VERSION (config.toml's [cache].bust_version)
    // forces a new edge-cache key after a direct-to-Postgres write that
    // can't wait out the ordinary TTL.
    const CACHE_BUST_VERSION = TRANQUILO_CONFIG.cache.bust_version;

    // Matches api/items.ts's page size by construction (both read
    // config.toml's [feed].page_size); also the window declusterOrder()
    // scans for a same-artist/category swap.
    const FEED_PAGE_SIZE = TRANQUILO_CONFIG.feed.page_size;

    const itemsApi = new ItemsApiClient(
      CACHE_BUST_VERSION,
      FEED_PAGE_SIZE,
      currentLocale(),
    );
    function apiUrl(params: Record<string, unknown>) {
      return itemsApi.apiUrl(params);
    }
    function fetchJson<T>(url: string, what: string) {
      return itemsApi.fetchJson<T>(url, what);
    }
    function fetchFeedPage(params: Record<string, unknown>) {
      return itemsApi.fetchFeedPage(params);
    }
    const printQuotes = new Map<string, Promise<PrintQuoteResult>>();
    function itemPrintQuote(item: Item, product: string, country: string) {
      const key = `${item.source}:${item.id}|${product}|${country}`;
      let quote = printQuotes.get(key);
      if (!quote) {
        quote = itemsApi.fetchPrintQuote(
          `${item.source}:${item.id}`,
          product,
          country,
        );
        quote.catch(() => printQuotes.delete(key));
        printQuotes.set(key, quote);
      }
      return quote;
    }
    let printCountry: Promise<string | null> | null = null;
    function itemPrintCountry(item: Item): Promise<string | null> {
      if (!printLinkEnabled(location.search) || !hasMasterSize(item)) {
        return Promise.resolve(null);
      }
      printCountry ??= itemsApi.fetchPrintRegion().then(
        (r) => r.country,
        () => null,
      );
      return printCountry;
    }
    function fetchFacets() {
      return itemsApi.fetchFacets();
    }
    function fetchStorylineIndex() {
      return itemsApi.fetchStorylineIndex();
    }
    function fetchShelves() {
      return itemsApi.fetchShelves();
    }
    function fetchMusicBuckets() {
      return itemsApi.fetchMusicBuckets();
    }
    function fetchHeroPool() {
      return itemsApi.fetchHeroPool();
    }
    function fetchStorylineDetail(id: string) {
      return itemsApi.fetchStorylineDetail(id);
    }
    function fetchSetOfWorksIndex() {
      return itemsApi.fetchSetOfWorksIndex();
    }
    function fetchSetOfWorkDetail(id: string) {
      return itemsApi.fetchSetOfWorkDetail(id);
    }

    function countMatches(params: Record<string, unknown>) {
      return itemsApi.countMatches(params);
    }

    function fetchItemsByIds(ids: string[]) {
      return itemsApi.fetchItemsByIds(ids);
    }

    function fetchItemsByKeys(keys: string[]) {
      return itemsApi.fetchItemsByKeys(keys);
    }

    const catalogueCache = new CatalogueCache();
    const items = catalogueCache.items;
    const itemsById = catalogueCache.itemsById;
    const itemsByKey = catalogueCache.itemsByKey;
    function absorbPage(rows: Parameters<CatalogueCache["absorbPage"]>[0]) {
      return catalogueCache.absorbPage(rows);
    }

    // Fetched once, in parallel with the storyline index, Discover
    // shelves, music buckets and hero pool -- all small, always-needed,
    // startup-time data with nothing to wait on each other for.
    const initFetches = await Promise.all([
      fetchFacets(),
      fetchStorylineIndex(),
      fetchShelves(),
      fetchMusicBuckets(),
      fetchHeroPool(),
      fetchSetOfWorksIndex(),
    ]);
    const facets = initFetches[0];
    const storylineIndex = initFetches[1];
    const shelves = initFetches[2];
    const musicBuckets = initFetches[3];
    const heroPool = initFetches[4];
    const setOfWorksIndex = initFetches[5];
    const categoryToMusicBucket = {} as Record<Category, MusicBucketKey>;
    (Object.keys(musicBuckets) as MusicBucketKey[]).forEach((key) => {
      const category = musicBuckets[key].category;
      if (category) categoryToMusicBucket[category] = key;
    });
    const categories = ["All"].concat(
      (facets.categories ?? []).map((c) => c.value),
    );
    const storylinesById: Record<string, StorylineIndexEntry> = {};
    storylineIndex.forEach((s) => {
      storylinesById[s.id] = s;
    });
    const setOfWorksById: Record<string, SetOfWorkIndexEntry> = {};
    setOfWorksIndex.forEach((s) => {
      setOfWorksById[s.id] = s;
    });
    // Postgres can't derive this itself, so it's computed here from the
    // storyline index fetched alongside it.
    const storylinesShelf = shelves.find((s) => s.id === "storylines") as
      | HeroShelf
      | undefined;
    if (storylinesShelf) {
      storylinesShelf.itemIds = storylineIndex.map((s) => ({
        id: s.cover_item_id,
        source: s.cover_source,
      }));
    }
    // Lazy cache: only populated once a storyline is actually opened.
    const storylineDetailById: Record<string, Storyline> = {};
    function resolveStorylineDetail(id: string) {
      if (storylineDetailById[id])
        return Promise.resolve(storylineDetailById[id]);
      return fetchStorylineDetail(id)
        .then((storyline) => {
          storylineDetailById[id] = storyline;
          return storyline;
        })
        .catch((err: unknown) => {
          console.error("storylines: detail fetch failed", err);
          return null;
        });
    }
    const setOfWorkDetailById: Record<string, SetOfWork> = {};
    function resolveSetOfWorkDetail(id: string) {
      if (setOfWorkDetailById[id])
        return Promise.resolve(setOfWorkDetailById[id]);
      return fetchSetOfWorkDetail(id)
        .then((setOfWork) => {
          setOfWorkDetailById[id] = setOfWork;
          return setOfWork;
        })
        .catch((err: unknown) => {
          console.error("set of works: detail fetch failed", err);
          return null;
        });
    }
    const filterState = new FilterState();
    // Deep-linked items render first rather than being scrolled to --
    // scroll-snap fights programmatic scrollTop changes unreliably.
    let pendingDeepLinkSlug: string | null = null;
    // Captured once at share-banner show-time, reused by its dismiss/CTA
    // handlers so every event in the funnel -- not just the impression --
    // is attributable to which entry type (artwork vs storyline) triggered it.
    let shareBannerSource:
      | "artwork"
      | "storyline"
      | "shelf"
      | "discover"
      | null = null;
    let searchResultCount = 0;

    const feedEl = document.getElementById("feed") as TranquiloFeed;
    const lightboxEl = document.getElementById("lightbox") as TranquiloLightbox;
    const scrollHint = document.getElementById("scrollHint") as HTMLElement;
    // index.html carries the English text as a no-JS fallback.
    scrollHint.textContent = t("feed.scrollHint");
    const detailModalEl = document.getElementById(
      "detailModal",
    ) as TranquiloDetailModal;
    // Kept outside the topbar host so SearchController's outside-click
    // check can reference it directly.
    const searchToggle = document.getElementById("searchToggle") as HTMLElement;
    const toastEl = document.getElementById("toast") as HTMLElement;
    const upsellToastEl = document.getElementById(
      "upsellToast",
    ) as TranquiloUpsellToast;
    const storylineModeEl = document.getElementById(
      "storylineMode",
    ) as TranquiloStorylineMode;
    const setOfWorksModeEl = document.getElementById(
      "setOfWorksMode",
    ) as TranquiloSetOfWorksMode;
    const shelvesModeEl = document.getElementById(
      "shelvesMode",
    ) as TranquiloShelvesMode;
    const shelfModeEl = document.getElementById(
      "shelfMode",
    ) as TranquiloShelfMode;
    // Which shelf surface the detail panel steps back to on close.
    let shelfReturnEl: { restore(): void } = shelvesModeEl;
    // Set only when a Discover tile opens a storyline directly, so closing
    // that storyline lands back on Discover rather than the feed.
    let storylineReturnEl: { restore(): void } | null = null;
    const exportModalEl = document.getElementById(
      "exportModal",
    ) as TranquiloExportModal;
    // Assigned as a property, not an attribute, since it carries live
    // functions rather than strings.
    const topbarEl = document.querySelector(".topbar") as TranquiloTopbar;
    const musicToggleEl = document.querySelector(
      "tranquilo-music-toggle",
    ) as TranquiloMusicToggle;
    musicToggleEl.musicBuckets = musicBuckets;
    musicToggleEl.categoryToBucket = categoryToMusicBucket;
    const searchBarEl = document.querySelector(
      "tranquilo-search-bar",
    ) as TranquiloSearchBar;
    searchBarEl.facets = facets;
    searchBarEl.addEventListener("search-submit", (e) => {
      runSearch((e as CustomEvent<{ query: string }>).detail.query);
    });
    searchBarEl.addEventListener("search-close-request", () => {
      requestOverlayClose(closeSearch);
    });
    // Host methods below are wrapped in closures since several targets
    // (recycleWindow rebindings, createSlideShell, etc.) are assigned
    // later in this function, not hoisted -- a direct reference here
    // would capture undefined.
    const feedHost: ITranquiloFeedHost = {
      createPager: (params, checkCategory, excludeKeys) =>
        createPager(params, checkCategory, excludeKeys),
      loadNextPage: (pager) => loadNextPage(pager),
      fillFirstScreen: (pager, firstPage) => fillFirstScreen(pager, firstPage),
      activeSlideIndex: () => activeSlideIndex(),
      updateRecycleWindow: () => {
        updateRecycleWindow();
      },
      resetRecycleWindow: () => {
        resetRecycleWindow();
      },
      resolveItemsByIds: (ids) => resolveItemsByIds(ids),
      resolveItemsByKeys: (keys: string[]) => resolveItemsByKeys(keys),
      fetchItemsByKeys: (keys: string[]) => fetchItemsByKeys(keys),
      absorbPage: (rows) => absorbPage(rows),
      createSlideShell: (item) => createSlideShell(item),
      getCollection: () => getCollection(),
      collectionKeyFor: (item) => collectionKeyFor(item),
      isCollectionKey: (entry: string) =>
        collectionStore.isCollectionKey(entry),
      getFilterState: () => filterState.snapshot(),
      // Read-and-clear atomically, so a second render() never re-honours
      // a link already consumed.
      consumeDeepLinkSlug: () => {
        const slug = pendingDeepLinkSlug;
        pendingDeepLinkSlug = null;
        return slug;
      },
      buildIntroSlide: () => buildIntroSlideForFeed(),
      buildEmptyCollectionSlide: () => buildEmptyCollectionSlide(),
      resetScrollDepthTracking: () => {
        resetScrollDepthTracking();
      },
      observeMusicSlides: () => {
        musicToggleEl.observeSlides(feedEl);
      },
    };
    feedEl.app = feedHost;
    feedEl.heroPool = heroPool;
    const lightboxHost: ITranquiloLightboxHost = {
      wireArtworkImageState: (frame, skeleton, img, src, item, tier) =>
        wireArtworkImageState(frame, skeleton, img, src, item, tier),
      applyNudityGate: (frame, item) => {
        applyNudityGate(frame, item);
      },
      sampleArtworkColor: (item, callback) => {
        sampleArtworkColor(item, callback);
      },
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      sourceLinkLabel: (item) => sourceLinkLabel(item),
      isAggregatorSource: (item) => isAggregatorSource(item),
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
    };
    lightboxEl.app = lightboxHost;
    const detailModalHost: ITranquiloDetailModalHost = {
      wireArtworkImageState: (frame, skeleton, img, src, item, tier) =>
        wireArtworkImageState(frame, skeleton, img, src, item, tier),
      applyNudityGate: (frame, item) => {
        applyNudityGate(frame, item);
      },
      sampleArtworkColor: (item, callback) => {
        sampleArtworkColor(item, callback);
      },
      storylineFor: (item) => storylineFor(item),
      storylinePositionLabel: (item, storyline) =>
        storylinePositionLabel(item, storyline),
      setOfWorkFor: (item) => setOfWorkFor(item),
      setOfWorkPositionLabel: (item, setOfWork) =>
        setOfWorkPositionLabel(item, setOfWork),
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      hydrateItems: (items) => hydrateItems(items),
      fetchItemDetail: (item) =>
        itemsApi.fetchItemDetail(`${item.source}:${item.id}`),
      shareItem: (item) => {
        shareItem(item);
      },
      sourceLinkLabel: (item) => sourceLinkLabel(item),
      sourceLinkText: (item) => sourceLinkText(item),
      setArtistFilter: (artist) => {
        setArtistFilter(artist);
      },
      openStorylineMode: (storylineId) => {
        storylineReturnEl = null;
        storylineModeEl.open(storylineId);
      },
      openSetOfWorksMode: (setOfWorkId) => {
        setOfWorksModeEl.open(setOfWorkId);
      },
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
      reopenShelvesMode: () => {
        shelfReturnEl.restore();
      },
      showToast: (msg) => {
        showToast(msg);
      },
      printCountry: (item: Item) => itemPrintCountry(item),
      printQuote: itemPrintQuote,
    };
    detailModalEl.app = detailModalHost;
    detailModalEl.addEventListener("storyline-handoff-restore", (e) => {
      const { id, position } = (
        e as CustomEvent<{ id: string; position: number }>
      ).detail;
      // Reopens at the last-read chapter, not the intro trailer.
      storylineModeEl.open(id, position);
    });
    const storylineModeHost: ITranquiloStorylineModeHost = {
      getItem: (id) => itemsById[id],
      getItemByKey: (key: string) => itemsByKey[key],
      resolveItemsByIds: (ids) => resolveItemsByIds(ids),
      resolveItemsByKeys: (keys: string[]) => resolveItemsByKeys(keys),
      getStorylineDetail: (id) => storylineDetailById[id],
      resolveStorylineDetail: (id) => resolveStorylineDetail(id),
      applyNudityGate: (frame, item, compact) => {
        applyNudityGate(frame, item, compact);
      },
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      openLightbox: (src, alt, item) => {
        lightboxEl.open(src, alt, item);
      },
      shareStoryline: (storyline) => {
        shareStoryline(storyline);
      },
      storylineClosed: () => {
        const returnTo = storylineReturnEl;
        storylineReturnEl = null;
        returnTo?.restore();
      },
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
    };
    storylineModeEl.app = storylineModeHost;
    // Deliberately smaller than storylineModeHost: no shareSetOfWork, and
    // openDetailModal is direct since this mode closes itself first
    // instead of stacking under the detail panel.
    const setOfWorksModeHost: ITranquiloSetOfWorksModeHost = {
      getItem: (id) => itemsById[id],
      getItemByKey: (key: string) => itemsByKey[key],
      resolveItemsByIds: (ids) => resolveItemsByIds(ids),
      resolveItemsByKeys: (keys: string[]) => resolveItemsByKeys(keys),
      getSetOfWorkDetail: (id) => setOfWorkDetailById[id],
      resolveSetOfWorkDetail: (id) => resolveSetOfWorkDetail(id),
      applyNudityGate: (frame, item, compact) => {
        applyNudityGate(frame, item, compact);
      },
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      openLightbox: (src, alt, item) => {
        lightboxEl.open(src, alt, item);
      },
      openDetailModal: (item) => {
        detailModalEl.open(item);
      },
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
    };
    setOfWorksModeEl.app = setOfWorksModeHost;
    // app.ts mediates between sibling components rather than letting
    // them reach into each other directly.
    storylineModeEl.addEventListener("open-detail", (e) => {
      detailModalEl.dispatchEvent(
        new CustomEvent("storyline-handoff-open", {
          detail: (e as CustomEvent).detail,
        }),
      );
    });
    shelvesModeEl.shelves = shelves;
    const shelvesModeHost: ITranquiloShelvesModeHost = {
      resolveItemsByKeys: (keys: string[]) => resolveItemsByKeys(keys),
      apiUrl: (params) => apiUrl(params),
      fetchJson: (url, what) => fetchJson(url, what),
      absorbPage: (rows) =>
        absorbPage(rows as Parameters<typeof absorbPage>[0]),
      resolveItemsByIds: (ids) => resolveItemsByIds(ids),
      hydrateItems: (items) => hydrateItems(items),
      applyNudityGate: (frame, item, compact) => {
        applyNudityGate(frame, item, compact);
      },
      storylineIndex: () => storylineIndex,
      openStoryline: (storylineId) => {
        storylineReturnEl = shelvesModeEl;
        storylineModeEl.open(storylineId);
      },
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      openDetailModal: (item, shelfContext) => {
        shelfReturnEl = shelvesModeEl;
        detailModalEl.open(item, shelfContext);
      },
      shareShelf: (shelf) => {
        shareService.shareShelf(shelf);
      },
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
    };
    shelvesModeEl.app = shelvesModeHost;
    shelfModeEl.shelves = shelves;
    const shelfModeHost: ITranquiloShelfModeHost = {
      resolveItemsByKeys: (keys: string[]) => resolveItemsByKeys(keys),
      apiUrl: (params) => apiUrl(params),
      fetchJson: (url, what) => fetchJson(url, what),
      absorbPage: (rows) =>
        absorbPage(rows as Parameters<typeof absorbPage>[0]),
      resolveItemsByIds: (ids) => resolveItemsByIds(ids),
      hydrateItems: (items) => hydrateItems(items),
      applyNudityGate: (frame, item, compact) => {
        applyNudityGate(frame, item, compact);
      },
      trackEvent: (name, props) => {
        trackEvent(name, props);
      },
      shareShelf: (shelf) => {
        shareService.shareShelf(shelf);
      },
      openDetailModal: (item, shelfContext) => {
        shelfReturnEl = shelfModeEl;
        detailModalEl.open(item, shelfContext);
      },
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
      returnToDiscover: () => {
        shelvesModeEl.open();
      },
    };
    shelfModeEl.app = shelfModeHost;
    const exportModalHost: ITranquiloExportModalHost = {
      pushOverlayHistoryState: (name) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn) => {
        requestOverlayClose(closeFn);
      },
    };
    exportModalEl.app = exportModalHost;
    const topbarHost: ITopbarHost = {
      onCategorySelect: (cat) => {
        filterState.setCategory(cat);
        filterState.setArtist(null);
        filterState.setSearch(null);
        filterState.setConcept(null);
        filterState.setCollectionFilter(false);
        if (searchController.isOpen()) {
          closeOverlaySync(closeSearch);
        }
        hideFilterBanner();
        trackEvent("category_filter", { category: cat });
        renderChips();
        feedEl.render();
      },
      onStorylineFilterToggle: () => {
        const on = filterState.toggleStorylineFilter();
        trackEvent("storyline_filter_toggle", { on });
        renderChips();
        feedEl.render();
      },
      onMusicToggle: () => {
        const on = musicToggleEl.toggle();
        trackEvent("music_toggle", { on: on });
        topbarEl.setMusicActive(on);
      },
      onSearchToggle: () => {
        if (searchController.isOpen()) {
          requestOverlayClose(closeSearch);
        } else {
          openSearch();
        }
      },
      onDiscoverToggle: () => {
        shelvesModeEl.open();
      },
      onCollectionToggle: () => {
        showCollectionView();
      },
      onFilterBannerClear: () => {
        filterState.setArtist(null);
        filterState.setSearch(null);
        filterState.setConcept(null);
        filterState.setCollectionFilter(false);
        hideFilterBanner();
        renderChips();
        feedEl.render();
      },
      onFilterBannerExport: () => {
        trackEvent("export_click", {});
        // Resolves both formats: itemsByKey for source:native_id,
        // itemsById for a legacy entry the migration couldn't resolve.
        const collectedItems = getCollection()
          .map((entry: any) => itemsByKey[entry] || itemsById[entry])
          .filter(Boolean);
        if (collectedItems.length === 0) {
          showToast(t("collection.toast.empty"));
          return;
        }
        exportCollectionCsv(collectedItems);
        exportModalEl.open();
      },
      onShareBannerDismiss: () => {
        trackEvent("share_banner_dismiss", { source: shareBannerSource });
      },
      onShareBannerCtaClick: (cta: "newsletter" | "get_involved") => {
        trackEvent("share_banner_cta_click", {
          cta,
          source: shareBannerSource,
        });
      },
    };
    topbarEl.app = topbarHost;

    wireAiDisclosureToggle();

    const analytics = new Analytics(INTERNAL_TRAFFIC_KEY);
    const PAGE_LOAD_ID = analytics.pageLoadId;

    function trackEvent(name: any, props: any) {
      analytics.track(name, props);
    }

    const slugCodec = new SlugCodec();
    function encodeSlugId(source: any, rawId: any) {
      return slugCodec.encodeId(source, rawId);
    }

    const shareService = new ShareService({
      trackEvent: (name: any, props: any) => trackEvent(name, props),
      showToast: (msg: any) => showToast(msg),
      encodeSlugId: (source: any, rawId: any) => encodeSlugId(source, rawId),
    });
    // biome-ignore lint/correctness/noUnusedVariables: tests/storyline-share.test.ts asserts this wrapper's presence in app.ts's own source text.
    function storylineShareUrlFor(storyline: any) {
      return shareService.storylineShareUrlFor(storyline);
    }
    function shareItem(item: any) {
      shareService.shareItem(item);
    }
    function shareStoryline(storyline: any) {
      shareService.shareStoryline(storyline);
    }

    topbarEl.setMusicActive(musicToggleEl.isOn);

    // accentColor is precomputed server-side, at ingestion,
    // rather than sampled live via canvas, since the Met CDN's WAF
    // blocks cross-origin canvas reads (CORS) though plain <img> tags
    // work fine. Falls back to null (flat background) if ever missing.
    const slideBuilder = createSlideBuilder(
      {
        trackEvent: trackEvent,
        isCollected: isCollected,
        toggleCollect: (item: any) => {
          const nowCollected = toggleCollect(item);
          trackEvent("collect_toggle", {
            id: item.id,
            collected: nowCollected,
          });
          updateCollectionToggle();
          if (filterState.getCollectionFilter() && !nowCollected) {
            feedEl.render();
          }
          return nowCollected;
        },
        openLightbox: (src: any, alt: any, item: any) => {
          lightboxEl.open(src, alt, item);
        },
        openDetailModal: (item: any) => {
          detailModalEl.open(item);
        },
        openStorylineMode: (storylineId: any) => {
          storylineReturnEl = null;
          storylineModeEl.open(storylineId);
        },
        openSetOfWorksMode: (setOfWorkId: any) => {
          setOfWorksModeEl.open(setOfWorkId);
        },
        showMoreByArtist: (artist: string) => {
          if (filterState.getArtist() === artist) return;
          setArtistFilter(artist);
        },
        shareItem: (item: any) => {
          shareItem(item);
        },
      },
      {
        pageLoadId: PAGE_LOAD_ID,
        storylinesById: storylinesById,
        setOfWorksById: setOfWorksById,
      },
    );
    const createSlideShell = slideBuilder.createSlideShell;
    const buildSlideContents = slideBuilder.buildSlideContents;
    const wireArtworkImageState = slideBuilder.wireArtworkImageState;
    const sampleArtworkColor = slideBuilder.sampleArtworkColor;
    const applyNudityGate = slideBuilder.applyNudityGate;
    const storylineFor = slideBuilder.storylineFor;
    const storylinePositionLabel = slideBuilder.storylinePositionLabel;
    const setOfWorkFor = slideBuilder.setOfWorkFor;
    const setOfWorkPositionLabel = slideBuilder.setOfWorkPositionLabel;

    const collectionStore = new CollectionStore(
      COLLECTION_KEY,
      COLLECTION_SOURCES,
      {
        resolveItemsByIds: (ids: any) => resolveItemsByIds(ids),
        getItemSource: (id: any) => itemsById[id]?.source,
      },
    );

    function collectionKeyFor(item: any) {
      return collectionStore.keyFor(item);
    }

    function getCollection() {
      return collectionStore.getAll();
    }

    function isCollected(item: any) {
      return collectionStore.isCollected(item);
    }

    function collectionCount() {
      return collectionStore.count();
    }

    function toggleCollect(item: any) {
      const nowCollected = collectionStore.toggle(item);
      if (nowCollected) {
        upsellToastEl.maybeShow(collectionStore.count());
      }
      return nowCollected;
    }

    function migrateCollectionKeys() {
      return collectionStore.migrate();
    }

    function updateCollectionToggle() {
      topbarEl.setCollectionActive(filterState.getCollectionFilter());
      topbarEl.setCollectionCount(collectionCount());
    }

    function renderChips() {
      updateCollectionToggle();
      topbarEl.setChips(categories, filterState.getCategory(), {
        collectionActive: filterState.getCollectionFilter(),
        storylineActive: filterState.getStorylineFilter(),
      });
    }

    function buildIntroSlideForFeed() {
      return buildIntroSlide(facets);
    }

    function escapeHtml(str: any) {
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // No two consecutive items share a real named artist ("Unknown" is
    // excluded); the "All" tail also best-effort avoids repeating
    // categories back-to-back.

    // Building every slide eagerly measured at ~300ms synchronously on
    // throttled mobile (Performance-API harness), landing long tasks
    // right where a post-load scroll would hit them. The recycling
    // window below bounds cost to ~11 slides at a time instead, and
    // shrinks relative to the catalogue rather than growing with it.
    const recycleWindow = createRecycleWindow(
      {
        fetchFeedPage: fetchFeedPage,
        fetchItemsByIds: fetchItemsByIds,
        fetchItemsByKeys: fetchItemsByKeys,
        absorbPage: absorbPage,
        buildSlideContents: buildSlideContents,
        maybeLoadMoreSlides: () => {
          feedEl.maybeLoadMoreSlides();
        },
        onWindowUpdated: () => {
          feedEl.scheduleUrlSync();
        },
      },
      {
        feedEl: feedEl,
        items: items,
        itemsById: itemsById,
        itemsByKey: itemsByKey,
        slideRecords: feedEl.slideRecords,
        feedPageSize: FEED_PAGE_SIZE,
      },
    );
    const createPager = recycleWindow.createPager;
    const loadNextPage = recycleWindow.loadNextPage;
    const fillFirstScreen = recycleWindow.fillFirstScreen;
    const resolveItemsByIds = recycleWindow.resolveItemsByIds;
    const resolveItemsByKeys = recycleWindow.resolveItemsByKeys;
    const hydrateItems = recycleWindow.hydrateItems;
    const activeSlideIndex = recycleWindow.activeSlideIndex;
    const updateRecycleWindow = recycleWindow.updateRecycleWindow;
    const resetRecycleWindow = recycleWindow.resetRecycleWindow;
    const scheduleRecycleUpdate = recycleWindow.scheduleRecycleUpdate;

    feedEl.addEventListener("scroll", scheduleRecycleUpdate, { passive: true });
    // clientHeight is the unit the index math uses, so anything that
    // changes it has to re-run the window or it centres on the wrong slide.
    window.addEventListener("resize", scheduleRecycleUpdate);

    // scheduleUrlSync() above debounces, so navigating away (a link click,
    // closing the tab) inside that window would otherwise leave the
    // session history holding a stale slide. A same-document reload is a
    // separate case this can't fix -- the browser fixes the reload target
    // before pagehide runs, no matter how fast this executes -- so the
    // debounce interval itself is what has to stay short (see
    // URL_SYNC_DEBOUNCE_MS's own comment).
    window.addEventListener("pagehide", () => {
      feedEl.flushUrlSync();
    });

    const scrollTelemetry = new ScrollTelemetry({
      activeSlideIndex: () => activeSlideIndex(),
      getSlideRecords: () => feedEl.slideRecords,
      trackEvent: (name: any, props: any) => trackEvent(name, props),
    });
    feedEl.addEventListener("scroll", () => {
      scrollTelemetry.onScroll();
    });

    const artworkViewTracker = new ArtworkViewTracker({
      activeSlideIndex: () => activeSlideIndex(),
      getSlideRecords: () => feedEl.slideRecords,
      trackEvent: (name: string, props?: Record<string, unknown>) =>
        trackEvent(name, props),
      pageLoadId: PAGE_LOAD_ID,
    });
    feedEl.addEventListener("scroll", () => artworkViewTracker.check(), {
      passive: true,
    });
    feedEl.addEventListener("feed-settled", () => artworkViewTracker.check());
    document.addEventListener("visibilitychange", () => {
      artworkViewTracker.setPageVisible(document.visibilityState !== "hidden");
    });

    // One rule for every banner mode, not just the artist filter: a search
    // for a name we hold a profile for ("gauguin") shows the same card an
    // artist-link click does. filterState is already updated to the new
    // mode by the time this runs in every call site, so reading it here
    // once covers both paths instead of each one threading its own profile
    // through.
    function resolveArtistProfileForBanner(): ArtistProfile | null {
      const artist = filterState.getArtist();
      if (artist) return getArtistProfile(artist);
      const search = filterState.getSearch();
      if (search) return findArtistProfileForQuery(search);
      return null;
    }

    function showFilterBanner(labelHtml: any) {
      filterState.setBannerHtml(labelHtml);
      topbarEl.setArtistProfile(resolveArtistProfileForBanner());
      adjustFeedScrollForHeightChange(() => {
        feedEl.classList.add("filter-push");
        topbarEl.showFilterBanner(labelHtml);
      });
    }
    function hideFilterBanner() {
      filterState.setBannerHtml(null);
      topbarEl.setArtistProfile(null);
      adjustFeedScrollForHeightChange(() => {
        feedEl.classList.remove("filter-push");
        topbarEl.hideFilterBanner();
      });
    }

    function setArtistFilter(artist: any) {
      filterState.setArtist(artist);
      filterState.setSearch(null);
      filterState.setConcept(null);
      filterState.setCollectionFilter(false);
      if (artist) {
        showFilterBanner(
          tHtml("filter.moreBy", {
            artist: `<strong>${escapeHtml(artist)}</strong>`,
          }),
        );
      } else {
        hideFilterBanner();
      }
      feedEl.render();
    }

    function showCollectionView() {
      filterState.setArtist(null);
      filterState.setSearch(null);
      filterState.setConcept(null);
      filterState.setCollectionFilter(true);
      if (searchController.isOpen()) {
        closeOverlaySync(closeSearch);
      }
      showFilterBanner(
        tHtml("filter.collection", {
          title: `<strong>${escapeHtml(t("collection.empty.eyebrow"))}</strong>`,
          count: formatNumber(collectionCount()),
        }),
      );
      topbarEl.setFilterBannerExportVisible(true);
      renderChips();
      feedEl.render();
      trackEvent("collection_view_open", { count: collectionCount() });
    }

    const exportService = new ExportService();
    function exportCollectionCsv(collectedItems: any) {
      exportService.exportCollectionCsv(collectedItems);
    }

    // Search stays open after a successful search (no auto-close);
    // results render as a second line inside the panel, and the
    // category chips are the "back to everything" escape hatch.

    // Compensates scrollTop when the search/filter banner's height
    // changes mid-scroll, since scroll-snap won't re-evaluate the
    // current slide on a pure layout change.
    function adjustFeedScrollForHeightChange(applyChange: any) {
      const oldHeight = feedEl.clientHeight;
      const slideIndex = oldHeight
        ? Math.round(feedEl.scrollTop / oldHeight)
        : 0;
      applyChange();
      const newHeight = feedEl.clientHeight;
      if (newHeight && newHeight !== oldHeight) {
        feedEl.scrollTop = slideIndex * newHeight;
      }
    }

    const searchController = new SearchController({
      getActiveSearch: () => filterState.getSearch(),
      setActiveSearch: (v: any) => {
        filterState.setSearch(v);
      },
      getActiveConcept: () => filterState.getConcept(),
      setActiveConcept: (v: any) => {
        filterState.setConcept(v);
      },
      setActiveCategory: (v: any) => {
        filterState.setCategory(v);
      },
      setActiveArtist: (v: any) => {
        filterState.setArtist(v);
      },
      setActiveCollectionFilter: (v: any) => {
        filterState.setCollectionFilter(v);
      },
      getSearchResultCount: () => searchResultCount,
      setSearchResultCount: (v: any) => {
        searchResultCount = v;
      },
      getFilterBannerHtml: () => filterState.getBannerHtml(),

      clearSuggestions: () => searchBarEl.clearSuggestions(),
      setResultsLine: (html: any) => searchBarEl.setResultsLine(html),
      openSearchBar: (prefill: any) => searchBarEl.open(prefill),
      closeSearchBar: () => searchBarEl.close(),
      pushHistory: (q: any) => searchBarEl.pushHistory(q),
      findCorrection: (q: any) => searchBarEl.findCorrection(q),
      searchBarContains: (target: any) => searchBarEl.contains(target),

      setSearchActive: (active: any) => topbarEl.setSearchActive(active),
      setFilterBannerVisible: (visible: any) =>
        topbarEl.setFilterBannerVisible(visible),
      topbarHideFilterBanner: () => topbarEl.hideFilterBanner(),
      searchToggleContains: (target: any) => searchToggle.contains(target),

      setFeedScrollLocked: (on: any) => {
        feedEl.classList[on ? "add" : "remove"]("scroll-locked");
      },
      setFeedFilterPush: (on: any) => {
        feedEl.classList[on ? "add" : "remove"]("filter-push");
      },
      setFeedSearchPush: (on: any) => {
        feedEl.classList[on ? "add" : "remove"]("search-push");
      },
      renderFeed: () => feedEl.render(),
      adjustFeedScrollForHeightChange: (fn: any) =>
        adjustFeedScrollForHeightChange(fn),

      pushOverlayHistoryState: (name: any) => pushOverlayHistoryState(name),
      closeOverlaySync: (fn: any) => closeOverlaySync(fn),

      renderChips: () => renderChips(),
      showFilterBanner: (html: any) => showFilterBanner(html),
      hideFilterBanner: () => hideFilterBanner(),
      trackEvent: (name: any, props: any) => trackEvent(name, props),
      escapeHtml: (s: any) => escapeHtml(s),
      apiUrl: (params: any) => apiUrl(params),
      fetchJson: (url: any, what: any) => fetchJson(url, what),
      countMatches: (params: any) => countMatches(params),
    });
    function openSearch() {
      searchController.open();
    }
    function closeSearch() {
      searchController.close();
    }
    function showToast(msg: any) {
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout((showToast as any)._timer);
      (showToast as any)._timer = setTimeout(() => {
        toastEl.classList.remove("show");
      }, 2600);
    }

    function runSearch(rawQuery: any) {
      return searchController.run(rawQuery);
    }

    const overlayHistory = new OverlayHistoryManager({
      detailModalEl,
      shelvesModeEl,
      shelfModeEl,
      storylineModeEl,
      setOfWorksModeEl,
      lightboxEl,
      exportModalEl,
      isSearchOpen: () => searchController.isOpen(),
      closeSearch: () => closeSearch(),
    });
    overlayHistory.attach();

    function pushOverlayHistoryState(name: any) {
      overlayHistory.push(name);
    }
    function requestOverlayClose(closeFn: any) {
      overlayHistory.requestClose(closeFn);
    }
    function closeOverlaySync(closeFn: any) {
      overlayHistory.closeSync(closeFn);
    }

    // "Scroll to explore" invites the first scroll, so it shows only while
    // there is feed below to scroll to -- not on a single search result or a
    // one-item collection, where the one slide is all there is. Re-checked
    // after every render (filters change how much feed there is); once the
    // visitor has scrolled, it's gone for good.
    let hintHidden = false;
    function refreshScrollHint() {
      if (hintHidden) return;
      const roomBelow =
        feedEl.scrollHeight - feedEl.clientHeight - feedEl.scrollTop;
      scrollHint.classList.toggle("hidden", roomBelow <= 40);
    }
    feedEl.addEventListener("feed-settled", refreshScrollHint);
    feedEl.addEventListener("scroll", () => {
      if (!hintHidden && feedEl.scrollTop > 40) {
        scrollHint.classList.add("hidden");
        hintHidden = true;
      }
    });

    // Drops the wordmark once past ~60% of the first slide -- the name
    // was already said on the intro slide, and the mark alone is
    // enough to navigate home. Guarded against a zero height, which
    // happens if this fires before layout.
    feedEl.addEventListener("scroll", () => {
      if (!topbarEl) return;
      const slideHeight = feedEl.clientHeight;
      if (slideHeight <= 0) return;
      topbarEl.classList.toggle(
        "compact",
        feedEl.scrollTop > slideHeight * 0.6,
      );
    });

    // The artist card is only relevant while looking at the first result
    // of whatever's filtered -- pinned over the art the whole time you're
    // browsing past it would be in the way. A small threshold, not >0,
    // so idle subpixel scroll jitter at rest doesn't flicker it.
    feedEl.addEventListener("scroll", () => {
      topbarEl.setArtistCardScrolled(feedEl.scrollTop > 10);
    });

    const scrollDepthTracker = new ScrollDepthTracker({
      getScrollTop: () => feedEl.scrollTop,
      getScrollHeight: () => feedEl.scrollHeight,
      getClientHeight: () => feedEl.clientHeight,
      trackEvent: (name: any, props: any) => trackEvent(name, props),
    });
    function resetScrollDepthTracking() {
      scrollDepthTracker.reset();
    }
    feedEl.addEventListener("scroll", () => {
      scrollDepthTracker.onScroll();
    });

    renderChips();
    // Read before the first render, so the deep link (/v/{slug} or the
    // historical /index.html#{slug} form) is honoured by ordering
    // rather than by scrolling.
    migrateCollectionKeys();

    const initialSlug = slugFromLocation();
    // Captured separately from pendingDeepLinkSlug itself: feedEl.render()
    // below consumes and nulls that variable synchronously (TranquiloFeed.ts
    // calls host.consumeDeepLinkSlug(), app.ts:315-317), so reading
    // pendingDeepLinkSlug again afterward -- as the share-banner trigger
    // originally did -- always sees null and never fires.
    const hadDeepLinkArtwork = /^[a-z]+-.+$/.test(initialSlug);
    if (hadDeepLinkArtwork) {
      pendingDeepLinkSlug = initialSlug;
    }
    feedEl.render(
      hadDeepLinkArtwork ? () => openDeepLinkedArtwork(initialSlug) : undefined,
    );

    // Opens after the feed renders (not instead of), so closing the
    // storyline leaves a real feed behind rather than a blank page.
    const initialStorylineId = storylineIdFromLocation();
    if (initialStorylineId) {
      storylineModeEl.open(initialStorylineId);
    }
    const initialShelfId = slugCodec.shelfIdFromLocation();
    const openedShelf = initialShelfId
      ? shelfModeEl.open(initialShelfId)
      : false;
    const openedDiscover = slugCodec.isDiscoverLocation();
    if (openedDiscover) shelvesModeEl.open();

    // Either deep-link form means the same thing for this banner: the
    // intro slide (and its Mission/Connect/Support cards) was skipped,
    // so a visitor arriving from social media never sees that context at
    // all. One signal, one session key -- they share identical copy/CTAs,
    // so forking into two independently-tracked states would only invite
    // them drifting out of sync.
    const arrivedViaShareLink =
      hadDeepLinkArtwork ||
      Boolean(initialStorylineId) ||
      openedShelf ||
      openedDiscover;
    if (
      arrivedViaShareLink &&
      !sessionStorage.getItem(SESSION_SHARE_BANNER_KEY)
    ) {
      shareBannerSource = hadDeepLinkArtwork
        ? "artwork"
        : initialStorylineId
          ? "storyline"
          : openedDiscover
            ? "discover"
            : "shelf";
      topbarEl.showShareBanner();
      sessionStorage.setItem(SESSION_SHARE_BANNER_KEY, "1");
      trackEvent("share_banner_shown", { source: shareBannerSource });
    }

    function openDeepLinkedArtwork(slug: string) {
      const cut = slug.indexOf("-");
      resolveItemsByKeys([`${slug.slice(0, cut)}:${slug.slice(cut + 1)}`])
        .then((found) => {
          if (found[0]) detailModalEl.open(found[0]);
        })
        .catch((err: unknown) => {
          console.error("deep link: detail open failed", err);
        });
    }

    function slugFromLocation() {
      return slugCodec.slugFromLocation();
    }
    function storylineIdFromLocation() {
      return slugCodec.storylineIdFromLocation();
    }
  }
}

new TranquiloApp().start().catch((err: any) => {
  console.error("Tranquilo failed to load:", err);
  // Not feedEl -- that's declared inside start()'s own scope.
  const feedEl = document.getElementById("feed") as any;
  feedEl.innerHTML = "";
  feedEl.appendChild(
    renderErrorState({
      detail: err?.message || "Tranquilo failed to load.",
      onRetry: () => location.reload(),
    }),
  );
});
