// "All" must not open on the same artwork every time -- HERO_IDS, five
// hand-picked openers, was replayed every session. Unit tests
// (tests/hero-selection.test.js) cover the selection itself; these cover
// what only exists in the browser: the opening varies between sessions,
// and a returning visitor isn't shown the welcome mat.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

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
}) => {
  await page.addInitScript((k) => {
    localStorage.setItem(k, "1");
  }, SEEN_KEY);
  await gotoFeed(page);
  const titles = await openingTitles(page, 3);
  expect(titles.length).toBeGreaterThan(0); // the feed still renders

  const firstVisit = await page.context().newPage();
  await gotoFeed(firstVisit);
  const heroTitles = await openingTitles(firstVisit, 3);
  expect(titles.join("|")).not.toBe(heroTitles.join("|"));
  await firstVisit.close();
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

  const chips = page.locator("#chips .chip, .chips .chip");
  const count = await chips.count();
  expect(count, "category chips should render").toBeGreaterThan(1);

  let clicked = false;
  for (let i = 0; i < count; i++) {
    const label = ((await chips.nth(i).textContent()) || "").trim();
    if (label && label !== "All" && label !== "Storyline") {
      await chips.nth(i).click();
      clicked = true;
      break;
    }
  }
  expect(clicked, "found a category chip to filter by").toBe(true);
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 1);

  await page
    .locator("#chips .chip, .chips .chip")
    .filter({ hasText: /^All$/ })
    .first()
    .click();
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 2);

  expect((await openingTitles(page, 3)).join("|")).toBe(before.join("|"));
});
