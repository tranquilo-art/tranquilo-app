// The host contract <tranquilo-topbar> talks to (`topbarEl.app = {...}`,
// set once early after the element upgrades). The topbar owns its own
// markup, chip rendering/overflow and filter-banner display mechanics;
// everything that decides what an interaction means stays app.js's job.
export interface ITopbarHost {
  onCategorySelect(category: string): void;
  onStorylineFilterToggle(): void;
  onMusicToggle(): void;
  onSearchToggle(): void;
  onDiscoverToggle(): void;
  onCollectionToggle(): void;
  onFilterBannerClear(): void;
  onFilterBannerExport(): void;
}
