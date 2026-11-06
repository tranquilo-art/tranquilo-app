// The "Has storyline" filter, so storyline art can be looked for rather
// than stumbled upon. Lives inside the search panel now, not a topbar
// chip -- the chips row and the filter banner are alternatives, never
// both visible at once, so a chip there disappeared (with no way to
// toggle it) the moment any search or concept was active, exactly the
// combination this filter exists for. The predicate runs client-side
// safely only because storyline_ids is already in the manifest, and it
// applies after the existing filter chain so it ANDs with whatever is
// already active.
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { actAndSettle, gotoFeed, ITEMS } from "./harness.mts";

const STORYLINE_CHECKBOX = "#storylineFilterCheckbox";

interface FixtureItem {
  id: string | number;
  source?: string;
  artist: string;
  category: string;
  storyline_ids?: unknown[] | null;
}

function taggedInFixture(): FixtureItem[] {
  return ITEMS.filter(
    (i: FixtureItem) => i.storyline_ids && i.storyline_ids.length > 0,
  );
}

async function openSearchPanel(page: Page) {
  await page.locator("#searchToggle").click();
  await expect(page.locator("#searchBar")).toBeVisible();
}

test("the fixture actually has storyline items to filter to", async () => {
  // Every assertion below is vacuous if the fixture carries no tagged items.
  expect(taggedInFixture().length).toBeGreaterThan(0);
});

test("checking it narrows the feed to items that have a storyline, with no query typed", async ({
  page,
}) => {
  const feed = await gotoFeed(page);
  const all = await feed.locator(".slide").count();
  await openSearchPanel(page);

  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());

  // data-slug counts real item slides; `.slide` also matches the intro slide.
  const after = await feed.locator(".slide[data-slug]").count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(all);
  expect(after).toBe(taggedInFixture().length);
});

test("every slide left really carries a storyline", async ({ page }) => {
  // Counting isn't enough: the right number of the wrong items would pass
  // the test above.
  const feed = await gotoFeed(page);
  await openSearchPanel(page);
  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());

  const slugs = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  const tagged = new Set<string | undefined>(
    taggedInFixture().map((i) => `${i.source || "met"}-${i.id}`),
  );
  for (const slug of slugs) expect(tagged.has(slug)).toBe(true);
});

test("unchecking it restores the whole feed", async ({ page }) => {
  // Asserts membership rather than a slide count, since each paged render
  // begins at a new random offset and two renders legitimately differ in
  // length.
  const feed = await gotoFeed(page);
  const tagged = new Set<string | undefined>(
    taggedInFixture().map((i) => `${i.source || "met"}-${i.id}`),
  );
  await openSearchPanel(page);

  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());
  const filtered = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  expect(filtered.length).toBeGreaterThan(0);
  for (const slug of filtered) expect(tagged.has(slug)).toBe(true);

  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).uncheck());
  const restored = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  expect(restored.some((slug) => !tagged.has(slug))).toBe(true);
});

test("it ANDs with a category rather than replacing it", async ({ page }) => {
  const feed = await gotoFeed(page);

  const category = taggedInFixture()[0].category;
  await actAndSettle(page, async () => {
    await page.locator("#categorySelect").selectOption(category);
  });
  const inCategory = await feed.locator(".slide").count();

  await openSearchPanel(page);
  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());
  const both = await feed.locator(".slide").count();

  expect(both).toBeGreaterThan(0);
  expect(both).toBeLessThanOrEqual(inCategory);

  const categories = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  expect(categories).toEqual([category]);
});

test("it also ANDs with a live search, unlike the old topbar chip it replaced", async ({
  page,
}) => {
  // The whole reason this moved into the search panel: a topbar chip
  // living in the same row as the category chips vanished (with no way
  // to toggle it) the moment a search/concept made the filter banner
  // take over from the chips row -- this combination was previously
  // unreachable through the UI at all.
  const feed = await gotoFeed(page);
  const term = ITEMS.find((i: FixtureItem) => i.artist && i.artist.length > 4)
    .artist.split(" ")
    .pop();

  await openSearchPanel(page);
  await page.locator("#searchInput").fill(term);
  await actAndSettle(page, () => page.locator("#searchSubmit").click());

  await openSearchPanel(page);
  await expect(page.locator(STORYLINE_CHECKBOX)).toBeVisible();
  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());

  const slugs = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  const tagged = new Set<string | undefined>(
    taggedInFixture().map((i) => `${i.source || "met"}-${i.id}`),
  );
  for (const slug of slugs) expect(tagged.has(slug)).toBe(true);
});

test("it reads as checked when it is on", async ({ page }) => {
  await gotoFeed(page);
  await openSearchPanel(page);
  const checkbox = page.locator(STORYLINE_CHECKBOX);
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
});

test("stays in sync with reality even after the panel is closed and reopened", async ({
  page,
}) => {
  await gotoFeed(page);
  await openSearchPanel(page);
  await actAndSettle(page, () => page.locator(STORYLINE_CHECKBOX).check());

  await page.locator("#searchClose").click();
  await expect(page.locator("#searchBar")).toBeHidden();

  await openSearchPanel(page);
  await expect(page.locator(STORYLINE_CHECKBOX)).toBeChecked();
});

test("toggling it reports one analytics event", async ({ page }) => {
  const posted: any[] = [];
  await gotoFeed(page);
  // Registered after gotoFeed so this route wins over the harness's own
  // **/api/track** stub, which keeps the suite from reporting real traffic.
  await page.route("**/api/track**", (route) => {
    posted.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ status: 204, body: "" });
  });

  await openSearchPanel(page);
  await page.locator(STORYLINE_CHECKBOX).check();

  await expect
    .poll(
      () =>
        posted.filter((p) => p.event_name === "storyline_filter_toggle").length,
    )
    .toBe(1);
  const event = posted.find((p) => p.event_name === "storyline_filter_toggle");
  expect(event.props.on).toBe(true);
});
