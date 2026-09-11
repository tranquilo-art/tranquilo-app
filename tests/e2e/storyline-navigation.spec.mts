// Getting OUT of a storyline to the art it features. Both routes point at
// overlays that sit below storyline mode in the stack (detail-modal 200,
// lightbox 100, storyline-mode 250), so naively calling the existing open
// function renders them behind the storyline -- same shape as the
// toast-behind-the-modal bug (df2e754). These tests assert on what the
// visitor can actually see, not on a class landing.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fixtureStoryline, gotoStoryline } from "./harness.mts";

const STORY = fixtureStoryline();
const CHAPTER = 1;

function chapterPage(page: Page, position = CHAPTER) {
  return page.locator(
    `#storylineTrack .storyline-chapter-page[data-storyline-position="${position}"]`,
  );
}

test("the chapter title opens that artwork's detail panel", async ({
  page,
}) => {
  await gotoStoryline(page, STORY.id);

  const title = chapterPage(page).locator(".storyline-chapter-title");
  await expect(title).toHaveCount(1);
  const artworkTitle = (await title.textContent())!.trim();

  await title.click();

  // The storyline steps aside rather than being covered by the lower-stacked panel.
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
  await expect(page.locator("#storylineMode")).not.toHaveClass(/open/);
  await expect(page.locator("#detailModal .art-title")).toHaveText(
    artworkTitle,
  );
});

test("coming back from the detail panel restores the storyline, same chapter", async ({
  page,
}) => {
  await gotoStoryline(page, STORY.id);
  await chapterPage(page).locator(".storyline-chapter-title").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);

  // One press, not two: a prior bug closed an invisible overlay while the
  // visible one stayed put.
  await page.goBack();

  await expect(page.locator("#storylineMode")).toHaveClass(/open/);
  await expect(page.locator("#detailModal")).not.toHaveClass(/open/);
  const position = await page.evaluate(() => {
    const track = document.getElementById("storylineTrack")!;
    const pages = [...track.querySelectorAll<HTMLElement>(".storyline-page")];
    const mid = track.scrollLeft + track.clientWidth / 2;
    const at = pages.find(
      (p) => p.offsetLeft <= mid && p.offsetLeft + p.offsetWidth > mid,
    );
    return at ? at.dataset.storylinePosition || "intro" : null;
  });
  expect(position).toBe(String(CHAPTER));
});

test("the chapter image opens the lightbox, visibly on top", async ({
  page,
}) => {
  await gotoStoryline(page, STORY.id);

  await chapterPage(page).locator(".storyline-chapter-frame img").click();
  await expect(page.locator("#lightbox")).toHaveClass(/open/);

  // A class check alone would pass with the lightbox painted behind the storyline.
  const z = await page.evaluate(() => {
    const zi = (el: Element) => Number(getComputedStyle(el).zIndex) || 0;
    return {
      lightbox: zi(document.getElementById("lightbox")!),
      storyline: zi(document.getElementById("storylineMode")!),
    };
  });
  expect(z.lightbox).toBeGreaterThan(z.storyline);
});

test("one back press leaves the lightbox and stays in the storyline", async ({
  page,
}) => {
  await gotoStoryline(page, STORY.id);
  await chapterPage(page).locator(".storyline-chapter-frame img").click();
  await expect(page.locator("#lightbox")).toHaveClass(/open/);

  await page.goBack();

  // The back chain closes topmost-first; closing the storyline instead
  // would strand the lightbox over the feed.
  await expect(page.locator("#lightbox")).not.toHaveClass(/open/);
  await expect(page.locator("#storylineMode")).toHaveClass(/open/);
});

test("the lightbox outranks every overlay it can now be opened from", async ({
  page,
}) => {
  // The lightbox is a single shared element opened from more than one
  // place, so it must outrank all of them or the bug returns another way.
  await gotoStoryline(page, STORY.id);
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
        if (Number.isFinite(z)) zs.push({ selector: r.selectorText, z });
      }
    }
    return zs;
  });
  const lightboxZ = Math.max(
    ...declared.filter((r) => /^\.lightbox\b/.test(r.selector)).map((r) => r.z),
  );
  const below = declared.filter((r) =>
    /\.(detail-modal|storyline-mode|shelves-mode|export-modal)\b/.test(
      r.selector,
    ),
  );
  expect(below.length).toBeGreaterThan(0);
  for (const o of below) {
    expect(
      lightboxZ,
      `lightbox (${lightboxZ}) must outrank ${o.selector} (${o.z})`,
    ).toBeGreaterThan(o.z);
  }
});
