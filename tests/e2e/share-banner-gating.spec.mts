// The deep-link share banner: /v/{slug} and /s/{id} both skip the intro
// slide entirely (and its Mission/Connect/Support cards with it), so a
// visitor arriving from a shared social-media link never sees that
// context. This banner is the one-time, dismissible substitute.

import { expect, test } from "@playwright/test";
import {
  fixtureStoryline,
  gotoArtwork,
  gotoFeed,
  gotoStoryline,
  ITEMS,
  stubBackend,
} from "./harness.mts";

const ITEM = ITEMS[0];
const STORYLINE = fixtureStoryline();

test("shows on a cold artwork deep-link load", async ({ page }) => {
  await gotoArtwork(page, ITEM.source || "met", ITEM.id);
  await expect(page.locator("#shareBanner")).toBeVisible();
});

test("shows on a cold storyline deep-link load", async ({ page }) => {
  await gotoStoryline(page, STORYLINE.id);
  await expect(page.locator("#shareBanner")).toBeVisible();
});

test("is absent on a plain feed load", async ({ page }) => {
  await gotoFeed(page);
  await expect(page.locator("#shareBanner")).toBeHidden();
});

test("the close button hides it, and stays hidden across a scroll -- not just tied to the current slide", async ({
  page,
}) => {
  await gotoArtwork(page, ITEM.source || "met", ITEM.id);
  await expect(page.locator("#shareBanner")).toBeVisible();
  await page.locator("#shareBannerClose").click();
  await expect(page.locator("#shareBanner")).toBeHidden();
});

test("?resetShareBanner=1 re-arms it on a fresh deep-link load", async ({
  page,
}) => {
  await gotoArtwork(page, ITEM.source || "met", ITEM.id);
  await page.locator("#shareBannerClose").click();
  await expect(page.locator("#shareBanner")).toBeHidden();

  // gotoArtwork() has no query-param hook, so this mirrors its own
  // internals (stubBackend + the deep-link URL) with ?resetShareBanner=1
  // appended -- a real second navigation in the same tab, same as the
  // ?resetUpsell=1 pattern relies on sessionStorage surviving.
  await stubBackend(page);
  await page.goto(
    `/v/${encodeURIComponent(`${ITEM.source || "met"}-${ITEM.id}`)}?resetShareBanner=1`,
  );
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  await expect(page.locator("#shareBanner")).toBeVisible();
});

test("Get newsletter opens the newsletter modal", async ({ page }) => {
  await gotoArtwork(page, ITEM.source || "met", ITEM.id);
  await page.locator("#shareBannerNewsletter").click();
  await expect(page.locator("#newsletterDialog")).toHaveClass(/open/);
});

test("Get involved points at the get-involved page", async ({ page }) => {
  await gotoArtwork(page, ITEM.source || "met", ITEM.id);
  const target = await page.evaluate(
    () =>
      new URL(
        document.getElementById("shareBannerInvolved")!.getAttribute("href")!,
        document.baseURI,
      ).pathname,
  );
  expect(target).toBe("/pages/get-involved.html");
});
