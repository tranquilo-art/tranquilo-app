// Asserts the WIRING, in a real browser: scroll the feed and check the events
// leave the page. The arithmetic has unit tests (tests/feed-depth.test.js),
// but those passed throughout the twelve days scroll_depth was dead --
// nothing between the scroll handler and the events table was ever tested.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

interface TrackEvent {
  event_name: string;
  props: { slides: number };
}

// Registered after gotoFeed so this route (which fulfils locally) wins over
// the harness's own **/api/track** stub, which keeps the suite from
// reporting as real traffic.
async function captureTrack(page: Page) {
  const posted: TrackEvent[] = [];
  await page.route("**/api/track**", (route: Route) => {
    posted.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ status: 204, body: "" });
  });
  return posted;
}

const depths = (posted: TrackEvent[]) =>
  posted
    .filter((p) => p.event_name === "feed_depth")
    .map((p) => Number(p.props.slides));

async function scrollSlides(page: Page, n: number) {
  await page.evaluate((count: number) => {
    const feed = document.querySelector<HTMLElement>("#feed")!;
    feed.scrollTop = feed.clientHeight * count;
    feed.dispatchEvent(new Event("scroll"));
  }, n);
}

test("scrolling the feed reports feed_depth", async ({ page }) => {
  await gotoFeed(page);
  const posted = await captureTrack(page);

  await scrollSlides(page, 1);
  await expect.poll(() => depths(posted)).toContain(1);
});

test("it reports every milestone crossed, not just the highest", async ({
  page,
}) => {
  // A jump to slide 10 means 1, 5 and 10 were all reached. Reporting only the
  // top one would make the funnel non-monotonic.
  await gotoFeed(page);
  const posted = await captureTrack(page);

  await scrollSlides(page, 10);
  await expect
    .poll(() => depths(posted).sort((a, b) => a - b))
    .toEqual([1, 5, 10]);
});

test("it does not re-report a milestone already sent", async ({ page }) => {
  await gotoFeed(page);
  const posted = await captureTrack(page);

  await scrollSlides(page, 5);
  await expect.poll(() => depths(posted)).toContain(5);
  const afterFirst = depths(posted).length;

  await scrollSlides(page, 6);
  await scrollSlides(page, 7);
  await page.waitForTimeout(150);
  expect(depths(posted).length).toBe(afterFirst);
});

test("scrolling back up does not re-fire or lower the depth", async ({
  page,
}) => {
  // Depth is the furthest reached, not where the visitor currently is.
  await gotoFeed(page);
  const posted = await captureTrack(page);

  await scrollSlides(page, 5);
  await expect.poll(() => depths(posted)).toContain(5);
  const reached = depths(posted).length;

  await scrollSlides(page, 0);
  await scrollSlides(page, 2);
  await page.waitForTimeout(150);
  expect(depths(posted).length).toBe(reached);
});

test("the intro slide is not counted as an artwork", async ({ page }) => {
  // Counting the intro would make a bounced visitor look like they saw an
  // artwork -- this off-by-one has bitten three times.
  await gotoFeed(page);
  const posted = await captureTrack(page);

  await page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>("#feed")!;
    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(150);
  expect(depths(posted)).toEqual([]);
});
