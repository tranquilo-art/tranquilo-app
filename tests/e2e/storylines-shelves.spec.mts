// Storylines and Discover shelves -- the two curated surfaces. Both are
// overlays over the feed with their own navigation and exit, so they get
// access / navigate / exit coverage each.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, scrollToSlide } from "./harness.mts";

// Storyline chips only exist on slides whose item belongs to a storyline, so
// this finds one rather than assuming a position.
async function openFirstStoryline(page: Page) {
  const index = await page.evaluate(() => {
    const slides = [...document.querySelectorAll<HTMLElement>("#feed .slide")];
    return slides.findIndex((s) => s.dataset.slug && s.dataset.category);
  });
  // Walk forward until a hydrated slide actually offers a storyline chip.
  for (let i = Math.max(index, 1); i < 60; i++) {
    await scrollToSlide(page, i);
    const chip = page.locator("#feed .slide").nth(i).locator(".storyline-chip");
    if (await chip.count()) {
      await chip.click();
      return i;
    }
  }
  throw new Error("no storyline chip found in the first 60 slides");
}

test("Storylines: open, navigate chapters, and exit", async ({ page }) => {
  await gotoFeed(page);
  await openFirstStoryline(page);

  const mode = page.locator("#storylineMode");
  await expect(mode).toHaveClass(/open/);
  await expect(mode).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#storylineHeaderTitle")).not.toBeEmpty();

  // The track is an intro page plus one page per chapter; the timeline has
  // a dot per chapter and none for the intro.
  const pageCount = await page.locator("#storylineTrack > *").count();
  const chapterCount = await page
    .locator("#storylineTrack .storyline-chapter-page")
    .count();
  expect(chapterCount).toBeGreaterThan(0);
  expect(pageCount).toBe(chapterCount + 1);
  await expect(page.locator("#storylineTimeline .storyline-dot")).toHaveCount(
    chapterCount,
  );

  // Positions are 1..N with no gaps, mirroring check_storyline_integrity.py's
  // server-side invariant.
  const positions = await page
    .locator("#storylineTimeline .storyline-dot")
    .evaluateAll((els) => els.map((e) => Number(e.dataset.position)));
  expect(positions).toEqual([...Array(chapterCount)].map((_, i) => i + 1));

  await page.locator("#storylineTimeline .storyline-dot").nth(1).click();
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(
    () =>
      document.getElementById("storylineTrack")!.scrollLeft ||
      document.getElementById("storylineTrack")!.scrollTop,
  );
  expect(scrolled).toBeGreaterThan(0);

  await page.locator("#storylineClose").click();
  await expect(mode).not.toHaveClass(/open/);
  await expect(mode).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#feed .slide").first()).toBeVisible();
});

test("Storylines: no chapter renders blank", async ({ page }) => {
  // The client-side half of check_storyline_integrity.py's server-side
  // check: a chapter referencing a withheld item renders an empty slide.
  await gotoFeed(page);
  await openFirstStoryline(page);
  // Asserts the img has a real src, not just that an <img> element exists --
  // dropping `img` from the manifest once produced `<img src="undefined">`,
  // an element with no picture, which shipped before this caught it.
  const broken = await page
    .locator("#storylineTrack img")
    .evaluateAll((els) =>
      els
        .map((e) => e.getAttribute("src"))
        .filter((src) => !src || src === "undefined" || src === "null"),
    );
  expect(broken, "chapters rendered with no usable image src").toEqual([]);

  const empties = await page
    .locator("#storylineTrack > *")
    .evaluateAll(
      (els) =>
        els.filter((e) => !e.textContent.trim() && !e.querySelector("img"))
          .length,
    );
  expect(empties).toBe(0);
});

test("Shelves: open Discover, navigate a shelf, and exit", async ({ page }) => {
  await gotoFeed(page);
  await page.locator("#discoverToggle").click();

  const mode = page.locator("#shelvesMode");
  await expect(mode).toHaveClass(/open/);
  await expect(mode).toHaveAttribute("aria-hidden", "false");

  const rows = page.locator("#shelvesBody > *");
  expect(await rows.count()).toBeGreaterThan(0);

  const _firstRail = rows
    .first()
    .locator("*")
    .filter({ has: page.locator("img") })
    .first();
  await expect(rows.first()).toBeVisible();
  const railScrolled = await page.evaluate(() => {
    const rail = [...document.querySelectorAll("#shelvesBody *")].find(
      (e) => e.scrollWidth > e.clientWidth + 10,
    );
    if (!rail) return null;
    rail.scrollLeft = 300;
    return rail.scrollLeft;
  });
  if (railScrolled !== null) expect(railScrolled).toBeGreaterThan(0);

  await page.locator("#shelvesClose").click();
  await expect(mode).not.toHaveClass(/open/);
  await expect(page.locator("#feed .slide").first()).toBeVisible();
});

test("Shelves: tapping a shelf item opens it", async ({ page }) => {
  await gotoFeed(page);
  await page.locator("#discoverToggle").click();
  await expect(page.locator("#shelvesMode")).toHaveClass(/open/);

  // Same check for shelves: a `src="undefined"` card looks like a working
  // <img> to any test that only counts elements.
  const brokenCards = await page
    .locator("#shelvesBody img")
    .evaluateAll((els) =>
      els
        .map((e) => e.getAttribute("src"))
        .filter((src) => !src || src === "undefined" || src === "null"),
    );
  expect(brokenCards, "shelf cards rendered with no usable image src").toEqual(
    [],
  );

  // A rail must not render more cards than were hydrated -- the first fix
  // hydrated 12 per shelf but still rendered every qualifying item, leaving
  // cards 13+ blank in production. No fixture shelf is big enough to
  // reproduce this, so the cap is asserted directly.
  const perShelf = await page
    .locator("#shelvesBody .shelf")
    .evaluateAll((rows) =>
      rows.map((r) => r.querySelectorAll(".shelf-item").length),
    );
  expect(Math.max(...perShelf, 0)).toBeLessThanOrEqual(12);

  const card = page.locator("#shelvesBody img").first();
  await expect(card).toBeVisible();
  await card.click();
  // Either the detail modal opens or the feed navigates to the item; both
  // count as "it opened".
  await page.waitForTimeout(600);
  const opened = await page.evaluate(
    () =>
      document.getElementById("detailModal")?.classList.contains("open") ||
      !document.getElementById("shelvesMode")!.classList.contains("open"),
  );
  expect(opened).toBe(true);
});
