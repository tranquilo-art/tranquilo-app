// Sharing must never fail silently. Three bugs found here share one shape: a
// branch of shareItem() that ends without telling the visitor anything, so
// the button is indistinguishable from a dead one -- rejections swallowed
// as "user cancelled", AbortError swallowed, and navigator.share resolving
// on desktop without showing a usable sheet.
//
// Sheet tests live in a touch context because shareItem() decides by
// capability before calling (a fine pointer skips the sheet for the
// clipboard), and Playwright's default context reports pointer:fine -- a
// test stubbing navigator.share there silently exercises the clipboard
// path instead, green and testing nothing. When the desktop fix landed,
// four tests here kept passing without touching a line of sheet logic.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

declare global {
  interface Window {
    __shared?: () => void;
    __toasted?: (t: string) => void;
    __sheetOpened?: () => void;
  }
}

async function openDetail(page: Page) {
  await scrollToSlide(page, 3);
  await page.locator("#feed .slide").nth(3).locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

// ---------------------------------------------------------------------------
// The native share sheet -- a touch affordance, tested where it exists.
// ---------------------------------------------------------------------------
test.describe("the native share sheet, on a touch device", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("is used at all, which is the whole point of it here", async ({
    page,
  }) => {
    // Regression guard: routing fine-pointer devices to the clipboard must
    // not take the OS sheet away from phones, where it's the feature.
    let shared = false;
    await page.exposeFunction("__shared", () => {
      shared = true;
    });
    await page.addInitScript(() => {
      navigator.share = () => {
        window.__shared!();
        return Promise.resolve();
      };
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").tap();
    await expect.poll(() => shared).toBe(true);
  });

  test("falls back to the clipboard when the sheet fails", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      navigator.share = () =>
        Promise.reject(
          Object.assign(new Error("no share targets"), {
            name: "NotAllowedError",
          }),
        );
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").tap();

    await expect(page.locator("#toast")).toContainText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/v\//);
  });

  test("stays silent when the user actually cancels it", async ({ page }) => {
    // AbortError can genuinely mean "no thanks"; toasting there would nag.
    // The delay is deliberate: a real cancellation costs human time (sheet
    // animates in, then a person decides), whereas an earlier version
    // rejected instantly and still asserted silence, letting this
    // regression survive it. Asserts on the toast's text staying empty
    // rather than its class, since a class check timed after auto-hide
    // passes even when a toast did appear.
    await page.addInitScript(() => {
      navigator.share = () =>
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(new Error("cancelled"), { name: "AbortError" }),
              ),
            900,
          ),
        );
    });
    await gotoFeed(page);
    await openDetail(page);

    let toastedWith: string | null = null;
    await page.exposeFunction("__toasted", (t: string) => {
      toastedWith = t;
    });
    await page.evaluate(() => {
      const el = document.getElementById("toast")!;
      new MutationObserver(() => {
        if (el.classList.contains("show"))
          window.__toasted!(el.textContent || "");
      }).observe(el, { attributes: true, attributeFilter: ["class"] });
    });

    await page.locator("#detailModal .btn-share").tap();
    await page.waitForTimeout(1600);
    expect(toastedWith).toBe(null);
  });

  test("falls back when AbortError arrives too fast for a sheet to have opened", async ({
    page,
    context,
  }) => {
    // A browser can expose navigator.share and then reject with AbortError
    // because no share target exists or the sheet can't open -- the same
    // name as a genuine cancel. The name can't separate the two cases; time
    // can, since nobody dismisses a sheet in single-digit milliseconds.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      navigator.share = () =>
        Promise.reject(
          Object.assign(new Error("no target"), { name: "AbortError" }),
        );
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").tap();

    await expect(page.locator("#toast")).toContainText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/v\//);
  });

  test("copies directly when there is no sheet at all", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      delete (navigator as any).share;
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").tap();
    await expect(page.locator("#toast")).toContainText("Link copied");
  });
});

// Desktop: no detail-page share link worked, while mobile was fine. Every
// branch of shareItem() ends in a toast except one -- navigator.share()
// resolving, silent by design since a phone's OS sheet is the feedback.
// Desktop browsers expose navigator.share and resolve it without showing a
// usable sheet, so no rejection handling can reach that; decide by
// capability before calling instead.
test.describe("on a pointer device", () => {
  test.use({ hasTouch: false, isMobile: false });

  test("copies the link even when navigator.share exists and resolves", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    let sheetOpened = false;
    await page.exposeFunction("__sheetOpened", () => {
      sheetOpened = true;
    });
    await page.addInitScript(() => {
      navigator.share = () => {
        window.__sheetOpened!();
        return Promise.resolve();
      };
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").click();

    await expect(page.locator("#toast")).toContainText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/v\//);
    expect(sheetOpened).toBe(false); // never even attempted
  });

  test("still copies if navigator.share throws synchronously", async ({
    page,
    context,
  }) => {
    // navigator.share can throw a TypeError before returning a promise, so
    // there's nothing to .catch and the exception escapes the click handler.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      navigator.share = () => {
        throw new TypeError("bad share data");
      };
    });
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").click();
    await expect(page.locator("#toast")).toContainText("Link copied");
  });

  test("the feed slide's share button behaves the same way", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoFeed(page);
    await scrollToSlide(page, 3);
    await page.locator("#feed .slide").nth(3).locator(".btn-share").click();
    await expect(page.locator("#toast")).toContainText("Link copied");
  });

  test("a storyline item shares exactly like any other", async ({
    page,
    context,
  }) => {
    // First noticed on storyline artworks, but the cause was the desktop
    // navigator.share() issue above, hitting every desktop detail page.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const slugs: string[] = ITEMS.filter(
      (i: any) => i.storyline_ids?.length,
    ).map((i: any) => `${i.source || "met"}-${i.id}`);
    expect(slugs.length).toBeGreaterThan(0);

    await gotoFeed(page);
    const idx = await page.evaluate((want: string[]) => {
      const all = [...document.querySelectorAll("#feed .slide")];
      return all.findIndex((s) => want.includes(s.getAttribute("data-slug")!));
    }, slugs);
    expect(idx).toBeGreaterThan(-1);

    await scrollToSlide(page, idx);
    await page
      .locator("#feed .slide")
      .nth(idx)
      .locator(".art-title-btn")
      .click();
    await expect(page.locator("#detailModal")).toHaveClass(/open/);
    await expect(page.locator("#detailModal .storyline-chip")).toBeVisible();

    await page.locator("#detailModal .btn-share").click();
    await expect(page.locator("#toast")).toContainText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/\/v\//);
  });
});

// The toast has to be on top of whatever triggered it. Sharing from a
// detail page put the link on the clipboard but showed no confirmation --
// the toast was painted behind the modal (.toast z-index 150 vs
// .detail-modal 200). Mobile hid it since a phone gets the native sheet
// instead. `toContainText("Link copied")` passes on an invisible element,
// and .toast's pointer-events:none defeats elementFromPoint too, so this
// asserts stacking order directly.
test.describe("toast visibility over overlays", () => {
  const OVERLAY_SELECTORS = [
    ".detail-modal",
    ".lightbox",
    ".storyline-mode",
    ".support-dialog",
    ".export-modal",
  ].join(", ");

  async function stacking(page: Page) {
    return page.evaluate((sel: string) => {
      const zOf = (el: Element) => {
        const z = parseInt(getComputedStyle(el).zIndex, 10);
        return Number.isFinite(z) ? z : 0;
      };
      const toast = document.getElementById("toast")!;
      const overlays = [...document.querySelectorAll(sel)]
        .filter((el) => {
          const s = getComputedStyle(el);
          return (
            s.display !== "none" &&
            s.visibility !== "hidden" &&
            parseFloat(s.opacity) > 0
          );
        })
        .map((el) => ({ cls: el.className, z: zOf(el) }));
      return { toastZ: zOf(toast), overlays };
    }, OVERLAY_SELECTORS);
  }

  test("a toast raised from the detail panel sits above it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator("#detailModal .btn-share").click();
    await expect(page.locator("#toast")).toHaveClass(/show/);

    const { toastZ, overlays } = await stacking(page);
    expect(overlays.length).toBeGreaterThan(0); // the modal really is open
    for (const o of overlays) {
      expect(
        toastZ,
        `toast (${toastZ}) must sit above ${o.cls} (${o.z})`,
      ).toBeGreaterThan(o.z);
    }
  });

  test("its z-index clears every full-screen overlay in the app", async ({
    page,
  }) => {
    // The toast is a single shared element raised from many places, so it
    // must outrank all of them, not just the one that happens to be open.
    await gotoFeed(page);
    const declared = await page.evaluate(() => {
      const zs = [];
      for (const sheet of document.styleSheets) {
        let rules: any;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of rules) {
          if (!r.selectorText || !r.style) continue;
          const z = parseInt(r.style.zIndex, 10);
          if (!Number.isFinite(z)) continue;
          zs.push({ selector: r.selectorText, z });
        }
      }
      return zs;
    });
    const toastZ = Math.max(
      ...declared.filter((r) => /^\.toast\b/.test(r.selector)).map((r) => r.z),
    );
    const overlays = declared.filter((r) =>
      /\.(detail-modal|lightbox|storyline-mode|support-dialog|export-modal)\b/.test(
        r.selector,
      ),
    );
    expect(overlays.length).toBeGreaterThan(0);
    for (const o of overlays) {
      expect(
        toastZ,
        `toast (${toastZ}) must outrank ${o.selector} (${o.z})`,
      ).toBeGreaterThan(o.z);
    }
  });
});
