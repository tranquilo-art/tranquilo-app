import type { ActiveConcept } from "./SearchController";

// The feed's current filter. Exactly one of category/artist/search/concept/
// collectionFilter is the "mode" driving renderFeed() at a time;
// storylineFilter composes with whichever mode is active rather than
// replacing it. bannerHtml is the one-line summary of the active mode,
// updated or cleared on every filter transition.
//
// A plain state container, not a decision-maker: app.ts owns which fields
// change together for a given user action.
export class FilterState {
  private category = "All";
  private artist: string | null = null;
  private search: string | null = null;
  private concept: ActiveConcept | null = null;
  private collectionFilter = false;
  private storylineFilter = false;
  private bannerHtml: string | null = null;

  getCategory(): string {
    return this.category;
  }
  setCategory(v: string): void {
    this.category = v;
  }

  getArtist(): string | null {
    return this.artist;
  }
  setArtist(v: string | null): void {
    this.artist = v;
  }

  getSearch(): string | null {
    return this.search;
  }
  setSearch(v: string | null): void {
    this.search = v;
  }

  getConcept(): ActiveConcept | null {
    return this.concept;
  }
  setConcept(v: ActiveConcept | null): void {
    this.concept = v;
  }

  getCollectionFilter(): boolean {
    return this.collectionFilter;
  }
  setCollectionFilter(v: boolean): void {
    this.collectionFilter = v;
  }

  getStorylineFilter(): boolean {
    return this.storylineFilter;
  }
  toggleStorylineFilter(): boolean {
    this.storylineFilter = !this.storylineFilter;
    return this.storylineFilter;
  }

  getBannerHtml(): string | null {
    return this.bannerHtml;
  }
  setBannerHtml(v: string | null): void {
    this.bannerHtml = v;
  }

  snapshot() {
    return {
      category: this.category,
      artist: this.artist,
      search: this.search,
      concept: this.concept,
      collectionFilter: this.collectionFilter,
      storylineFilter: this.storylineFilter,
    };
  }
}
