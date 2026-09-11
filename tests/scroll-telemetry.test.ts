// ScrollTelemetry owns feed-depth tracking -- see ScrollTelemetry.ts's own
// header for the off-by-one/intro-slide rationale.
import { describe, expect, it, vi } from "vitest";
import { ScrollTelemetry } from "../src/app/ScrollTelemetry";

function makeTelemetry(opts: {
  slideIndex: number;
  records: { item?: unknown }[];
}) {
  const trackEvent = vi.fn();
  const telemetry = new ScrollTelemetry({
    activeSlideIndex: () => opts.slideIndex,
    getSlideRecords: () => opts.records,
    trackEvent,
  });
  return { telemetry, trackEvent };
}

describe("artworksSeen", () => {
  it("returns 0 when there is no active slide", () => {
    const { telemetry } = makeTelemetry({ slideIndex: -1, records: [] });
    expect(telemetry.artworksSeen()).toBe(0);
  });

  it("counts the slide index directly when the first record is a real item", () => {
    const { telemetry } = makeTelemetry({
      slideIndex: 2,
      records: [{ item: {} }, { item: {} }, { item: {} }],
    });
    expect(telemetry.artworksSeen()).toBe(3);
  });

  it("subtracts one when the first record is a non-item intro slide", () => {
    const { telemetry } = makeTelemetry({
      slideIndex: 2,
      records: [{}, { item: {} }, { item: {} }],
    });
    expect(telemetry.artworksSeen()).toBe(2);
  });

  it("never goes negative when sitting on the intro slide itself", () => {
    const { telemetry } = makeTelemetry({
      slideIndex: 0,
      records: [{}, { item: {} }],
    });
    expect(telemetry.artworksSeen()).toBe(0);
  });
});

describe("onScroll", () => {
  it("fires feed_depth for each milestone newly reached", () => {
    const records = Array.from({ length: 20 }, () => ({ item: {} }));
    const { telemetry, trackEvent } = makeTelemetry({
      slideIndex: 9,
      records,
    });
    telemetry.onScroll();
    expect(trackEvent).toHaveBeenCalledWith("feed_depth", { slides: 10 });
  });

  it("does not re-fire a milestone already reached when scrolling back up", () => {
    const records = Array.from({ length: 20 }, () => ({ item: {} }));
    let slideIndex = 9;
    const trackEvent = vi.fn();
    const telemetry = new ScrollTelemetry({
      activeSlideIndex: () => slideIndex,
      getSlideRecords: () => records,
      trackEvent,
    });
    telemetry.onScroll();
    trackEvent.mockClear();
    slideIndex = 4; // scrolled back up
    telemetry.onScroll();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("tracks the highest depth reached, not the current one", () => {
    const records = Array.from({ length: 60 }, () => ({ item: {} }));
    let slideIndex = 24;
    const trackEvent = vi.fn();
    const telemetry = new ScrollTelemetry({
      activeSlideIndex: () => slideIndex,
      getSlideRecords: () => records,
      trackEvent,
    });
    telemetry.onScroll(); // reaches 25
    slideIndex = 49;
    telemetry.onScroll(); // reaches 50
    slideIndex = 30; // scroll back up, still above the first milestone
    trackEvent.mockClear();
    telemetry.onScroll();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});
