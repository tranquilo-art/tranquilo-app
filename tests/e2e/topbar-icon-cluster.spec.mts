// The header icons scatter across the width when a search is active. At
// >=720px the topbar flattens (`display:contents`), promoting its children
// to direct flex children placed by `order`. .chips normally eats the free
// space under `justify-content:space-between`, clustering the icons right;
// hiding .chips on search leaves space-between distributing the gap
// between the icons instead -- measured on production at 1900px: 266px
// apart became 1325px apart. The fix is an auto margin on the first icon.
// These tests measure the spread rather than asserting a CSS rule, since
// the bug is emergent from three interacting declarations.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

const CLUSTERED_MAX_PX = 400;

async function iconSpread(page: Page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll(".topbar-icons > button")];
    if (btns.length < 2) return null;
    const first = btns[0].getBoundingClientRect();
    const last = btns[btns.length - 1].getBoundingClientRect();
    return Math.round(last.right - first.x);
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("the icons sit together before a search", async ({ page }) => {
  await gotoFeed(page);
  expect(await iconSpread(page)).toBeLessThan(CLUSTERED_MAX_PX);
});

test("they stay together once the chips are hidden by a search", async ({
  page,
}) => {
  // The chips row is what used to hold them in place; nothing should
  // depend on a sibling being present.
  await gotoFeed(page);
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("a");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".chips")!).display === "none",
    null,
    { timeout: 5000 },
  );
  expect(await iconSpread(page)).toBeLessThan(CLUSTERED_MAX_PX);
});

// A test asserting a state the app never produces (chips detached rather
// than hidden) was removed: satisfying it required `margin-left:auto` on
// the first icon, which made the lightbox unopenable and broke three tests
// in two other specs for an hour before the bisect found it. A speculative
// guard that costs a real regression is a bad trade.

test("they stay together while the search PANEL is still open", async ({
  page,
}) => {
  // .filter-banner takes the chips' slot with flex:1 so the row always has
  // a growing element, but openSearch() hides the banner too while the
  // panel covers that space -- with both hidden, space-between scatters
  // the icons. Measured before the fix: 980px spread at a 1440px viewport.
  await gotoFeed(page);
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("play");
  await page.keyboard.press("Enter");
  await page.locator("#searchToggle").click();
  await page.waitForFunction(
    () => {
      const vis = (s: string) =>
        getComputedStyle(document.querySelector(s)!).display !== "none";
      return vis("#searchBar") && !vis(".chips") && !vis(".filter-banner");
    },
    null,
    { timeout: 5000 },
  );
  expect(await iconSpread(page)).toBeLessThan(CLUSTERED_MAX_PX);
});

test("the icons remain the rightmost thing in the header", async ({ page }) => {
  // Clustering alone isn't enough -- clustered on the left would pass a
  // spread check and still be wrong.
  await gotoFeed(page);
  await page.evaluate(() => document.querySelector(".chips")?.remove());
  const { lastRight, viewportWidth } = await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".topbar-icons > button")];
    return {
      lastRight: Math.round(
        btns[btns.length - 1].getBoundingClientRect().right,
      ),
      viewportWidth: window.innerWidth,
    };
  });
  expect(viewportWidth - lastRight).toBeLessThan(60);
});
