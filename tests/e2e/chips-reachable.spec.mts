// Both filter dropdowns stay inside the viewport and clear of the icon cluster.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS } from "./harness.mts";

async function filterGeometry(page: Page) {
  return page.evaluate(() => {
    const selects = [...document.querySelectorAll(".chips .filter-select")];
    const icons = [...document.querySelectorAll(".topbar-icons > button")];
    const firstIconX = icons.length
      ? Math.min(...icons.map((b) => b.getBoundingClientRect().x))
      : Infinity;
    return {
      count: selects.length,
      // A dropdown is reachable if its whole box is inside the viewport
      // AND it is not sitting underneath the icon cluster.
      unreachable: selects
        .filter((s) => {
          const r = s.getBoundingClientRect();
          return r.right > window.innerWidth || r.right > firstIconX || r.x < 0;
        })
        .map((s) => (s as HTMLSelectElement).id),
      overflowing: (() => {
        const row = document.querySelector(".chips")!;
        return row.scrollWidth - row.clientWidth > 2;
      })(),
    };
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("both filter dropdowns are present and reachable", async ({ page }) => {
    await gotoFeed(page);
    const g = await filterGeometry(page);
    expect(g.count).toBe(2);
    expect(g.unreachable, "dropdowns a mouse cannot reach").toEqual([]);
  });

  test("the row does not rely on hidden horizontal scrolling", async ({
    page,
  }) => {
    // Wrapping/fitting means scrollWidth == clientWidth.
    await gotoFeed(page);
    const g = await filterGeometry(page);
    expect(g.overflowing, "filter row still overflows its box").toBe(false);
  });

  test("the header stays one row tall", async ({ page }) => {
    // .art-frame clears the bar with static padding, so a growing header
    // destabilises the layout and can make a control intercept artwork
    // clicks.
    await gotoFeed(page);
    const h = await page.evaluate(() =>
      Math.round(
        document.querySelector(".topbar")!.getBoundingClientRect().height,
      ),
    );
    expect(h).toBeLessThan(110);
  });
});

test.describe("narrow desktop", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("both dropdowns stay reachable at a narrower desktop width too", async ({
    page,
  }) => {
    // The original bug reproduced specifically in this range -- a chip
    // row long enough to need an overflow menu, but not so long a phone
    // layout (with its own swipeable row) kicked in instead.
    await gotoFeed(page);
    const g = await filterGeometry(page);
    expect(g.count).toBe(2);
    expect(g.unreachable, "dropdowns a mouse cannot reach").toEqual([]);
  });

  test("every real category is an option in the Category dropdown", async ({
    page,
  }) => {
    await gotoFeed(page);
    const values = await page.evaluate(() =>
      [...document.querySelectorAll("#categorySelect option")].map(
        (o) => (o as HTMLOptionElement).value,
      ),
    );
    const categories = new Set<string>(
      ITEMS.map((i: { category: string }) => i.category),
    );
    expect(values).toContain("All");
    for (const category of categories) expect(values).toContain(category);
  });

  test("choosing a category from the dropdown filters the feed", async ({
    page,
  }) => {
    const feed = await gotoFeed(page);
    const select = page.locator("#categorySelect");
    const options = await select.locator("option").allTextContents();
    const label = options.find((o) => o !== "All Categories")!;

    const before = await feed.evaluate(
      () => window.__tranquiloFeedRenders || 0,
    );
    await select.selectOption({ label });
    await page.waitForFunction(
      (n) => (window.__tranquiloFeedRenders || 0) > n,
      before,
    );

    const categories = await feed
      .locator(".slide[data-category]")
      .evaluateAll((els) => [...new Set(els.map((e) => e.dataset.category))]);
    expect(categories).toEqual([label]);
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("both dropdowns render and stay within the viewport on a phone", async ({
    page,
  }) => {
    // Mobile keeps the topbar's original two-row layout (wordmark+icons,
    // then the filter row on its own line below) -- filterGeometry()'s
    // icon-cluster-collision check assumes the single desktop row both
    // share, so only the viewport-bounds half of it applies here.
    await gotoFeed(page);
    const { rects, innerWidth } = await page.evaluate(() => ({
      rects: [...document.querySelectorAll(".chips .filter-select")].map((s) =>
        s.getBoundingClientRect().toJSON(),
      ),
      innerWidth: window.innerWidth,
    }));
    expect(rects).toHaveLength(2);
    for (const r of rects) {
      expect(r.right, "a dropdown runs off the right edge").toBeLessThanOrEqual(
        innerWidth,
      );
      expect(r.x, "a dropdown runs off the left edge").toBeGreaterThanOrEqual(
        0,
      );
    }
  });
});
