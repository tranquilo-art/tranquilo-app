import { feedDepthMilestones } from "../logic/logic";

export interface ScrollTelemetryHost {
  activeSlideIndex(): number;
  getSlideRecords(): { item?: unknown }[];
  trackEvent(name: string, props?: Record<string, unknown>): void;
}

// How far into the feed a visitor has scrolled.
export class ScrollTelemetry {
  private feedDepthMax = 0;
  private feedDepthFired: number[] = [];

  constructor(private host: ScrollTelemetryHost) {}

  // Artworks seen, not slide index: the intro slide exists in some modes
  // only, so this derives the offset from whether the first record actually
  // carries an item rather than assuming either way (a past source of
  // off-by-one bugs).
  artworksSeen(): number {
    const idx = this.host.activeSlideIndex();
    if (idx < 0) return 0;
    const records = this.host.getSlideRecords();
    const introOffset = records.length && !records[0].item ? 1 : 0;
    return Math.max(0, idx + 1 - introOffset);
  }

  // Highest reached, not current: scrolling back up must not re-fire, and
  // must not lower the depth already earned.
  onScroll(): void {
    const seen = this.artworksSeen();
    if (seen <= this.feedDepthMax) return;
    this.feedDepthMax = seen;
    const reached = feedDepthMilestones(seen, this.feedDepthFired);
    for (let i = 0; i < reached.length; i++) {
      this.feedDepthFired.push(reached[i]);
      this.host.trackEvent("feed_depth", { slides: reached[i] });
    }
  }
}
