export interface ScrollDepthTrackerHost {
  getScrollTop(): number;
  getScrollHeight(): number;
  getClientHeight(): number;
  trackEvent(name: string, props?: Record<string, unknown>): void;
}

// Fixed 25/50/75/100% thresholds, not continuous, to avoid event-volume
// bloat. Reset on every renderFeed() call, since a fresh filtered view is a
// new scroll session, not a continuation.
export class ScrollDepthTracker {
  private fired: Record<number, boolean> = {};

  constructor(private host: ScrollDepthTrackerHost) {}

  reset(): void {
    this.fired = {};
  }

  onScroll(): void {
    const scrollableHeight =
      this.host.getScrollHeight() - this.host.getClientHeight();
    if (scrollableHeight <= 0) return;
    const pct = (this.host.getScrollTop() / scrollableHeight) * 100;
    for (const threshold of [25, 50, 75, 100]) {
      if (pct >= threshold && !this.fired[threshold]) {
        this.fired[threshold] = true;
        this.host.trackEvent("scroll_depth", { threshold });
      }
    }
  }
}
