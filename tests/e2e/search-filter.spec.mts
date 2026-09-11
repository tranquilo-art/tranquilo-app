// Search and Filter -- the two ways a visitor narrows the feed. Both moved
// from pure client-side predicates to server-side; these are the
// assertions that had to keep holding across that cut.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { actAndSettle, gotoFeed, ITEMS } from "./harness.mts";

async function search(page: Page, term: string) {
  await page.locator("#searchToggle").click();
  await expect(page.locator("#searchBar")).toBeVisible();
  await page.locator("#searchInput").fill(term);
  await page.locator("#searchSubmit").click();
  // runSearch() awaits a server round trip, so the click returns long
  // before the feed re-renders; waits on the results line rather than a fixed delay.
  await expect(page.locator("#searchResultsLine")).not.toBeEmpty();
  // The recycling window builds slide contents on requestAnimationFrame,
  // one tick after the line above resolves, so back-to-back search() calls
  // can otherwise read a slide count a frame stale.
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

test("Search: narrows the feed to matching items", async ({ page }) => {
  await gotoFeed(page);
  const before = await page.locator("#feed .slide").count();

  // Chosen from the fixture rather than hardcoded, so this can't silently
  // become a no-op if the fixture is recaptured.
  const term = ITEMS.find((i: any) => i.artist && i.artist.length > 4)
    .artist.split(" ")
    .pop();
  await search(page, term);

  const after = await page.locator("#feed .slide").count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  // A successful search closes the panel, handing the count to the banner --
  // asserting the banner is asserting what the visitor can see.
  await expect(page.locator("#filterBanner")).toBeVisible();
  await expect(page.locator("#filterBannerLabel")).toContainText(String(after));
});

test("Search: is diacritic-insensitive", async ({ page }) => {
  await gotoFeed(page);
  await search(page, "cezanne");
  const folded = await page.locator("#feed .slide").count();
  await page.locator("#searchInput").fill("Cézanne");
  // A second submit re-runs the same async round trip; without waiting
  // again, the count below can catch the feed mid-fetch.
  await actAndSettle(page, () => page.locator("#searchSubmit").click());
  expect(await page.locator("#feed .slide").count()).toBe(folded);
});

test("Search: a dead-end term degrades to a prompt, never a blank screen", async ({
  page,
}) => {
  // Zero literal results falls through to did-you-mean, then the curated
  // concept map, and the feed keeps showing items throughout -- never
  // staring at an empty scroll container.
  const feed = await gotoFeed(page);
  await search(page, "zzzznomatch");
  await expect(page.locator("#searchResultsLine")).toBeVisible();
  await expect(page.locator("#searchResultsLine")).toContainText(
    /No results|related to/,
  );
  expect(await feed.locator(".slide").count()).toBeGreaterThan(0);
});

test("Search: closing the panel keeps the search applied", async ({ page }) => {
  // closeSearch() hides the bar and leaves activeSearch alone: closing a
  // panel is not the same gesture as clearing a filter.
  const feed = await gotoFeed(page);
  await search(page, "portrait");
  // Polls rather than reading once, since runSearch() can complete more
  // than one render and a one-shot read can catch the feed mid-clear.
  await expect.poll(() => feed.locator(".slide").count()).toBeGreaterThan(0);
  const narrowed = await feed.locator(".slide").count();
  await expect(page.locator("#searchBar")).toBeHidden();
  await expect(page.locator("#filterBanner")).toBeVisible();

  await page.locator("#searchToggle").click();
  await expect(page.locator("#searchBar")).toBeVisible();
  await expect(page.locator("#searchInput")).toHaveValue("portrait");

  await page.locator("#searchClose").click();
  await expect(page.locator("#searchBar")).toBeHidden();
  await expect(page.locator("#filterBanner")).toBeVisible();
  // toHaveCount retries, so this cannot race a stray re-render.
  await expect(feed.locator(".slide")).toHaveCount(narrowed);
});

test("Search: tapping outside the panel closes it without disturbing the filter", async ({
  page,
}) => {
  // SearchController's document-level outside-click listener
  // (handleOutsideSearchClick) is the one dismissal path #searchClose
  // above doesn't exercise.
  const feed = await gotoFeed(page);
  await search(page, "portrait");
  await expect.poll(() => feed.locator(".slide").count()).toBeGreaterThan(0);
  const narrowed = await feed.locator(".slide").count();
  await expect(page.locator("#searchBar")).toBeVisible();

  await page.mouse.click(10, 10);
  await expect(page.locator("#searchBar")).toBeHidden();
  await expect(page.locator("#filterBanner")).toBeVisible();
  await expect(feed.locator(".slide")).toHaveCount(narrowed);
});

test("Search: submitting an empty query is what restores the full feed", async ({
  page,
}) => {
  // Membership, not a slide count: every render begins at a new random
  // offset, so two renders of the unfiltered feed differ in length without
  // anything being wrong.
  const feed = await gotoFeed(page);
  await search(page, "portrait");
  const filtered = await feed.locator(".slide[data-slug]").count();
  expect(filtered).toBeGreaterThan(0);

  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("");
  await actAndSettle(page, () => page.locator("#searchSubmit").click());

  const categories = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  expect(categories.length).toBeGreaterThan(1);
  await expect(page.locator("#filterBanner")).toBeHidden();
});

test("Search: the chips row yields to the banner, and comes back", async ({
  page,
}) => {
  // The banner and the chips are alternatives, not neighbours -- the
  // banner moved inside the topbar, into the slot the chips vacate, so the
  // header keeps its height with no layout jump on searching. What's still
  // worth pinning: no dead space between the header and the feed. Pinned to
  // a phone viewport since the topbar only stacks into two rows there.
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoFeed(page);
  const chips = page.locator("#chips");
  await expect(chips).toBeVisible();

  await search(page, "portrait");
  await expect(chips).toBeHidden();

  const banner = page.locator("#filterBanner");
  await expect(banner).toBeVisible();
  expect(
    await page.evaluate(
      () => !!document.querySelector(".topbar #filterBanner"),
    ),
  ).toBe(true);

  const dead = await page.evaluate(() => {
    const t = document.querySelector(".topbar")!.getBoundingClientRect();
    const frame = document.querySelector(".art-frame");
    if (!frame) return 0;
    return Math.round(frame.getBoundingClientRect().top - t.bottom);
  });
  expect(dead).toBeLessThanOrEqual(0);

  await page.locator("#filterBannerClear").click();
  await expect(chips).toBeVisible();
  await expect(banner).toBeHidden();
});

test("Search: the banner survives scrolling through the results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const feed = await gotoFeed(page);
  await search(page, "portrait");
  const label = await page.locator("#filterBannerLabel").textContent();

  await feed.evaluate((el) => {
    el.scrollTop = el.clientHeight * 3;
  });
  await page.waitForTimeout(400);
  await expect(page.locator("#filterBanner")).toBeVisible();
  expect(await page.locator("#filterBannerLabel").textContent()).toBe(label);
});

// Slide counts stopped being a proxy for "what the feed contains" once the
// feed was paged, since both numbers are then page-bounded and comparing
// them compares two arbitrary page sizes. What these assert instead: the
// chip narrows the feed to exactly one category, and All widens it again.
test("Filter: a category chip shows only that category", async ({ page }) => {
  const feed = await gotoFeed(page);

  // Skip "All"; take the first real category chip.
  const chip = page.locator("#chips button").nth(1);
  const label = (await chip.textContent())!.trim();
  await actAndSettle(page, () => chip.click());

  const categories = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  expect(categories).toEqual([label]);
  expect(await feed.locator(".slide").count()).toBeGreaterThan(0);
});

test("Filter: switching back to All restores every item", async ({ page }) => {
  const feed = await gotoFeed(page);
  const chip = page.locator("#chips button").nth(1);
  const label = (await chip.textContent())!.trim();

  await actAndSettle(page, () => chip.click());
  const filtered = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  expect(filtered).toEqual([label]);

  await actAndSettle(page, () => page.locator("#chips button").nth(0).click());
  const restored = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  // More than one category present is what "restored" means; the exact set
  // depends on the session's shuffle offset.
  expect(restored.length).toBeGreaterThan(1);
});

test("Filter: the recycling window still bounds a filtered feed", async ({
  page,
}) => {
  // A filtered view rebuilds slideRecords from scratch; if
  // resetRecycleWindow() were missed, the stale hydrated band would leak
  // across the re-render.
  const _feed = await gotoFeed(page);
  await actAndSettle(page, () => page.locator("#chips button").nth(1).click());
  // Waits for the window to have built something first, since it fills on
  // requestAnimationFrame after the render settles.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelectorAll("#feed .slide").length -
          document.querySelectorAll("#feed .slide:empty").length,
      ),
    )
    .toBeGreaterThan(0);
  const hydrated = await page.evaluate(
    () =>
      document.querySelectorAll("#feed .slide").length -
      document.querySelectorAll("#feed .slide:empty").length,
  );
  expect(hydrated).toBeLessThanOrEqual(12);
});
