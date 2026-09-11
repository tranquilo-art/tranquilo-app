// Sharing a Storyline. Three things didn't exist before this: a share
// control in Storyline mode, a URL for a storyline at all (the address bar
// never moved), and a preview format. These cover the first two -- the
// third is server-side, in tests/storyline-share.test.js.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  fixtureStoryline,
  gotoFeed,
  gotoStoryline,
  scrollToSlide,
} from "./harness.mts";

declare global {
  interface Window {
    __copied?: string[];
  }
}

const FIRST = fixtureStoryline();

// Storyline chips only exist on slides whose item belongs to a storyline.
async function openAStoryline(page: Page) {
  for (let i = 1; i < 60; i++) {
    await scrollToSlide(page, i);
    const chip = page.locator("#feed .slide").nth(i).locator(".storyline-chip");
    if (await chip.count()) {
      await chip.click();
      await page.waitForSelector("#storylineMode.open");
      return;
    }
  }
  throw new Error("no storyline chip found in the first 60 slides");
}

// Desktop Chrome reports (pointer: fine), so shareItem takes the
// clipboard branch -- deterministic, and the branch that toasts.
async function captureClipboard(page: Page) {
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => {
          window.__copied!.push(t);
          return Promise.resolve();
        },
      },
    });
  });
}

test("the storyline intro page offers a share control", async ({ page }) => {
  await gotoFeed(page);
  await openAStoryline(page);

  const intro = page.locator("#storylineMode .storyline-intro-page");
  await expect(intro).toHaveCount(1);
  // On the intro page specifically: shares the story as a whole, not a chapter.
  await expect(intro.locator(".btn-share")).toHaveCount(1);
});

test("sharing copies the storyline's own URL, not the cover artwork's", async ({
  page,
}) => {
  await gotoFeed(page);
  await openAStoryline(page);
  await captureClipboard(page);

  const openId = await page.evaluate(() => {
    const dots = document.querySelectorAll("#storylineTimeline .storyline-dot");
    return dots.length;
  });
  expect(openId).toBeGreaterThan(0);

  await page.locator("#storylineMode .storyline-intro-page .btn-share").click();
  await page.waitForFunction(
    () => window.__copied && window.__copied.length > 0,
  );

  const copied = (await page.evaluate(() => window.__copied))![0];
  // The story, not a painting out of it: /v/ here would be exactly the bug this guards against.
  expect(copied).toMatch(/\/s\/[a-z0-9-]+$/);
  expect(copied).not.toContain("/v/");
});

test("the confirmation toast is visible above Storyline mode", async ({
  page,
}) => {
  // Storyline mode is the highest full-screen overlay (z-index 250); a
  // toast painted behind the thing that triggered it reads as a dead
  // button. Asserts stacking, not `.show`, since a class check passes on
  // an invisible element.
  await gotoFeed(page);
  await openAStoryline(page);
  await captureClipboard(page);

  await page.locator("#storylineMode .storyline-intro-page .btn-share").click();
  await expect(page.locator(".toast")).toHaveClass(/show/);

  const stacking = await page.evaluate(() => {
    const z = (el: Element) => Number(getComputedStyle(el).zIndex) || 0;
    return {
      toast: z(document.querySelector(".toast")!),
      storyline: z(document.getElementById("storylineMode")!),
    };
  });
  expect(stacking.toast).toBeGreaterThan(stacking.storyline);
});

test("/s/{id} cold-loads straight into that storyline", async ({ page }) => {
  await gotoStoryline(page, FIRST.id);

  const mode = page.locator("#storylineMode");
  await expect(mode).toHaveClass(/open/);
  await expect(page.locator("#storylineHeaderTitle")).toHaveText(FIRST.title);

  // A storyline's items aren't in the feed's hydration window, so this
  // exercises openStorylineMode's hydrate-then-reopen path on a cold boot.
  await expect(
    page.locator("#storylineTrack .storyline-chapter-page"),
  ).toHaveCount(FIRST.items.length);
  await expect(page.locator("#storylineTimeline .storyline-dot")).toHaveCount(
    FIRST.items.length,
  );
});

test("an unknown /s/{id} falls back to the feed instead of hanging", async ({
  page,
}) => {
  await gotoStoryline(page, "no-such-storyline", { expectOpen: false });
  await expect(page.locator("#storylineMode")).not.toHaveClass(/open/);
  await expect(page.locator("#feed .slide").first()).toBeVisible();
});
