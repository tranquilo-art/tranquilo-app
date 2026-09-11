// Same pattern as object-origin.spec.mts: `photograph_date` only has UI
// meaning through this row, and TranquiloDetailModal.ts's template string
// has no unit-test harness, so a real browser is the only way to verify it.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

const BASE = ITEMS.find(
  (i: any) => i.source === "met" && i.artist_nationality && i.artist_lifespan,
);

function testItem(id: string, overrides: Record<string, unknown>) {
  return { ...BASE, id, ...overrides };
}

async function openDetailFor(page: Page, item: any) {
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

test("shows Date of photograph when photograph_date is present", async ({
  page,
}) => {
  const item = testItem("test-photograph-date-present", {
    date: "",
    photograph_date: "2006-01-01/2006-01-01",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Date of photograph")).toContainText(
    "2006-01-01/2006-01-01",
  );
});

test("omits the row entirely when photograph_date is absent", async ({
  page,
}) => {
  const item = testItem("test-photograph-date-absent", { photograph_date: "" });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Date of photograph")).toHaveCount(0);
});
