// A Storyline chip, so storyline art can be looked for rather than
// stumbled upon. Usage data (category_filter: 238 events vs search_submit's
// 37) shows filtering is the primary navigation method in this UI, not a
// power-user fallback. The predicate runs client-side safely only because
// storyline_ids is already in the manifest, and it applies after the
// existing filter chain so it ANDs with whatever is already active.
import { expect, test } from "@playwright/test";
import { actAndSettle, gotoFeed, ITEMS } from "./harness.mts";

const STORYLINE_CHIP = "#storylineChip";

function taggedInFixture() {
  return ITEMS.filter(
    (i: any) => i.storyline_ids && i.storyline_ids.length > 0,
  );
}

test("the fixture actually has storyline items to filter to", async () => {
  // Every assertion below is vacuous if the fixture carries no tagged items.
  expect(taggedInFixture().length).toBeGreaterThan(0);
});

test("the chip narrows the feed to items that have a storyline", async ({
  page,
}) => {
  const feed = await gotoFeed(page);
  const all = await feed.locator(".slide").count();

  // renderFeed() is asynchronous, so the click must be awaited to
  // completion, or reading straight after races the fetch.
  await actAndSettle(page, () => page.locator(STORYLINE_CHIP).click());

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
  await actAndSettle(page, () => page.locator(STORYLINE_CHIP).click());

  const slugs = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  const tagged = new Set(
    taggedInFixture().map((i: any) => `${i.source || "met"}-${i.id}`),
  );
  for (const slug of slugs) expect(tagged.has(slug)).toBe(true);
});

test("toggling it off restores the whole feed", async ({ page }) => {
  // Asserts membership rather than a slide count, since each paged render
  // begins at a new random offset and two renders legitimately differ in
  // length.
  const feed = await gotoFeed(page);
  const tagged = new Set(
    taggedInFixture().map((i: any) => `${i.source || "met"}-${i.id}`),
  );

  await actAndSettle(page, () => page.locator(STORYLINE_CHIP).click());
  const filtered = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  expect(filtered.length).toBeGreaterThan(0);
  for (const slug of filtered) expect(tagged.has(slug)).toBe(true);

  await actAndSettle(page, () => page.locator(STORYLINE_CHIP).click());
  const restored = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  expect(restored.some((slug) => !tagged.has(slug))).toBe(true);
});

test("it ANDs with a category rather than replacing it", async ({ page }) => {
  const feed = await gotoFeed(page);

  const category = taggedInFixture()[0].category;
  const chip = page.locator("#chips button", { hasText: category }).first();
  await actAndSettle(page, () => chip.click());
  const inCategory = await feed.locator(".slide").count();

  await actAndSettle(page, () => page.locator(STORYLINE_CHIP).click());
  const both = await feed.locator(".slide").count();

  expect(both).toBeGreaterThan(0);
  expect(both).toBeLessThanOrEqual(inCategory);

  const categories = await feed
    .locator(".slide[data-category]")
    .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
  expect(categories).toEqual([category]);
});

test("the chip reads as active when it is on", async ({ page }) => {
  const _feed = await gotoFeed(page);
  const chip = page.locator(STORYLINE_CHIP);
  await expect(chip).not.toHaveClass(/active/);
  await chip.click();
  await expect(chip).toHaveClass(/active/);
  await chip.click();
  await expect(chip).not.toHaveClass(/active/);
});

test("it uses the same word as the item-level chip", async ({ page }) => {
  // Singular, deliberately: "Storyline" is what the item-level chip already says.
  await gotoFeed(page);
  await expect(page.locator(STORYLINE_CHIP)).toHaveText(/^Storyline$/);
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

  await page.locator(STORYLINE_CHIP).click();

  await expect
    .poll(
      () =>
        posted.filter((p) => p.event_name === "storyline_filter_toggle").length,
    )
    .toBe(1);
  const event = posted.find((p) => p.event_name === "storyline_filter_toggle");
  expect(event.props.on).toBe(true);
});
