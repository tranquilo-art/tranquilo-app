// On desktop the category chips overflowed into unreachable space: .chips
// is `overflow-x:auto` with the scrollbar hidden, correct for a phone swipe
// but leaving desktop chips past the fold unreachable (and a drag-scroll
// attempt could activate one instead, since a drag ends as a click). The
// fix lets the row wrap on desktop. These tests measure reachability rather
// than asserting flex-wrap, since the bug is about what a user can click.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

async function chipGeometry(page: Page) {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll(".chips .chip")];
    const icons = [...document.querySelectorAll(".topbar-icons > button")];
    const firstIconX = icons.length
      ? Math.min(...icons.map((b) => b.getBoundingClientRect().x))
      : Infinity;
    return {
      count: chips.length,
      // A chip is reachable if its whole box is inside the viewport AND it is
      // not sitting underneath the icon cluster.
      unreachable: chips
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return r.right > window.innerWidth || r.right > firstIconX || r.x < 0;
        })
        .map((c) => c.textContent.trim()),
      overflowing: (() => {
        const row = document.querySelector(".chips")!;
        return row.scrollWidth - row.clientWidth > 2;
      })(),
    };
  });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every category chip is reachable", async ({ page }) => {
    await gotoFeed(page);
    const g = await chipGeometry(page);
    expect(g.count).toBeGreaterThan(4);
    expect(g.unreachable, "chips a mouse cannot reach").toEqual([]);
  });

  test("the row does not rely on hidden horizontal scrolling", async ({
    page,
  }) => {
    // Wrapping means scrollWidth == clientWidth.
    await gotoFeed(page);
    const g = await chipGeometry(page);
    expect(g.overflowing, "chips row still overflows its box").toBe(false);
  });
});

test.describe("narrow desktop", () => {
  test.use({ viewport: { width: 1024, height: 800 } });

  test("no chip is left in unreachable space", async ({ page }) => {
    // The overflow now collapses into a More menu, so anything still laid
    // out in the row must be genuinely clickable.
    await gotoFeed(page);
    const g = await chipGeometry(page);
    expect(g.unreachable, "chips a mouse cannot reach").toEqual([]);
  });

  test("the overflow is reachable through the More menu", async ({ page }) => {
    // A chip hidden in a menu nobody can open is no better than one past the fold.
    await gotoFeed(page);
    const more = page.locator("#chipsMore");
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator("#chipsMoreMenu")).toBeVisible();
    const hidden = await page.locator("#chipsMoreMenu .chip").count();
    expect(hidden).toBeGreaterThan(0);
  });

  test("the menu opens anchored under the More button", async ({ page }) => {
    // It was pinned to the topbar's right edge, opening under the icon
    // cluster instead of the button that summons it.
    await gotoFeed(page);
    await page.locator("#chipsMore").click();
    const box = await page.evaluate(() => {
      const b = document.querySelector("#chipsMore")!.getBoundingClientRect();
      const m = document
        .querySelector("#chipsMoreMenu")!
        .getBoundingClientRect();
      return {
        btnL: b.left,
        btnB: b.bottom,
        mL: m.left,
        mR: m.right,
        mT: m.top,
        vw: window.innerWidth,
      };
    });
    // Left edges roughly aligned, and the panel hangs just below the button.
    expect(Math.abs(box.mL - box.btnL)).toBeLessThan(24);
    expect(box.mT).toBeGreaterThanOrEqual(box.btnB - 2);
    expect(box.mT - box.btnB).toBeLessThan(24);
    // And never off the right edge of the screen.
    expect(box.mR).toBeLessThanOrEqual(box.vw);
  });

  test("menu items read as list rows, not buttons in a box", async ({
    page,
  }) => {
    // The panel already has its own border; a bordered pill inside it
    // duplicates the outline.
    await gotoFeed(page);
    await page.locator("#chipsMore").click();
    const style = await page.evaluate(() => {
      const inMenu = getComputedStyle(
        document.querySelector("#chipsMoreMenu .chip")!,
      );
      const inRow = getComputedStyle(document.querySelector(".chips > .chip")!);
      return {
        menuBorder: inMenu.borderTopColor,
        menuBg: inMenu.backgroundColor,
        rowBorder: inRow.borderTopColor,
      };
    });
    expect(style.menuBorder).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect(style.menuBg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // The row keeps its pill -- this is a menu-only treatment.
    expect(style.rowBorder).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  });

  test("every category is present exactly once, in the row or the menu", async ({
    page,
  }) => {
    // Guards against a chip falling out of both during a reflow, silently
    // removing a category from the site.
    await gotoFeed(page);
    await page.locator("#chipsMore").click();
    const labels = await page.evaluate(() => {
      const inRow = [...document.querySelectorAll(".chips > .chip")].map((c) =>
        c.textContent.trim(),
      );
      const inMenu = [...document.querySelectorAll("#chipsMoreMenu .chip")].map(
        (c) => c.textContent.trim(),
      );
      return { inRow, inMenu };
    });
    const all = [...labels.inRow, ...labels.inMenu];
    expect(new Set(all).size, "a chip appears twice").toBe(all.length);
    expect(all).toContain("All");
    expect(all).toContain("Architecture & Space");
  });

  test("choosing from the menu filters the feed and closes the menu", async ({
    page,
  }) => {
    await gotoFeed(page);
    await page.locator("#chipsMore").click();
    const first = page.locator("#chipsMoreMenu .chip").first();
    const label = (await first.textContent())!.trim();
    await first.click();
    await expect(page.locator("#chipsMoreMenu")).toBeHidden();
    // The chosen category becomes active and is promoted into the visible
    // row, so the active filter isn't buried inside a closed menu.
    const activeLabel = await page.evaluate(() =>
      document
        .querySelector(".chips .chip.active:not(.chip-more)")
        ?.textContent.trim(),
    );
    expect(activeLabel).toBe(label);
    await expect(page.locator("#chipsMoreMenu .chip.active")).toHaveCount(0);
  });

  test("resizing wider returns chips to the row instead of destroying them", async ({
    page,
  }) => {
    // reflowChips() runs on resize without renderChips(), so it can't clear
    // the menu by wiping innerHTML -- the chips there are the only copies.
    await gotoFeed(page);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll(".chips > .chip, #chipsMoreMenu .chip")]
        .map((c) => c.textContent.trim())
        .filter((t) => t !== "More")
        .sort(),
    );
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll(".chips > .chip, #chipsMoreMenu .chip")]
        .map((c) => c.textContent.trim())
        .filter((t) => t !== "More")
        .sort(),
    );
    expect(after, "categories lost on resize").toEqual(before);
  });

  test("shrinking to a phone width keeps every category too", async ({
    page,
  }) => {
    await gotoFeed(page);
    const before = await page.evaluate(() =>
      [...document.querySelectorAll(".chips > .chip, #chipsMoreMenu .chip")]
        .map((c) => c.textContent.trim())
        .filter((t) => t !== "More")
        .sort(),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll(".chips > .chip")]
        .map((c) => c.textContent.trim())
        .filter((t) => t !== "More")
        .sort(),
    );
    expect(after, "categories lost shrinking to mobile").toEqual(before);
  });

  test("the header stays one row tall", async ({ page }) => {
    // .art-frame clears the bar with static padding, so a growing header
    // destabilises the layout and can make a chip intercept artwork clicks.
    await gotoFeed(page);
    const h = await page.evaluate(() =>
      Math.round(
        document.querySelector(".topbar")!.getBoundingClientRect().height,
      ),
    );
    expect(h).toBeLessThan(110);
  });
});

test.describe("mobile keeps its swipe", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the chips row still scrolls horizontally on a phone", async ({
    page,
  }) => {
    // Deliberately the opposite assertion: wrapping on touch would eat
    // vertical space the artwork needs.
    await gotoFeed(page);
    const scrolls = await page.evaluate(() => {
      const row = document.querySelector(".chips")!;
      return getComputedStyle(row).overflowX === "auto";
    });
    expect(scrolls).toBe(true);
  });
});
