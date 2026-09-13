// originRows() in TranquiloDetailModal.ts labels the culture/culture_period
// pair "Object origin" only for Europeana items -- the same fields read
// "Origin" or "Culture" for every other source, depending on
// attribution_type. The rule under test: show what we have, suppress the
// row when we don't.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

// Based on a real fixture item so every other field stays realistic; only
// culture/culture_period is the variable under test. Must be a Europeana
// item for the "Object origin" label to apply.
const BASE = ITEMS.find((i: any) => i.source === "europeana");

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

test("shows Object origin when culture is present", async ({ page }) => {
  const item = testItem("test-object-origin-present", {
    culture: "Netherlands",
    culture_period: "",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Object origin")).toContainText("Netherlands");
});

test("omits the row entirely when culture is absent", async ({ page }) => {
  const item = testItem("test-object-origin-absent", {
    culture: "",
    culture_period: "",
  });
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
    culture: "England",
    culture_period: "",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Artist origin")).toContainText("French");
  await expect(metaRow(page, "Object origin")).toContainText("England");
});
