// ScrollDepthTracker owns the 25/50/75/100% scroll_depth milestones.
import { describe, expect, it, vi } from "vitest";
import { ScrollDepthTracker } from "../src/app/ScrollDepthTracker";

function makeTracker(opts: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}) {
  const trackEvent = vi.fn();
  const tracker = new ScrollDepthTracker({
    getScrollTop: () => opts.scrollTop,
    getScrollHeight: () => opts.scrollHeight,
    getClientHeight: () => opts.clientHeight,
    trackEvent,
  });
  return { tracker, trackEvent };
}

describe("onScroll", () => {
  it("does nothing when the feed isn't scrollable", () => {
    const { tracker, trackEvent } = makeTracker({
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 500,
    });
    tracker.onScroll();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("fires every threshold reached in a single jump, in ascending order", () => {
    const { tracker, trackEvent } = makeTracker({
      scrollTop: 900,
      scrollHeight: 1000,
      clientHeight: 0,
    });
    tracker.onScroll();
    expect(trackEvent.mock.calls.map((c) => c[1].threshold)).toEqual([
      25, 50, 75,
    ]);
  });

  it("reaches 100 exactly at the bottom", () => {
    const { tracker, trackEvent } = makeTracker({
      scrollTop: 1000,
      scrollHeight: 1000,
      clientHeight: 0,
    });
    tracker.onScroll();
    expect(trackEvent).toHaveBeenCalledWith("scroll_depth", { threshold: 100 });
  });

  it("does not re-fire a threshold already reached", () => {
    let scrollTop = 250;
    const trackEvent = vi.fn();
    const tracker = new ScrollDepthTracker({
      getScrollTop: () => scrollTop,
      getScrollHeight: () => 1000,
      getClientHeight: () => 0,
      trackEvent,
    });
    tracker.onScroll();
    expect(trackEvent).toHaveBeenCalledTimes(1);
    trackEvent.mockClear();
    scrollTop = 100; // scrolled back up, still past no new threshold
    tracker.onScroll();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("reset() re-arms every threshold for a fresh render", () => {
    const trackEvent = vi.fn();
    const tracker = new ScrollDepthTracker({
      getScrollTop: () => 500,
      getScrollHeight: () => 1000,
      getClientHeight: () => 0,
      trackEvent,
    });
    tracker.onScroll();
    trackEvent.mockClear();
    tracker.onScroll();
    expect(trackEvent).not.toHaveBeenCalled();

    tracker.reset();
    tracker.onScroll();
    expect(trackEvent).toHaveBeenCalledWith("scroll_depth", { threshold: 25 });
    expect(trackEvent).toHaveBeenCalledWith("scroll_depth", { threshold: 50 });
  });
});
