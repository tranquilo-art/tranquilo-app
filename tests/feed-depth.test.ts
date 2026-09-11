// Measures feed depth in slides, not in percent. A percentage of
// feedEl.scrollHeight silently changed meaning as the feed evolved from a
// few hundred items to a manifest with hydrate-on-demand recycling (which
// keeps every slide's geometry, so scrollHeight became the whole
// catalogue), and paging means scrollHeight grows during the very session
// being measured. An absolute count ("saw 10 artworks") means the same
// thing regardless of paging, recycling, or catalogue size.
import { describe, expect, it } from "vitest";
import { FEED_DEPTH_MILESTONES, feedDepthMilestones } from "../src/logic/logic";

describe("FEED_DEPTH_MILESTONES", () => {
  it("starts at 1, because the first artwork is the question we actually have", () => {
    expect(FEED_DEPTH_MILESTONES[0]).toBe(1);
  });

  it("is ascending, with no duplicates", () => {
    const sorted = [...FEED_DEPTH_MILESTONES].sort((a, b) => a - b);
    expect(FEED_DEPTH_MILESTONES).toEqual(sorted);
    expect(new Set(FEED_DEPTH_MILESTONES).size).toBe(
      FEED_DEPTH_MILESTONES.length,
    );
  });
});

describe("feedDepthMilestones", () => {
  it("reports the first milestone on the first slide", () => {
    expect(feedDepthMilestones(1, [])).toEqual([1]);
  });

  it("reports nothing for slide zero", () => {
    // The intro slide is not an artwork.
    expect(feedDepthMilestones(0, [])).toEqual([]);
  });

  it("does not repeat a milestone already reported", () => {
    expect(feedDepthMilestones(1, [1])).toEqual([]);
    expect(feedDepthMilestones(7, [1, 5])).toEqual([]);
  });

  it("reports a milestone once, on the slide that crosses it", () => {
    expect(feedDepthMilestones(4, [1])).toEqual([]);
    expect(feedDepthMilestones(5, [1])).toEqual([5]);
    expect(feedDepthMilestones(6, [1, 5])).toEqual([]);
  });

  it("catches up when several are crossed at once", () => {
    // A deep link can land far down the feed without passing through
    // intermediate slides; every milestone below is still "reached".
    expect(feedDepthMilestones(25, [])).toEqual([1, 5, 10, 25]);
  });

  it("never reports a milestone beyond the depth reached", () => {
    const out = feedDepthMilestones(30, []);
    for (const m of out) expect(m).toBeLessThanOrEqual(30);
    expect(out).not.toContain(50);
  });

  it("keeps working past the last milestone", () => {
    expect(feedDepthMilestones(400, FEED_DEPTH_MILESTONES)).toEqual([]);
  });

  it("is not confused by an unsorted or over-full fired list", () => {
    expect(feedDepthMilestones(10, [5, 1])).toEqual([10]);
  });
});

describe("what it does NOT depend on", () => {
  it("gives the same answer regardless of how much is loaded", () => {
    // Unlike the old metric, this has no access to scrollHeight at all.
    expect(feedDepthMilestones(10, [1, 5])).toEqual([10]);
    expect(feedDepthMilestones.length).toBe(2); // (slidesSeen, alreadyFired)
  });
});
