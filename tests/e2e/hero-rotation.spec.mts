// "All" must not open on the same artwork every time -- HERO_IDS, five
// hand-picked openers, was replayed every session. Unit tests
// (tests/hero-selection.test.js) cover the selection itself; these cover
// what only exists in the browser: the opening varies between sessions,
// and a returning visitor isn't shown the welcome mat.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, useHeroPool } from "./harness.mts";

const SEEN_KEY = "tranquilo:hasSeenFeed";

async function openingTitles(page: Page, n = 3) {
  // The intro slide carries no title button, so slide 0 is legitimately
  // empty and a bare read races the first hydrated artwork.
  await page
    .locator("#feed .slide .art-title-btn")
    .first()
    .waitFor({ timeout: 5000 });
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = page.locator("#feed .slide").nth(i).locator(".art-title-btn");
    out.push((await t.count()) ? (await t.textContent())!.trim() : null);
  }
  return out.filter(Boolean);
}

test("a first-time visitor gets the hand-picked opening", async ({ page }) => {
  await gotoFeed(page);
  expect((await openingTitles(page)).length).toBeGreaterThan(0);
  // Only set once something actually rendered -- a failed load must not
  // burn the one first impression a visitor gets.
  const seen = await page.evaluate((k) => localStorage.getItem(k), SEEN_KEY);
  expect(seen).toBe("1");
});

test("a returning visitor goes straight into the catalogue", async ({
  page,
  browser,
}) => {
  useHeroPool(page);
  await page.addInitScript((k) => {
    localStorage.setItem(k, "1");
    // Pin the random start so the opening can't match the heroes.
    Math.random = () => 0.5;
  }, SEEN_KEY);
  await gotoFeed(page);
  const titles = await openingTitles(page, 3);
  expect(titles.length).toBeGreaterThan(0); // the feed still renders

  // A fresh context, not page.context().newPage(): pages in one context
  // share localStorage, so a second page there would read the flag set
  // above and be a returning visitor too.
  const ctx = await browser.newContext();
  const firstVisit = await ctx.newPage();
  useHeroPool(firstVisit);
  await gotoFeed(firstVisit);
  const heroTitles = await openingTitles(firstVisit, 3);
  expect(titles.join("|")).not.toBe(heroTitles.join("|"));
  await ctx.close();
});

test("two sessions do not open on the same artwork", async ({ browser }) => {
  // A fresh context per seed, not a new page: pages in one context share
  // localStorage, so visitors 2..n would read as returning and skip heroes
  // entirely. Asserts that some openings differ rather than any two
  // specific ones, since the e2e fixture holds only 8 of the 19 pool items.
  const seeds = [11, 4242, 777, 90210];
  const openings = [];
  for (const seed of seeds) {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.addInitScript((sd) => {
      window.__tranquiloHeroSeed = sd;
    }, seed);
    await gotoFeed(p2);
    openings.push((await openingTitles(p2, 3)).join("|"));
    await ctx.close();
  }
  expect(
    openings.every((o) => o.length > 0),
    JSON.stringify(openings),
  ).toBe(true);
  expect(
    new Set(openings).size,
    `openings across sessions: ${JSON.stringify(openings)}`,
  ).toBeGreaterThan(1);
});

test("the same session keeps its opening across a category round-trip", async ({
  page,
}) => {
  // Filtering into a category and back to "All" must not reshuffle;
  // sessionHeroes is computed once per page load so this holds.
  await gotoFeed(page);
  const before = await openingTitles(page, 3);
  expect(before.length).toBeGreaterThan(0);

  // Category chips became a single Category dropdown.
  const categorySelect = page.locator("#categorySelect");
  const options = await categorySelect.locator("option").allTextContents();
  const label = options.find((o) => o !== "All Categories");
  expect(label, "a real category option should exist").toBeTruthy();

  await categorySelect.selectOption({ label: label! });
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 1);

  await categorySelect.selectOption({ label: "All Categories" });
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 2);

  expect((await openingTitles(page, 3)).join("|")).toBe(before.join("|"));
});
