// `place_of_origin` used to have zero UI presence, only feeding
// classify_region()'s facet server-side. The rule: show what we have,
// suppress the row when we don't. js/app.js has no unit-test harness, so a
// real browser is the only way to verify what renders.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

// Based on a real fixture item so every other field stays realistic; only
// place_of_origin is the variable under test.
const BASE = ITEMS.find(
  (i: any) => i.source === "met" && i.artist_nationality && i.artist_lifespan,
);

function testItem(id: string, overrides: Record<string, unknown>) {
  return { ...BASE, id, ...overrides };
}

async function openDetailFor(page: Page, item: any) {
  // A couple of real fixture items alongside the custom one, so shuffle/
  // recycling has something ordinary to work with.
  await stubBackend(page, { items: [item, ...ITEMS.slice(0, 5)] });
  await page.goto(`/v/${encodeURIComponent(`${item.source}-${item.id}`)}`);
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(item.id)}"]`)
    .first();
  await slide.locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

const metaRow = (page: Page, label: string) =>
  page.locator("#detailModal .meta-row", { hasText: label });

test("shows Object origin when place_of_origin is present", async ({
  page,
}) => {
  const item = testItem("test-object-origin-present", {
    place_of_origin: "Netherlands",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Object origin")).toContainText("Netherlands");
});

test("omits the row entirely when place_of_origin is absent", async ({
  page,
}) => {
  const item = testItem("test-object-origin-absent", { place_of_origin: "" });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Object origin")).toHaveCount(0);
});

test("Artist origin and Object origin both show when both facts are true", async ({
  page,
}) => {
  // A French-nationality painter whose work is separately recorded as
  // English-made: two true facts about two subjects, shown as two rows
  // rather than picking a "winner".
  const item = testItem("test-object-origin-both", {
    artist_nationality: "French",
    artist_lifespan: "1550-1600",
    place_of_origin: "England",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Artist origin")).toContainText("French");
  await expect(metaRow(page, "Object origin")).toContainText("England");
});
