// app.ts is the single entry point -- index.html loads it via
// `<script type="module" src="src/app.ts">` and nothing else, so every
// other browser module is imported directly here. The custom-element
// imports below are side-effect-only; app.ts never constructs them,
// it looks them up via document.getElementById() once they've upgraded.

import { Analytics } from "./app/Analytics";
import { wireAiDisclosureToggle } from "./app/aiDisclosureToggle";
import { CatalogueCache } from "./app/CatalogueCache";
import { CollectionStore } from "./app/CollectionStore";
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
  sourceLinkPreposition,
} from "./app/sourceLinks";
import { TRANQUILO_CONFIG } from "./data/config.generated";
import { renderErrorState } from "./errorState";
import { buildEmptyCollectionSlide, buildIntroSlide } from "./feed/introSlides";
import { createRecycleWindow } from "./feed/recycleWindow";
import { createSlideBuilder } from "./feed/slideBuilder";
import type { ITopbarHost } from "./types/ITopbarHost";
import type { ITranquiloDetailModalHost } from "./types/ITranquiloDetailModalHost";
import type { ITranquiloExportModalHost } from "./types/ITranquiloExportModalHost";
import type { ITranquiloFeedHost } from "./types/ITranquiloFeedHost";
import type { ITranquiloLightboxHost } from "./types/ITranquiloLightboxHost";
import type { ITranquiloSetOfWorksModeHost } from "./types/ITranquiloSetOfWorksModeHost";
import type { ITranquiloShelvesModeHost } from "./types/ITranquiloShelvesModeHost";
import type { ITranquiloStorylineModeHost } from "./types/ITranquiloStorylineModeHost";

import "./components/TranquiloSupportStrip";
import "./components/TranquiloNewsletterModal";
import "./components/TranquiloTopbar";
import "./components/TranquiloMusicToggle";
import "./components/TranquiloSearchBar";
import "./components/TranquiloLightbox";
import "./components/TranquiloDetailModal";
import "./components/TranquiloStorylineMode";
import "./components/TranquiloSetOfWorksMode";
import "./components/TranquiloShelvesMode";
import "./components/TranquiloExportModal";
import "./components/TranquiloUpsellToast";
import "./components/TranquiloFeed";

import "./analytics/cloudflareBeacon";
import "./analytics/posthogDraft";

class TranquiloApp {
  async start() {
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
      Object.keys(legacyMap).forEach((oldKey: any) => {
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

    const itemsApi = new ItemsApiClient(CACHE_BUST_VERSION, FEED_PAGE_SIZE);
    function apiUrl(params: any) {
      return itemsApi.apiUrl(params);
    }
    function fetchJson(url: any, what: any) {
      return itemsApi.fetchJson(url, what);
    }
    function fetchFeedPage(params: any) {
      return itemsApi.fetchFeedPage(params);
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
    function fetchStorylineDetail(id: any) {
      return itemsApi.fetchStorylineDetail(id);
    }
    function fetchSetOfWorksIndex() {
      return itemsApi.fetchSetOfWorksIndex();
    }
    function fetchSetOfWorkDetail(id: any) {
      return itemsApi.fetchSetOfWorkDetail(id);
    }

    function countMatches(params: any) {
      return itemsApi.countMatches(params);
    }

    function fetchItemsByIds(ids: any) {
      return itemsApi.fetchItemsByIds(ids);
    }

    const catalogueCache = new CatalogueCache();
    const items = catalogueCache.items;
    const itemsById = catalogueCache.itemsById;
    const itemsByKey = catalogueCache.itemsByKey;
    function absorbPage(rows: any) {
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
    const categoryToMusicBucket: Record<string, string> = {};
    Object.keys(musicBuckets).forEach((key: string) => {
      const category = musicBuckets[key].category;
      if (category) categoryToMusicBucket[category] = key;
    });
    const categories = ["All"].concat(
      facets.categories.map((c: any) => c.value),
    );
    const storylinesById: Record<string, any> = {};
    storylineIndex.forEach((s: any) => {
      storylinesById[s.id] = s;
    });
    const setOfWorksById: Record<string, any> = {};
    setOfWorksIndex.forEach((s: any) => {
      setOfWorksById[s.id] = s;
    });
    // Postgres can't derive this itself, so it's computed here from the
    // storyline index fetched alongside it.
    const storylinesShelf = shelves.filter(
      (s: any) => s.id === "storylines",
    )[0];
    if (storylinesShelf) {
      storylinesShelf.itemIds = storylineIndex.map((s: any) => s.cover_item_id);
    }
    // Lazy cache: only populated once a storyline is actually opened.
    const storylineDetailById: Record<string, any> = {};
    function resolveStorylineDetail(id: any) {
      if (storylineDetailById[id])
        return Promise.resolve(storylineDetailById[id]);
      return fetchStorylineDetail(id)
        .then((storyline: any) => {
          storylineDetailById[id] = storyline;
          return storyline;
        })
        .catch((err: any) => {
          console.error("storylines: detail fetch failed", err);
          return null;
        });
    }
    const setOfWorkDetailById: Record<string, any> = {};
    function resolveSetOfWorkDetail(id: any) {
      if (setOfWorkDetailById[id])
        return Promise.resolve(setOfWorkDetailById[id]);
      return fetchSetOfWorkDetail(id)
        .then((setOfWork: any) => {
          setOfWorkDetailById[id] = setOfWork;
          return setOfWork;
        })
        .catch((err: any) => {
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
    let shareBannerSource: "artwork" | "storyline" | null = null;
    let searchResultCount = 0;

    const feedEl = document.getElementById("feed") as any;
    const lightboxEl = document.getElementById("lightbox") as any;
    const scrollHint = document.getElementById("scrollHint") as any;
    const detailModalEl = document.getElementById("detailModal") as any;
    // Kept outside the topbar host so SearchController's outside-click
    // check can reference it directly.
    const searchToggle = document.getElementById("searchToggle") as any;
    const toastEl = document.getElementById("toast") as any;
    const upsellToastEl = document.getElementById("upsellToast") as any;
    const storylineModeEl = document.getElementById("storylineMode") as any;
    const setOfWorksModeEl = document.getElementById("setOfWorksMode") as any;
    const shelvesModeEl = document.getElementById("shelvesMode") as any;
    const exportModalEl = document.getElementById("exportModal") as any;
    // Assigned as a property, not an attribute, since it carries live
    // functions rather than strings.
    const topbarEl = document.querySelector(".topbar") as any;
    const musicToggleEl = document.querySelector(
      "tranquilo-music-toggle",
    ) as any;
    musicToggleEl.musicBuckets = musicBuckets;
    musicToggleEl.categoryToBucket = categoryToMusicBucket;
    const searchBarEl = document.querySelector("tranquilo-search-bar") as any;
    searchBarEl.facets = facets;
    searchBarEl.addEventListener("search-submit", (e: any) => {
      runSearch(e.detail.query);
    });
    searchBarEl.addEventListener("search-close-request", () => {
      requestOverlayClose(closeSearch);
    });
    // Host methods below are wrapped in closures since several targets
    // (recycleWindow rebindings, createSlideShell, etc.) are assigned
    // later in this function, not hoisted -- a direct reference here
    // would capture undefined.
    const feedHost: ITranquiloFeedHost = {
      createPager: (params: any, checkCategory: any, excludeIds: any) =>
        createPager(params, checkCategory, excludeIds),
      loadNextPage: (pager: any) => loadNextPage(pager),
      fillFirstScreen: (pager: any, firstPage: any) =>
        fillFirstScreen(pager, firstPage),
      activeSlideIndex: () => activeSlideIndex(),
      updateRecycleWindow: () => {
        updateRecycleWindow();
      },
      resetRecycleWindow: () => {
        resetRecycleWindow();
      },
      resolveItemsByIds: (ids: any) => resolveItemsByIds(ids),
      fetchItemsByIds: (ids: any) => fetchItemsByIds(ids),
      absorbPage: (rows: any) => absorbPage(rows),
      createSlideShell: (item: any) => createSlideShell(item),
      getCollection: () => getCollection(),
      collectionKeyFor: (item: any) => collectionKeyFor(item),
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
      wireArtworkImageState: (
        frame: any,
        skeleton: any,
        img: any,
        src: any,
        item: any,
        tier: any,
      ) => wireArtworkImageState(frame, skeleton, img, src, item, tier),
      applyNudityGate: (frame: any, item: any) => {
        applyNudityGate(frame, item);
      },
      sampleArtworkColor: (item: any, callback: any) => {
        sampleArtworkColor(item, callback);
      },
      trackEvent: (name: any, props: any) => {
        trackEvent(name, props);
      },
      sourceLinkLabel: (item: any) => sourceLinkLabel(item),
      isAggregatorSource: (item: any) => isAggregatorSource(item),
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
    };
    lightboxEl.app = lightboxHost;
    const detailModalHost: ITranquiloDetailModalHost = {
      wireArtworkImageState: (
        frame: any,
        skeleton: any,
        img: any,
        src: any,
        item: any,
        tier: any,
      ) => wireArtworkImageState(frame, skeleton, img, src, item, tier),
      applyNudityGate: (frame: any, item: any) => {
        applyNudityGate(frame, item);
      },
      sampleArtworkColor: (item: any, callback: any) => {
        sampleArtworkColor(item, callback);
      },
      storylineFor: (item: any) => storylineFor(item),
      storylinePositionLabel: (item: any, storyline: any) =>
        storylinePositionLabel(item, storyline),
      setOfWorkFor: (item: any) => setOfWorkFor(item),
      setOfWorkPositionLabel: (item: any, setOfWork: any) =>
        setOfWorkPositionLabel(item, setOfWork),
      trackEvent: (name: any, props: any) => {
        trackEvent(name, props);
      },
      hydrateItems: (items: any) => hydrateItems(items),
      shareItem: (item: any) => {
        shareItem(item);
      },
      sourceLinkLabel: (item: any) => sourceLinkLabel(item),
      sourceLinkPreposition: (item: any) => sourceLinkPreposition(item),
      setArtistFilter: (artist: any) => {
        setArtistFilter(artist);
      },
      openStorylineMode: (storylineId: any) => {
        storylineModeEl.open(storylineId);
      },
      openSetOfWorksMode: (setOfWorkId: any) => {
        setOfWorksModeEl.open(setOfWorkId);
      },
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
      reopenShelvesMode: () => {
        shelvesModeEl.restore();
      },
      showToast: (msg: any) => {
        showToast(msg);
      },
    };
    detailModalEl.app = detailModalHost;
    detailModalEl.addEventListener("storyline-handoff-restore", (e: any) => {
      // Reopens at the last-read chapter, not the intro trailer.
      storylineModeEl.open(e.detail.id, e.detail.position);
    });
    const storylineModeHost: ITranquiloStorylineModeHost = {
      getItem: (id: any) => itemsById[id],
      resolveItemsByIds: (ids: any) => resolveItemsByIds(ids),
      getStorylineDetail: (id: any) => storylineDetailById[id],
      resolveStorylineDetail: (id: any) => resolveStorylineDetail(id),
      applyNudityGate: (frame: any, item: any, compact: any) => {
        applyNudityGate(frame, item, compact);
      },
      trackEvent: (name: any, props: any) => {
        trackEvent(name, props);
      },
      openLightbox: (src: any, alt: any, item: any) => {
        lightboxEl.open(src, alt, item);
      },
      shareStoryline: (storyline: any) => {
        shareStoryline(storyline);
      },
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
    };
    storylineModeEl.app = storylineModeHost;
    // Deliberately smaller than storylineModeHost: no shareSetOfWork, and
    // openDetailModal is direct since this mode closes itself first
    // instead of stacking under the detail panel.
    const setOfWorksModeHost: ITranquiloSetOfWorksModeHost = {
      getItem: (id: any) => itemsById[id],
      resolveItemsByIds: (ids: any) => resolveItemsByIds(ids),
      getSetOfWorkDetail: (id: any) => setOfWorkDetailById[id],
      resolveSetOfWorkDetail: (id: any) => resolveSetOfWorkDetail(id),
      applyNudityGate: (frame: any, item: any, compact: any) => {
        applyNudityGate(frame, item, compact);
      },
      trackEvent: (name: any, props: any) => {
        trackEvent(name, props);
      },
      openLightbox: (src: any, alt: any, item: any) => {
        lightboxEl.open(src, alt, item);
      },
      openDetailModal: (item: any) => {
        detailModalEl.open(item);
      },
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
    };
    setOfWorksModeEl.app = setOfWorksModeHost;
    // app.ts mediates between sibling components rather than letting
    // them reach into each other directly.
    storylineModeEl.addEventListener("open-detail", (e: any) => {
      detailModalEl.dispatchEvent(
        new CustomEvent("storyline-handoff-open", {
          detail: e.detail,
        }),
      );
    });
    shelvesModeEl.shelves = shelves;
    const shelvesModeHost: ITranquiloShelvesModeHost = {
      apiUrl: (params: any) => apiUrl(params),
      fetchJson: (url: any, what: any) => fetchJson(url, what),
      absorbPage: (rows: any) => absorbPage(rows),
      resolveItemsByIds: (ids: any) => resolveItemsByIds(ids),
      hydrateItems: (items: any) => hydrateItems(items),
      applyNudityGate: (frame: any, item: any, compact: any) => {
        applyNudityGate(frame, item, compact);
      },
      storylineFor: (item: any) => storylineFor(item),
      trackEvent: (name: any, props: any) => {
        trackEvent(name, props);
      },
      openDetailModal: (item: any, shelfContext: any) => {
        detailModalEl.open(item, shelfContext);
      },
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
    };
    shelvesModeEl.app = shelvesModeHost;
    const exportModalHost: ITranquiloExportModalHost = {
      pushOverlayHistoryState: (name: any) => {
        pushOverlayHistoryState(name);
      },
      requestOverlayClose: (closeFn: any) => {
        requestOverlayClose(closeFn);
      },
    };
    exportModalEl.app = exportModalHost;
    const topbarHost: ITopbarHost = {
      onCategorySelect: (cat: any) => {
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
          showToast("Nothing collected yet");
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
          storylineModeEl.open(storylineId);
        },
        openSetOfWorksMode: (setOfWorkId: any) => {
          setOfWorksModeEl.open(setOfWorkId);
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
      ["met", "smithsonian", "cleveland", "commons", "europeana"],
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

    function showFilterBanner(labelHtml: any) {
      filterState.setBannerHtml(labelHtml);
      adjustFeedScrollForHeightChange(() => {
        feedEl.classList.add("filter-push");
        topbarEl.showFilterBanner(labelHtml);
      });
    }
    function hideFilterBanner() {
      filterState.setBannerHtml(null);
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
        showFilterBanner(`More by <strong>${escapeHtml(artist)}</strong>`);
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
      showFilterBanner(`<strong>My Collection</strong> (${collectionCount()})`);
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

    let hintHidden = false;
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
    feedEl.render();

    // Opens after the feed renders (not instead of), so closing the
    // storyline leaves a real feed behind rather than a blank page.
    const initialStorylineId = storylineIdFromLocation();
    if (initialStorylineId) {
      storylineModeEl.open(initialStorylineId);
    }

    // Either deep-link form means the same thing for this banner: the
    // intro slide (and its Mission/Connect/Support cards) was skipped,
    // so a visitor arriving from social media never sees that context at
    // all. One signal, one session key -- they share identical copy/CTAs,
    // so forking into two independently-tracked states would only invite
    // them drifting out of sync.
    const arrivedViaShareLink =
      hadDeepLinkArtwork || Boolean(initialStorylineId);
    if (
      arrivedViaShareLink &&
      !sessionStorage.getItem(SESSION_SHARE_BANNER_KEY)
    ) {
      shareBannerSource = hadDeepLinkArtwork ? "artwork" : "storyline";
      topbarEl.showShareBanner();
      sessionStorage.setItem(SESSION_SHARE_BANNER_KEY, "1");
      trackEvent("share_banner_shown", { source: shareBannerSource });
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
      detail: (err && err.message) || "Tranquilo failed to load.",
      onRetry: () => location.reload(),
    }),
  );
});
