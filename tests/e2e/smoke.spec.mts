import { expect, test } from "@playwright/test";
import {
  activeIndex,
  gotoFeed,
  hydratedCount,
  scrollToSlide,
} from "./harness.mts";

// Peak DOM cost is a constant, not a function of how far someone scrolled.
// Before the recycling window, browsing to slide 60 meant 61 fully-built
// slides and 61 decoded images held for the session -- unbounded at scale.
test("hydrated slides stay bounded however far you scroll", async ({
  page,
}) => {
  const feed = await gotoFeed(page);
  const total = await feed.locator(".slide").count();
  expect(total).toBeGreaterThan(50);

  // RECYCLE_RADIUS is 5, so 11 windowed slides, plus the permanent intro.
  const CEILING = 12;
  const counts: Record<number, number> = {};
  for (const target of [0, 20, 60, 95, 0]) {
    await scrollToSlide(page, target);
    expect(await activeIndex(page)).toBe(target);
    counts[target] = await hydratedCount(page);
    expect(counts[target]).toBeLessThanOrEqual(CEILING);
    expect(counts[target]).toBeGreaterThan(0);
  }
  console.log(
    `  ${total} slides; hydrated by position: ${JSON.stringify(counts)}`,
  );
});

// Releasing a slide must release the image, not just detach the node, or the
// decoded bitmaps (which dominate memory cost) stay held.
test("a released slide drops its image", async ({ page }) => {
  await gotoFeed(page);
  await scrollToSlide(page, 5);
  const near = await page.evaluate(
    () => document.querySelectorAll("#feed .slide img[src]").length,
  );
  await scrollToSlide(page, 80);
  const far = await page.evaluate(
    () => document.querySelectorAll("#feed .slide img[src]").length,
  );
  console.log(`  imgs with src: ${near} near slide 5, ${far} near slide 80`);
  expect(far).toBeLessThanOrEqual(12);
  expect(near).toBeLessThanOrEqual(12);
});

// A window that releases but never re-hydrates would show blank slides
// scrolling back up.
test("scrolling back rebuilds released slides", async ({ page }) => {
  await gotoFeed(page);
  await scrollToSlide(page, 3);
  const slug = await page
    .locator("#feed .slide")
    .nth(3)
    .getAttribute("data-slug");
  await scrollToSlide(page, 80);
  expect(
    await page.locator(`#feed .slide[data-slug="${slug}"] img`).count(),
  ).toBe(0);
  await scrollToSlide(page, 3);
  await expect(
    page.locator(`#feed .slide[data-slug="${slug}"] img`),
  ).toHaveCount(1);
});
