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

test("they stay together once a search hands off to the filter banner", async ({
  page,
}) => {
  // The chip row that used to hold them in place (and hide
  // itself for the banner) became three always-visible dropdowns that
  // never hide -- so this now checks the same clustering with the
  // banner showing ALONGSIDE the dropdowns, not replacing them.
  await gotoFeed(page);
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("a");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#filterBanner")!).display !==
      "none",
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
  // openSearch() hides the banner while the panel covers that space --
  // The chip row that used to also hide in this state (leaving
  // NOTHING to occupy the middle flex slot, scattering the icons under
  // space-between; measured before that fix: 980px spread at a 1440px
  // viewport) is now three dropdowns that stay visible throughout, so
  // they're what occupies that slot here instead.
  await gotoFeed(page);
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("play");
  await page.keyboard.press("Enter");
  await page.locator("#searchToggle").click();
  await page.waitForFunction(
    () => {
      const vis = (s: string) =>
        getComputedStyle(document.querySelector(s)!).display !== "none";
      return vis("#searchBar") && vis(".chips") && !vis(".filter-banner");
    },
    null,
    { timeout: 5000 },
  );
  expect(await iconSpread(page)).toBeLessThan(CLUSTERED_MAX_PX);
});

// The four icons read as one segmented control, not four loose circles:
// fixed left-to-right order, and no daylight between neighbours. Measured
// on screen rather than in the DOM, since the desktop layout used to
// place each icon by CSS `order` independently of where it sat in markup.
const GROUP_ORDER = [
  "searchToggle",
  "discoverToggle",
  "collectionToggle",
  "musicToggle",
];

async function iconRow(page: Page) {
  return page.evaluate((ids) => {
    return ids.map((id) => {
      const r = document.getElementById(id)!.getBoundingClientRect();
      return { id, x: r.x, right: r.right, y: r.y };
    });
  }, GROUP_ORDER);
}

for (const width of [390, 1440]) {
  test(`${width}px: the icons read Search, Discover, Collection, Music`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoFeed(page);
    const row = await iconRow(page);
    const onScreen = [...row].sort((a, b) => a.x - b.x).map((r) => r.id);
    expect(onScreen).toEqual(GROUP_ORDER);
  });

  test(`${width}px: the icons are one group, with no gaps between them`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoFeed(page);
    const row = await iconRow(page);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - row[i - 1].right;
      expect(
        Math.abs(gap),
        `${row[i - 1].id} → ${row[i].id} gap`,
      ).toBeLessThanOrEqual(1.5);
      // Same row, not wrapped onto a second line.
      expect(Math.abs(row[i].y - row[0].y)).toBeLessThanOrEqual(1);
    }
  });
}

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
