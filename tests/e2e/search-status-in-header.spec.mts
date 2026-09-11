// During a search, the status belongs in the header, not over the art. The
// banner used to live outside the header as `position:fixed`, an opaque
// full-bleed strip with the artwork scrolling underneath -- every other
// overlay floats on a fading gradient. It now moves into the header and
// takes the slot the chips vacate, which required a DOM move (`order` only
// applies to flex children) and retired the fixed positioning.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

test.use({ viewport: { width: 1440, height: 900 } });

async function search(page: Page, term: string) {
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill(term);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#filterBanner")!).display !==
      "none",
    null,
    { timeout: 5000 },
  );
}

test("the status sits inside the header", async ({ page }) => {
  await gotoFeed(page);
  await search(page, "a");
  const inside = await page.evaluate(
    () => !!document.querySelector(".topbar #filterBanner"),
  );
  expect(inside).toBe(true);
});

test("it is no longer a fixed strip over the artwork", async ({ page }) => {
  await gotoFeed(page);
  await search(page, "a");
  const pos = await page.evaluate(
    () => getComputedStyle(document.querySelector("#filterBanner")!).position,
  );
  expect(pos).not.toBe("fixed");
});

test("the artwork itself clears the header", async ({ page }) => {
  // Asserted on the image, not .art-frame: the frame's box starts above the
  // fixed, transparent header by design, and .art-frame's padding-top is
  // what holds the picture clear.
  await gotoFeed(page);
  await search(page, "a");
  const clear = await page.evaluate(() => {
    const banner = document
      .querySelector("#filterBanner")!
      .getBoundingClientRect();
    const img = document.querySelector(".art-frame img");
    if (!img) return true;
    return img.getBoundingClientRect().top >= banner.bottom - 1;
  });
  expect(clear).toBe(true);
});

test("it reflects the query and the result count", async ({ page }) => {
  await gotoFeed(page);
  await search(page, "a");
  const text = await page.locator("#filterBanner").innerText();
  expect(text).toMatch(/result/i);
  expect(text).toContain("a");
});

test("the category chips are hidden while it is up", async ({ page }) => {
  await gotoFeed(page);
  await search(page, "a");
  const display = await page.evaluate(
    () => getComputedStyle(document.querySelector(".chips")!).display,
  );
  expect(display).toBe("none");
});

test("the icons stay clustered, now held by the banner instead of the chips", async ({
  page,
}) => {
  // Moving a wide element back into the row must not reintroduce the
  // scatter an earlier auto-margin fix solved.
  await gotoFeed(page);
  await search(page, "a");
  const spread = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".topbar-icons > button")];
    return Math.round(
      b[b.length - 1].getBoundingClientRect().right -
        b[0].getBoundingClientRect().x,
    );
  });
  expect(spread).toBeLessThan(400);
});

test("clearing the search brings the chips back and removes the status", async ({
  page,
}) => {
  await gotoFeed(page);
  await search(page, "a");
  await page.locator("#filterBannerClear").click();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".chips")!).display !== "none",
    null,
    { timeout: 5000 },
  );
  const bannerDisplay = await page.evaluate(
    () => getComputedStyle(document.querySelector("#filterBanner")!).display,
  );
  expect(bannerDisplay).toBe("none");
});
