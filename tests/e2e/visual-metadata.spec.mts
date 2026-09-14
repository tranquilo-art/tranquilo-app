// TRA-274 Phase 2: the feed slide reads the new img_width/img_height/
// palette_hex fields when present, and falls back to today's behavior when
// absent -- most items aren't backfilled yet, so the fallback path is the
// common case in production right now, not a hypothetical.
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

const WITH_DIMENSIONS = {
  ...ITEMS[0],
  img_width: 900,
  img_height: 1200,
};
const WITHOUT_DIMENSIONS = { ...ITEMS[1], img_width: null, img_height: null };

async function gotoFeedWithItems(page: any, items: any[]) {
  await stubBackend(page, { items });
  await page.addInitScript(() => {
    if (typeof window.__tranquiloHeroSeed !== "number")
      window.__tranquiloHeroSeed = 1;
  });
  await page.goto("/index.html");
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("an item with known dimensions gets width/height attributes on its <img>", async ({
  page,
}) => {
  await gotoFeedWithItems(page, [WITH_DIMENSIONS, WITHOUT_DIMENSIONS]);
  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(WITH_DIMENSIONS.id)}"]`)
    .first();
  const img = slide.locator(".art-frame img").first();
  await expect(img).toHaveAttribute("width", "900");
  await expect(img).toHaveAttribute("height", "1200");
});

test("an item with no dimensions yet gets no width/height attributes -- today's behavior, unchanged", async ({
  page,
}) => {
  await gotoFeedWithItems(page, [WITH_DIMENSIONS, WITHOUT_DIMENSIONS]);
  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(WITHOUT_DIMENSIONS.id)}"]`)
    .first();
  const img = slide.locator(".art-frame img").first();
  await expect(img).not.toHaveAttribute("width");
  await expect(img).not.toHaveAttribute("height");
});

test("opening the lightbox names the shared element for the transition, then clears it", async ({
  page,
}) => {
  await gotoFeedWithItems(page, [WITH_DIMENSIONS, WITHOUT_DIMENSIONS]);
  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(WITH_DIMENSIONS.id)}"]`)
    .first();
  const frame = slide.locator(".art-frame");
  const feedImg = frame.locator("img").first();

  // Sanity: this Chromium build actually supports the API under test --
  // a false pass here would mean every assertion below is vacuous.
  const supported = await page.evaluate(
    () => typeof (document as any).startViewTransition === "function",
  );
  expect(supported).toBe(true);

  await frame.click({ position: { x: 12, y: 12 } });
  await expect(page.locator("#lightbox")).toHaveClass(/open/);

  // The lightbox's own <img> carries the same name the feed thumbnail
  // used -- the actual mechanism that makes the browser morph between
  // the two instead of cross-fading the whole page.
  const lightboxName = await page
    .locator("#lightboxImg")
    .evaluate((el: HTMLElement) => el.style.viewTransitionName);
  expect(lightboxName).toBe("tranquilo-lightbox-artwork");

  // The feed image's own name is released once the transition finishes,
  // so a later click on a *different* thumbnail doesn't collide with it.
  await expect
    .poll(() =>
      feedImg.evaluate((el: HTMLElement) => el.style.viewTransitionName),
    )
    .toBe("");
});
