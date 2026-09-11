// A storyline could not be read with a mouse: .storyline-track hides its
// scrollbar with no touch gesture or button to replace it, leaving only
// arrow keys, undiscoverable without guessing. These run against the
// fixture storyline, asserting the mechanism rather than the content.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fixtureStoryline, gotoStoryline } from "./harness.mts";

const STORY = fixtureStoryline();
const nav = (page: Page, dir: string) =>
  page.locator(`#storylineMode [data-storyline-nav="${dir}"]`);
const pageAt = (page: Page) =>
  page.evaluate(() => {
    const t = document.getElementById("storylineTrack")!;
    return Math.round(t.scrollLeft / t.clientWidth);
  });

test("next advances one page at a time", async ({ page }) => {
  await gotoStoryline(page, STORY.id);
  expect(await pageAt(page)).toBe(0);
  await nav(page, "next").click();
  await expect.poll(() => pageAt(page)).toBe(1);
  await nav(page, "next").click();
  await expect.poll(() => pageAt(page)).toBe(2);
});

test("prev goes back", async ({ page }) => {
  await gotoStoryline(page, STORY.id);
  await nav(page, "next").click();
  await expect.poll(() => pageAt(page)).toBe(1);
  await nav(page, "prev").click();
  await expect.poll(() => pageAt(page)).toBe(0);
});

test("prev is unavailable on the intro page", async ({ page }) => {
  // A control that looks disabled and still fires is worse than one absent.
  await gotoStoryline(page, STORY.id);
  await expect(nav(page, "prev")).toBeDisabled();
});

test("next is unavailable on the last chapter", async ({ page }) => {
  await gotoStoryline(page, STORY.id);
  const last = STORY.items.length; // intro + N chapters, zero-indexed => N
  for (let i = 0; i < last; i++) await nav(page, "next").click();
  await expect.poll(() => pageAt(page)).toBe(last);
  await expect(nav(page, "next")).toBeDisabled();
});

test("the buttons re-enable once you move away from an end", async ({
  page,
}) => {
  // State is driven by where the track actually is, not a click counter --
  // arrow keys and swipes move it too.
  await gotoStoryline(page, STORY.id);
  await expect(nav(page, "prev")).toBeDisabled();
  await nav(page, "next").click();
  await expect(nav(page, "prev")).toBeEnabled();
});

test("keyboard scrolling updates the buttons too", async ({ page }) => {
  await gotoStoryline(page, STORY.id);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => pageAt(page)).toBe(1);
  await expect(nav(page, "prev")).toBeEnabled();
});

test("the hint does not tell a mouse user to swipe", async ({ page }) => {
  await gotoStoryline(page, STORY.id);
  const hint = page.locator("#storylineMode .storyline-intro-hint");
  await expect(hint).toBeVisible();
  await expect(hint).not.toContainText(/swipe/i);
});
