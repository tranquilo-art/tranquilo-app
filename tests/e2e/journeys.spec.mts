// The two end-to-end journeys: scroll the feed, open an item's details, open
// the lightbox, and come back out. Run from both entry points since the
// homepage keeps the intro slide and hero ordering while a category view
// skips the intro and uses a different ordering function.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  actAndSettle,
  gotoFeed,
  hydratedCount,
  scrollToSlide,
} from "./harness.mts";

async function runJourney(page: Page, startIndex: number) {
  // Scroll deep enough that the target slide was built by the recycling
  // window, not the first render.
  await scrollToSlide(page, startIndex);
  const slide = page.locator("#feed .slide").nth(startIndex);
  await expect(slide.locator(".art-title-btn")).toBeVisible();
  const title = (await slide.locator(".art-title-btn").textContent())!.trim();

  await slide.locator(".art-title-btn").click();
  const detail = page.locator("#detailModal");
  await expect(detail).toHaveClass(/open/);
  await expect(detail).toContainText(title);

  await page.locator("#detailClose").click();
  await expect(detail).not.toHaveClass(/open/);

  // Clicks near the TOP of the frame, not the centre: the caption overlay's
  // height varies by item, and Playwright's default centre-click can land on
  // a tall caption instead, which intercepts pointer events forever.
  await slide.locator(".art-frame").click({ position: { x: 60, y: 40 } });
  const lightbox = page.locator("#lightbox");
  await expect(lightbox).toHaveClass(/open/);
  await expect(page.locator("#lightboxImg")).toHaveAttribute("src", /.+/);

  await page.locator("#lightboxClose").click();
  await expect(lightbox).not.toHaveClass(/open/);

  await expect(slide).toBeVisible();
  expect(await hydratedCount(page)).toBeLessThanOrEqual(12);
  return title;
}

test("Journey: homepage -> scroll -> details -> lightbox", async ({ page }) => {
  await gotoFeed(page);
  const title = await runJourney(page, 30);
  expect(title.length).toBeGreaterThan(0);
});

test("Journey: category -> scroll -> details -> lightbox", async ({ page }) => {
  const feed = await gotoFeed(page);
  // Pick the category with the most items to have something to scroll to.
  const chipIndex = await page.evaluate(() => {
    const counts: Record<string, number> = {};
    document
      .querySelectorAll<HTMLElement>("#feed .slide[data-category]")
      .forEach((s) => {
        const cat = s.dataset.category || "";
        counts[cat] = (counts[cat] || 0) + 1;
      });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    return [...document.querySelectorAll("#chips button")].findIndex(
      (b) => b.textContent.trim() === best,
    );
  });
  // A category selection re-renders asynchronously; without waiting, the
  // count below races the fetch and can catch the feed mid-clear.
  await actAndSettle(page, () =>
    page.locator("#chips button").nth(chipIndex).click(),
  );

  const count = await feed.locator(".slide").count();
  expect(count).toBeGreaterThan(6);
  // A category view has no intro slide, so index 0 is already an artwork.
  const title = await runJourney(page, Math.min(10, count - 1));
  expect(title.length).toBeGreaterThan(0);
});

// Three smooth-scroll convergences plus two hydration waits exceed the 30s
// default under five parallel workers. Marked slow rather than retried: the
// test is correct and the time is real.
test.slow();
test("Journey: the lightbox works on a slide that was released and rebuilt", async ({
  page,
}) => {
  // A rebuilt slide gets fresh listeners from buildSlideContents(); if
  // cancel()/rebuild dropped one, taps would silently stop working after
  // scrolling away and back.
  await gotoFeed(page);
  await scrollToSlide(page, 5);
  const slug = await page
    .locator("#feed .slide")
    .nth(5)
    .getAttribute("data-slug");
  await scrollToSlide(page, 80);
  await scrollToSlide(page, 5);

  const slide = page.locator(`#feed .slide[data-slug="${slug}"]`);
  // Above the caption overlay -- see runJourney()'s centre-click note.
  await slide.locator(".art-frame").click({ position: { x: 60, y: 40 } });
  await expect(page.locator("#lightbox")).toHaveClass(/open/);
  await page.locator("#lightboxClose").click();

  await slide.locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
  await page.locator("#detailClose").click();

  // And Save still works on a rebuilt slide.
  const btn = slide.locator(".btn-collect");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
});
