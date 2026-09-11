// When the Collect nudge is allowed to appear. The old gate was "once per
// 24h AND once per session", essentially untestable by hand; it now fires
// on the Nth save, a deterministic behaviour worth pinning down.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, scrollToSlide } from "./harness.mts";

const MIN_SAVED = 3; // mirrors UPSELL_MIN_SAVED in js/app.js

// Slide 0 is `.slide.intro`, a title card with no Save button.
const FIRST_ARTWORK_SLIDE = 1;

// `startAt` matters because Collect is a toggle: clicking an already-saved
// slide un-saves it, firing no nudge.
async function saveSlides(
  page: Page,
  count: number,
  startAt = FIRST_ARTWORK_SLIDE,
) {
  for (let i = 0; i < count; i++) {
    const idx = startAt + i;
    await scrollToSlide(page, idx);
    const btn = page.locator("#feed .slide").nth(idx).locator(".btn-collect");
    await btn.click();
    // Asserts the toggle direction, so a mis-targeted slide fails obviously here.
    await expect(btn).toHaveAttribute("aria-pressed", "true");
  }
}

test("stays hidden before the collection is worth losing", async ({ page }) => {
  // The old behaviour usually fired on the first save, before the visitor
  // had anything to lose.
  await gotoFeed(page);
  await saveSlides(page, MIN_SAVED - 1);
  await expect(page.locator("#upsellToast")).not.toHaveClass(/show/);
});

test("appears on the Nth save", async ({ page }) => {
  await gotoFeed(page);
  await saveSlides(page, MIN_SAVED);
  await expect(page.locator("#upsellToast")).toHaveClass(/show/);
});

test("does not nag -- once per session even as saving continues", async ({
  page,
}) => {
  await gotoFeed(page);
  await saveSlides(page, MIN_SAVED);
  await expect(page.locator("#upsellToast")).toHaveClass(/show/);
  await page.locator("#upsellClose").click();
  await expect(page.locator("#upsellToast")).not.toHaveClass(/show/);

  // Two more new saves, well past the threshold: silence is correct.
  await saveSlides(page, 2, FIRST_ARTWORK_SLIDE + MIN_SAVED);
  await expect(page.locator("#upsellToast")).not.toHaveClass(/show/);
});

test("its CTA points at the waitlist", async ({ page }) => {
  // A nudge that fires and then 404s spends the visitor's attention for nothing.
  await gotoFeed(page);
  await saveSlides(page, MIN_SAVED);
  await expect(page.locator("#upsellToast")).toHaveClass(/show/);
  const target = await page.evaluate(
    () =>
      new URL(
        document.getElementById("upsellCta")!.getAttribute("href")!,
        document.baseURI,
      ).pathname,
  );
  expect(target).toBe("/pages/pro.html");
});

test("?resetUpsell=1 re-arms it without emptying the collection", async ({
  page,
}) => {
  await gotoFeed(page);
  await saveSlides(page, MIN_SAVED);
  await expect(page.locator("#upsellToast")).toHaveClass(/show/);
  await page.locator("#upsellClose").click();

  await gotoFeed(page, "?resetUpsell=1");
  // The collection survives, so the reset must not open a path a real
  // visitor couldn't reach.
  const saved = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("tranquilo:collection") || "[]").length,
  );
  expect(saved).toBeGreaterThanOrEqual(MIN_SAVED);

  // An unsaved slide: re-clicking an existing one would un-save it.
  await saveSlides(page, 1, FIRST_ARTWORK_SLIDE + MIN_SAVED);
  await expect(page.locator("#upsellToast")).toHaveClass(/show/);
});
