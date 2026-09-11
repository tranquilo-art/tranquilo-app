// The tulip on the Discover overlay goes home. It was a decorative <img>
// sitting where the topbar's wordmark normally is; since the overlay covers
// the topbar, the one control that means "back to the start" everywhere
// else became inert inside Discover. Matches the topbar's existing pattern
// (`<a class="wordmark" href="/">`) rather than just closing the overlay,
// so it middle-clicks and opens in a new tab like a real link.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

async function openDiscover(page: Page) {
  await gotoFeed(page);
  await page.locator("#discoverToggle").click();
  await expect(page.locator("#shelvesMode")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
}

test("the tulip is a link to the homepage", async ({ page }) => {
  await openDiscover(page);
  const mark = page.locator("#shelvesMode .shelves-mark-link");
  await expect(mark).toHaveAttribute("href", "/");
});

test("it carries an accessible name", async ({ page }) => {
  // The image inside is decorative (alt="", aria-hidden), so without a
  // label the link announces as nothing at all -- worse than the inert
  // image it replaced, since now it is focusable.
  await openDiscover(page);
  await expect(page.locator("#shelvesMode .shelves-mark-link")).toHaveAttribute(
    "aria-label",
    /tranquilo/i,
  );
});

test("the heading beside it is not part of the link", async ({ page }) => {
  // A link swallowing the "Discover" heading would make the page's own
  // title look like a way to leave it.
  await openDiscover(page);
  const inside = await page
    .locator("#shelvesMode .shelves-mark-link")
    .evaluate((a) => a.textContent.trim());
  expect(inside).toBe("");
});

test("clicking it lands on the homepage with Discover closed", async ({
  page,
}) => {
  await openDiscover(page);
  await page.locator("#shelvesMode .shelves-mark-link").click();
  await page.waitForLoadState("domcontentloaded");
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(page.locator("#shelvesMode")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});
