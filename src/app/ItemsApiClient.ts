// All fetches against api/items -- the catalogue is server-paged and
// server-aggregated now, not a single manifest read once at startup.
// Replaced the old single manifest fetch across six surfaces (feed order
// via a precomputed shuffle_key, facets, autocomplete, did-you-mean, rule
// shelves, hero shelves), since moving only the feed wouldn't have
// removed the full-catalogue download.
export class ItemsApiClient {
  constructor(
    private cacheBustVersion: number,
    private feedPageSize: number,
  ) {}

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
    return `/api/items?${qs}&v=${this.cacheBustVersion}`;
  }

  fetchJson(url: string, what: string): Promise<any> {
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
  fetchFeedPage(params: Record<string, unknown>): Promise<any> {
    const p: Record<string, unknown> = {
      shape: "manifest",
      order: "shuffle",
      limit: this.feedPageSize,
    };
    Object.keys(params).forEach((k) => {
      p[k] = params[k];
    });
    return this.fetchJson(this.apiUrl(p), "feed page");
  }

  // The catalogue's shape: category list, source count, and the pools
  // buildBrowseHint() samples. Small enough to fetch once at startup and hold.
  fetchFacets(): Promise<any> {
    return this.fetchJson(this.apiUrl({ shape: "facets" }), "facets");
  }

  // The eager half of storylines -- id/cover_item_id/chapter id+position
  // for every storyline, small enough to fetch once at startup. No title,
  // intro_caption or chapter captions -- those are the lazy half, fetched
  // via fetchStorylineDetail() below only when a reader opens one.
  fetchStorylineIndex(): Promise<any> {
    return this.fetchJson(
      this.apiUrl({ shape: "storylines" }),
      "storyline index",
    );
  }

  // Discover shelf definitions -- small and fixed-size, fetched once at
  // startup since Discover needs the whole set regardless of which
  // shelves currently qualify.
  fetchShelves(): Promise<any> {
    return this.fetchJson(this.apiUrl({ shape: "shelves" }), "shelves");
  }

  // Ambient-music buckets, keyed by bucket key -- see lib/music.ts for
  // why there's no separate category map in the response.
  fetchMusicBuckets(): Promise<any> {
    return this.fetchJson(this.apiUrl({ shape: "music" }), "music buckets");
  }

  // The hero-rotation pool, fetched once at startup. Returns
  // {source, native_id, media_type} per entry; TranquiloFeed picks a
  // random subset per session via pickHeroes() and resolves it to full
  // item data via ?ids= only when it needs to render them.
  fetchHeroPool(): Promise<any> {
    return this.fetchJson(this.apiUrl({ shape: "heroes" }), "hero pool");
  }

  // The LAZY half: one storyline's full content, fetched only when
  // storylineModeEl.open() doesn't already have it cached.
  fetchStorylineDetail(id: string): Promise<any> {
    return this.fetchJson(
      this.apiUrl({ shape: "storyline", id }),
      "storyline detail",
    );
  }

  // Same eager/lazy split as storylines above -- no title or
  // distinguishing_trait, fetched via fetchSetOfWorkDetail() below.
  fetchSetOfWorksIndex(): Promise<any> {
    return this.fetchJson(
      this.apiUrl({ shape: "set_of_works" }),
      "set of works index",
    );
  }

  // The LAZY half: one set's full content, fetched only when
  // setOfWorksModeEl.open() doesn't already have it cached.
  fetchSetOfWorkDetail(id: string): Promise<any> {
    return this.fetchJson(
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
    return this.fetchJson(this.apiUrl(p), "count")
      .then((body: any) => body.total || 0)
      .catch((err: unknown) => {
        console.error("items: count failed", err);
        return 0;
      });
  }

  fetchItemsByIds(ids: string[]): Promise<any> {
    // One `ids=` parameter per id, never comma-joined: some Commons
    // native_ids contain commas (real filenames), and comma-joining tore
    // those into ids matching nothing, rendering permanently blank slides.
    const query = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
    return fetch(`/api/items?${query}&v=${this.cacheBustVersion}`).then(
      (res) => {
        if (!res.ok) {
          throw new Error(`api/items lookup responded with ${res.status}`);
        }
        return res.json();
      },
    );
  }
}
