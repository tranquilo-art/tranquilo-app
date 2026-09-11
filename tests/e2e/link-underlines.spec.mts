// No link is ever underlined twice. `.detail-modal-inner a` underlines every
// panel link via border-bottom; any rule styling a link with text-decoration:
// underline must cancel that border or render two stacked lines -- found
// three times by eye already (AI-disclosure email, licence deed link).
// Walks every rendered link rather than the two known cases, since the next
// component to add one will get it wrong the same way. The underline can sit
// on the anchor or a child (.source-link puts it on .link-text so the arrow
// stays plain), so the whole anchor subtree counts as one link.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

function underlineSources() {
  return [...document.querySelectorAll("#detailModal a, #lightbox a")].map(
    (a) => {
      const s = getComputedStyle(a);
      const fromBorder =
        parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== "none";
      const fromSelf = s.textDecorationLine.includes("underline");
      const fromChild = [...a.querySelectorAll("*")].some((k) =>
        getComputedStyle(k).textDecorationLine.includes("underline"),
      );
      return {
        cls: a.className || "(unclassed)",
        text: (a.textContent || "").trim().slice(0, 40),
        count: [fromBorder, fromSelf || fromChild].filter(Boolean).length,
      };
    },
  );
}

async function openDetailOn(page: Page, predicate: (i: any) => boolean) {
  const slugs: string[] = ITEMS.filter(predicate).map(
    (i: any) => `${i.source || "met"}-${i.id}`,
  );
  const idx = await page.evaluate((want: string[]) => {
    const all = [...document.querySelectorAll("#feed .slide")];
    return all.findIndex((s) => want.includes(s.getAttribute("data-slug")!));
  }, slugs);
  const at = idx < 0 ? 3 : idx;
  await scrollToSlide(page, at);
  await page.locator("#feed .slide").nth(at).locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

test("no link in the detail panel is underlined twice", async ({ page }) => {
  await gotoFeed(page);
  await openDetailOn(page, (i) => i.license && i.caption_tea);
  const links = await page.evaluate(underlineSources);
  expect(links.length).toBeGreaterThan(0); // a vacuous pass is not a pass
  expect(links.filter((l) => l.count > 1)).toEqual([]);
});

test("nor in the lightbox, which the panel's rules do not reach", async ({
  page,
}) => {
  // .source-link gets its border-bottom:none from `.detail-modal-inner
  // a.source-link`, an ancestor-scoped selector that cannot apply here.
  await gotoFeed(page);
  await scrollToSlide(page, 3);
  await page
    .locator("#feed .slide")
    .nth(3)
    .locator(".art-frame")
    .click({ position: { x: 60, y: 40 } });
  await expect(page.locator("#lightbox")).toHaveClass(/open/);
  const links = await page.evaluate(underlineSources);
  expect(links.length).toBeGreaterThan(0);
  expect(links.filter((l) => l.count > 1)).toEqual([]);
});
