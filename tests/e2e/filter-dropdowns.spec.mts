// The Palette filter is a button + popover listbox, not a native
// <select> -- a native select can't render an embedded colored swatch
// inside its own options. Category stays a native <select>
// (tests/e2e/chips-reachable.spec.mts covers it).
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, stubBackend } from "./harness.mts";

// The default fixture carries no palette_buckets, so the Palette dropdown
// would have no options; these tests need at least one item with a bucket.
const RED_ITEM = {
  ...ITEMS[0],
  id: "filter-dropdown-e2e-1",
  palette_buckets: ["Red"],
};

async function gotoFeedWithPalette(page: Page) {
  await stubBackend(page, { items: [RED_ITEM, ...ITEMS.slice(1)] });
  await page.addInitScript(() => {
    if (typeof window.__tranquiloHeroSeed !== "number")
      window.__tranquiloHeroSeed = 1;
  });
  await page.goto("/index.html");
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
}

test("the Palette dropdown lists every bucket, each colored", async ({
  page,
}) => {
  await gotoFeedWithPalette(page);
  const trigger = page.locator("#paletteSelect .filter-dropdown-trigger");
  await trigger.click();

  const menu = page.locator("#paletteSelect .filter-dropdown-menu");
  await expect(menu).toBeVisible();

  // Every real option (not "All palettes") carries its own swatch color --
  // not every option resolving to the same default/transparent dot.
  const swatchColors = await menu
    .locator(
      '.filter-dropdown-option:not([data-value=""]) .filter-dropdown-swatch',
    )
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.backgroundColor),
    );
  expect(swatchColors.length).toBeGreaterThan(0);
  expect(swatchColors.every((c) => c && c !== "transparent")).toBe(true);
});

test("selecting a Palette option closes the menu and applies the filter", async ({
  page,
}) => {
  await gotoFeedWithPalette(page);
  await page.locator("#paletteSelect .filter-dropdown-trigger").click();
  const menu = page.locator("#paletteSelect .filter-dropdown-menu");
  await expect(menu).toBeVisible();

  const option = menu
    .locator('.filter-dropdown-option:not([data-value=""])')
    .first();
  const label = await option.textContent();

  const before = await page.evaluate(() => window.__tranquiloFeedRenders || 0);
  await option.click();
  await page.waitForFunction(
    (n) => (window.__tranquiloFeedRenders || 0) > n,
    before,
  );

  await expect(menu).toBeHidden();
  const trigger = page.locator("#paletteSelect .filter-dropdown-trigger");
  if (label) await expect(trigger).toContainText(label.trim());
  await expect(trigger).toHaveClass(/filter-select-active/);
});

test("clicking outside closes an open dropdown menu", async ({ page }) => {
  await gotoFeed(page);
  await page.locator("#paletteSelect .filter-dropdown-trigger").click();
  await expect(
    page.locator("#paletteSelect .filter-dropdown-menu"),
  ).toBeVisible();

  await page.mouse.click(10, 10);
  await expect(
    page.locator("#paletteSelect .filter-dropdown-menu"),
  ).toBeHidden();
});

test("Escape closes an open dropdown menu", async ({ page }) => {
  await gotoFeed(page);
  await page.locator("#paletteSelect .filter-dropdown-trigger").click();
  await expect(
    page.locator("#paletteSelect .filter-dropdown-menu"),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.locator("#paletteSelect .filter-dropdown-menu"),
  ).toBeHidden();
});
