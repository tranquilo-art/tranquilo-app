import type { SearchFacets } from "../components/TranquiloSearchBar";
import { TRANQUILO_CONFIG } from "../data/config.generated";
import type { FeedPageResponse } from "../feed/recycleWindow";
import type { HeroPoolEntry } from "../types/HeroPoolEntry";
import type { Item, ItemDetail } from "../types/Item";
import type { MusicBucket } from "../types/MusicBucket";
import type { PrintQuoteResult } from "../types/PrintQuote";
import type { SetOfWork, SetOfWorkIndexEntry } from "../types/SetOfWork";
import type { Shelf } from "../types/Shelf";
import type { Storyline, StorylineIndexEntry } from "../types/Storyline";

// All fetches against api/items -- the catalogue is server-paged and
// server-aggregated now, not a single manifest read once at startup.
// Replaced the old single manifest fetch across six surfaces (feed order
// via a precomputed shuffle_key, facets, autocomplete, did-you-mean, rule
// shelves, hero shelves), since moving only the feed wouldn't have
// removed the full-catalogue download.
const MAX_IDS_PER_LOOKUP = TRANQUILO_CONFIG.feed.max_ids_per_lookup;

type IdsLookup = { items?: Item[]; missing?: string[] };

export type FacetsResponse = SearchFacets & {
  sources?: unknown[];
  total?: number;
};

export class ItemsApiClient {
  // `locale` asks the API for translated content; the URL is the CDN cache
  // key, so each language is cached separately.
  constructor(
    private cacheBustVersion: number,
    private feedPageSize: number,
    private locale?: string,
  ) {}

  private suffix(): string {
    const locale = this.locale
      ? `&locale=${encodeURIComponent(this.locale)}`
      : "";
    return `${locale}&v=${this.cacheBustVersion}`;
  }

  apiUrl(params: Record<string, unknown>): string {
    const qs = Object.keys(params)
      .filter(
        (k) =>
          params[k] !== undefined && params[k] !== null && params[k] !== "",
      )
      .map(
        (k) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`,
      )
      .join("&");
    return `/api/items?${qs}${this.suffix()}`;
  }

  fetchJson<T = unknown>(url: string, what: string): Promise<T> {
    return fetch(url).then((res) => {
      if (!res.ok) {
        throw new Error(`api/items ${what} responded with ${res.status}`);
      }
      return res.json();
    });
  }

  // One page of the feed, in server-decided order. `params` carries the
  // current mode's filter plus a start offset (first page) or cursor
  // (every page after).
  fetchFeedPage(params: Record<string, unknown>): Promise<FeedPageResponse> {
    const p: Record<string, unknown> = {
      shape: "manifest",
      order: "shuffle",
      limit: this.feedPageSize,
    };
    Object.keys(params).forEach((k) => {
      p[k] = params[k];
    });
    return this.fetchJson<FeedPageResponse>(this.apiUrl(p), "feed page");
  }

  // The catalogue's shape: category list, source count, and the pools
  // buildBrowseHint() samples. Small enough to fetch once at startup and hold.
  fetchFacets(): Promise<FacetsResponse> {
    return this.fetchJson<FacetsResponse>(
      this.apiUrl({ shape: "facets" }),
      "facets",
    );
  }

  fetchPrintRegion(): Promise<{
    country: string | null;
    region: string | null;
  }> {
    return this.fetchJson(
      this.apiUrl({ shape: "print_region" }),
      "print region",
    );
  }

  fetchPrintQuote(
    key: string,
    product: string,
    country: string,
  ): Promise<PrintQuoteResult> {
    return this.fetchJson<PrintQuoteResult>(
      this.apiUrl({ shape: "print_quote", key, product, country }),
      "print quote",
    );
  }

  // The eager half of storylines -- id/cover_item_id/chapter id+position
  // for every storyline, small enough to fetch once at startup. No title,
  // intro_caption or chapter captions -- those are the lazy half, fetched
  // via fetchStorylineDetail() below only when a reader opens one.
  fetchStorylineIndex(): Promise<StorylineIndexEntry[]> {
    return this.fetchJson<StorylineIndexEntry[]>(
      this.apiUrl({ shape: "storylines" }),
      "storyline index",
    );
  }

  // Discover shelf definitions -- small and fixed-size, fetched once at
  // startup since Discover needs the whole set regardless of which
  // shelves currently qualify.
  fetchShelves(): Promise<Shelf[]> {
    return this.fetchJson<Shelf[]>(
      this.apiUrl({ shape: "shelves" }),
      "shelves",
    );
  }

  // Ambient-music buckets, keyed by bucket key -- see lib/music.ts for
  // why there's no separate category map in the response.
  fetchMusicBuckets(): Promise<Record<string, MusicBucket>> {
    return this.fetchJson<Record<string, MusicBucket>>(
      this.apiUrl({ shape: "music" }),
      "music buckets",
    );
  }

  // The hero-rotation pool, fetched once at startup. Returns
  // {source, native_id, media_type} per entry; TranquiloFeed picks a
  // random subset per session via pickHeroes() and resolves it to full
  // item data via ?ids= only when it needs to render them.
  fetchHeroPool(): Promise<HeroPoolEntry[]> {
    return this.fetchJson<HeroPoolEntry[]>(
      this.apiUrl({ shape: "heroes" }),
      "hero pool",
    );
  }

  // The LAZY half: one storyline's full content, fetched only when
  // storylineModeEl.open() doesn't already have it cached.
  fetchStorylineDetail(id: string): Promise<Storyline> {
    return this.fetchJson<Storyline>(
      this.apiUrl({ shape: "storyline", id }),
      "storyline detail",
    );
  }

  // Same eager/lazy split as storylines above -- no title or
  // distinguishing_trait, fetched via fetchSetOfWorkDetail() below.
  fetchSetOfWorksIndex(): Promise<SetOfWorkIndexEntry[]> {
    return this.fetchJson<SetOfWorkIndexEntry[]>(
      this.apiUrl({ shape: "set_of_works" }),
      "set of works index",
    );
  }

  // The LAZY half: one set's full content, fetched only when
  // setOfWorksModeEl.open() doesn't already have it cached.
  fetchSetOfWorkDetail(id: string): Promise<SetOfWork> {
    return this.fetchJson<SetOfWork>(
      this.apiUrl({ shape: "set_of_work", id }),
      "set of work detail",
    );
  }

  // Asks how many items match, not which ones -- the matching rows arrive
  // separately through the ordinary paged feed. Only for the results
  // line and deciding whether to fall through to did-you-mean.
  countMatches(params: Record<string, unknown>): Promise<number> {
    const p: Record<string, unknown> = { shape: "count" };
    Object.keys(params).forEach((k) => {
      p[k] = params[k];
    });
    return this.fetchJson<{ total?: number }>(this.apiUrl(p), "count")
      .then((body) => body.total || 0)
      .catch((err: unknown) => {
        console.error("items: count failed", err);
        return 0;
      });
  }

  // The curated text for one source:native_id item. Served apart from the
  // page rows so it is budgeted per visitor, one request per opened item.
  fetchItemDetail(key: string): Promise<ItemDetail> {
    return this.fetchJson<{ item: ItemDetail }>(
      this.apiUrl({ shape: "detail", key }),
      "detail",
    ).then((body) => body.item);
  }

  // Every live item with these native ids, from any source.
  fetchItemsByIds(ids: string[]): Promise<IdsLookup> {
    return this.fetchLookup("ids", ids);
  }

  // Exactly these source:native_id items -- native ids repeat across sources.
  fetchItemsByKeys(keys: string[]): Promise<IdsLookup> {
    return this.fetchLookup("keys", keys);
  }

  private fetchLookup(
    param: "ids" | "keys",
    values: string[],
  ): Promise<IdsLookup> {
    if (values.length <= MAX_IDS_PER_LOOKUP) {
      return this.fetchLookupChunk(param, values);
    }
    const chunks: string[][] = [];
    for (let at = 0; at < values.length; at += MAX_IDS_PER_LOOKUP) {
      chunks.push(values.slice(at, at + MAX_IDS_PER_LOOKUP));
    }
    return Promise.all(
      chunks.map((chunk) => this.fetchLookupChunk(param, chunk)),
    ).then((bodies) => ({
      items: bodies.flatMap((body) => body.items ?? []),
      missing: bodies.flatMap((body) => body.missing ?? []),
    }));
  }

  private fetchLookupChunk(
    param: "ids" | "keys",
    values: string[],
  ): Promise<IdsLookup> {
    // One parameter per value, never comma-joined: some Commons
    // native_ids contain commas (real filenames), and comma-joining tore
    // those into ids matching nothing, rendering permanently blank slides.
    const query = values
      .map((value) => `${param}=${encodeURIComponent(value)}`)
      .join("&");
    return fetch(`/api/items?${query}${this.suffix()}`).then((res) => {
      if (!res.ok) {
        throw new Error(`api/items lookup responded with ${res.status}`);
      }
      return res.json() as Promise<IdsLookup>;
    });
  }
}
