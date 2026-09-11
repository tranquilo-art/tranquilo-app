// Save and Export. These two are grouped because export has no meaning
// without a collection, and because they are the only flows that touch
// data the visitor would be upset to lose.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, scrollToSlide } from "./harness.mts";

async function collectSlide(page: Page, index: number) {
  await scrollToSlide(page, index);
  const slide = page.locator("#feed .slide").nth(index);
  await slide.locator(".btn-collect").click();
  return slide.getAttribute("data-slug");
}

// Same pattern feed-depth.spec.mts uses: stubs **/api/track** so the suite
// never reports as real traffic, reading back what the page posted.
async function captureTrack(page: Page) {
  const posted: any[] = [];
  await page.route("**/api/track**", (route: Route) => {
    posted.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({ status: 204, body: "" });
  });
  return posted;
}

test("Save: collecting marks the item and survives a reload", async ({
  page,
}) => {
  await gotoFeed(page);
  const slide = page.locator("#feed .slide").nth(2);
  await scrollToSlide(page, 2);
  const slug = await slide.getAttribute("data-slug");

  const btn = slide.locator(".btn-collect");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");

  // Persistence is the point of Save; an in-memory toggle would pass this
  // and lose the collection on the next visit.
  const stored = await page.evaluate(
    () =>
      Object.keys(localStorage).filter((k) =>
        localStorage.getItem(k)?.includes("["),
      ).length,
  );
  expect(stored).toBeGreaterThan(0);

  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );

  // Located by slug, not index: a reload lands on /v/{slug}, which reorders
  // that item first, so index 2 is a different artwork than before.
  const after = page.locator(`#feed .slide[data-slug="${slug}"]`);
  await expect(after).toHaveCount(1);
  await after.scrollIntoViewIfNeeded();
  await expect(after.locator(".btn-collect")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Save: uncollecting removes it again", async ({ page }) => {
  await gotoFeed(page);
  await scrollToSlide(page, 2);
  const btn = page.locator("#feed .slide").nth(2).locator(".btn-collect");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
});

test("Save: the collection view shows exactly what was collected", async ({
  page,
}) => {
  await gotoFeed(page);
  const a = await collectSlide(page, 2);
  const b = await collectSlide(page, 4);

  await page.locator("#collectionToggle").click();
  await expect(page.locator("#feed .slide")).toHaveCount(2);
  const slugs = await page
    .locator("#feed .slide")
    .evaluateAll((els) => els.map((e) => e.dataset.slug));
  expect(slugs.sort()).toEqual([a, b].sort());
});

test("Save: opening My Collection reports collection_view_open with the current size", async ({
  page,
}) => {
  // Visit counts and average collection size both derive from this one
  // event's count prop, so the wiring itself needs proving.
  await gotoFeed(page);
  const posted = await captureTrack(page);
  await collectSlide(page, 2);
  await collectSlide(page, 4);

  await page.locator("#collectionToggle").click();

  const opens = posted.filter((p) => p.event_name === "collection_view_open");
  expect(opens.length).toBe(1);
  expect(opens[0].props.count).toBe(2);
});

test("Export: downloads a CSV of the collection", async ({ page }) => {
  await gotoFeed(page);
  await collectSlide(page, 2);
  await collectSlide(page, 4);
  await page.locator("#collectionToggle").click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#filterBannerExport").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^tranquilo-collection-\d{4}-\d{2}-\d{2}\.csv$/,
  );

  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("Title,Artist,Date,Category,Source,URL");
  expect(lines).toHaveLength(3); // header + the two collected items
  await expect(page.locator("#exportModal")).toBeVisible();
});

test("Export: an empty collection says so instead of downloading", async ({
  page,
}) => {
  await gotoFeed(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );
  await page.locator("#collectionToggle").click();
  await page.locator("#filterBannerExport").click();
  await expect(page.locator("#toast")).toContainText("Nothing collected yet");
});
