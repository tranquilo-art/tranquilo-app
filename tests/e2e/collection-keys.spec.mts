// Collections key on source:native_id, and legacy bare ids migrate. This is
// the only user-created data in the product, so a bug here loses something
// a person made with no way for them to tell it happened.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

const COLLECTION_KEY = "tranquilo:collection";

async function readCollection(page: Page) {
  return page.evaluate(
    (k: string) => JSON.parse(localStorage.getItem(k) || "[]"),
    COLLECTION_KEY,
  );
}

async function seedCollection(page: Page, entries: unknown) {
  await page.addInitScript(
    ([k, v]: [string, unknown]) => {
      localStorage.setItem(k, JSON.stringify(v));
    },
    [COLLECTION_KEY, entries] as [string, unknown],
  );
}

test("new saves are keyed source:native_id", async ({ page }) => {
  await gotoFeed(page);
  await scrollToSlide(page, 3);
  const slide = page.locator("#feed .slide").nth(3);
  const slug = await slide.getAttribute("data-slug");
  await slide.locator(".btn-collect").click();

  const stored = await readCollection(page);
  expect(stored).toHaveLength(1);
  // Same identity as the slug, different separator: matches dedupe_key()
  // and the Postgres primary key.
  const [source] = slug!.split("-");
  expect(stored[0].startsWith(`${source}:`)).toBe(true);
});

test("a legacy bare id is migrated to a source-qualified key", async ({
  page,
}) => {
  const item = ITEMS.find((i: any) => i.source !== "commons");
  await seedCollection(page, [String(item.id)]);
  await gotoFeed(page);

  await expect
    .poll(() => readCollection(page))
    .toEqual([`${item.source}:${item.id}`]);
});

test("a legacy Commons id migrates despite already containing a colon", async ({
  page,
}) => {
  // Commons native_ids are colon-bearing ("File:A Colorful Spring.jpg"), so
  // detecting migration by "does it contain a colon" would misclassify every
  // legacy Commons save as already done. The prefix must be checked against
  // the known source list instead.
  const item = ITEMS.find(
    (i: any) => i.source === "commons" && String(i.id).includes(":"),
  );
  test.skip(!item, "no colon-bearing Commons id in the fixture");

  await seedCollection(page, [String(item.id)]);
  await gotoFeed(page);
  await expect.poll(() => readCollection(page)).toEqual([`commons:${item.id}`]);
});

test("an already-migrated key is left alone", async ({ page }) => {
  const item = ITEMS[5];
  const key = `${item.source}:${item.id}`;
  await seedCollection(page, [key]);
  await gotoFeed(page);
  await page.waitForTimeout(500);
  expect(await readCollection(page)).toEqual([key]);
});

test("an unresolvable legacy entry is preserved, not dropped", async ({
  page,
}) => {
  // A rejected item has no catalogue row to supply a source; discarding it
  // would silently delete something the visitor saved.
  await seedCollection(page, ["not-a-real-id-12345"]);
  await gotoFeed(page);
  await page.waitForTimeout(500);
  expect(await readCollection(page)).toEqual(["not-a-real-id-12345"]);
});

test("a legacy save still reads as collected and can be un-collected", async ({
  page,
}) => {
  // A browser on a stale bundle, or an entry migration couldn't resolve,
  // must still behave correctly.
  await gotoFeed(page);
  await scrollToSlide(page, 3);
  const slide = page.locator("#feed .slide").nth(3);
  const slug = await slide.getAttribute("data-slug");
  const bareId = slug!.split("-").slice(1).join("-");

  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, JSON.stringify([v])),
    [COLLECTION_KEY, bareId],
  );
  await page.locator("#chips button").nth(1).click();
  await page.locator("#chips button").nth(0).click();

  const target = page.locator(`#feed .slide[data-slug="${slug}"]`);
  await target.scrollIntoViewIfNeeded();
  await expect(target.locator(".btn-collect")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await target.locator(".btn-collect").click();
  await expect(target.locator(".btn-collect")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await readCollection(page)).toEqual([]);
});

test("export resolves migrated keys and names every source", async ({
  page,
}) => {
  await gotoFeed(page);
  for (const i of [2, 4]) {
    await scrollToSlide(page, i);
    await page.locator("#feed .slide").nth(i).locator(".btn-collect").click();
  }
  await page.locator("#collectionToggle").click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#filterBannerExport").click(),
  ]);
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  const lines = csv.trim().split("\n");

  // A short CSV is the worst failure: the visitor has no way to notice rows
  // are missing.
  expect(lines).toHaveLength(3);
  // No row should carry a bare source slug where an institution name belongs.
  for (const line of lines.slice(1)) {
    expect(line).not.toMatch(/,(commons|europeana|met|smithsonian|cleveland),/);
  }
});
