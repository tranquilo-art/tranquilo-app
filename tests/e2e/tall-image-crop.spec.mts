// Tall portraits were cropped at the top in the feed, cutting off the
// subject's head. Root cause: `.art-frame`'s flex item default
// min-height:auto stops it shrinking below the image's intrinsic size, so
// `max-height:100%` can't resolve and only `max-width:100%` applies -- a
// portrait renders at full frame width with oversized height, and
// `overflow:hidden` clips the top and bottom evenly. The default 1x1 image
// stub can't exercise this at all, so this spec uses harness.mts's
// TALL_PNG/WIDE_PNG stubs instead.
import { expect, test } from "@playwright/test";
import {
  gotoArtwork,
  ITEMS,
  serveTallImage,
  serveWideImage,
} from "./harness.mts";

const TALL_ITEM = ITEMS[0]; // any fixture item works; only the served image's aspect ratio matters
const WIDE_ITEM = ITEMS[1];

test("a tall (portrait) image is fully contained -- the top is not cropped", async ({
  page,
}) => {
  serveTallImage(page, (url) =>
    url.includes(`/${TALL_ITEM.source || "met"}/${TALL_ITEM.id}/`),
  );
  await gotoArtwork(page, TALL_ITEM.source || "met", TALL_ITEM.id);

  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(TALL_ITEM.id)}"]`)
    .first();
  const frame = slide.locator(".art-frame");
  const img = frame.locator("img").first();
  await expect(img).toBeVisible();

  const [slideBox, frameBox, imgBox] = await Promise.all([
    slide.boundingBox(),
    frame.boundingBox(),
    img.boundingBox(),
  ]);
  if (!slideBox || !frameBox || !imgBox) {
    throw new Error("boundingBox() returned null for a visible element");
  }

  // The frame must not grow past its flex-allocated share of the slide --
  // what min-height:0 fixes.
  expect(frameBox.height).toBeLessThanOrEqual(slideBox.height + 1);

  // No part of the image renders outside the slide's own bounds.
  expect(imgBox.y).toBeGreaterThanOrEqual(slideBox.y - 1);
  expect(imgBox.y + imgBox.height).toBeLessThanOrEqual(
    slideBox.y + slideBox.height + 1,
  );

  // Aspect ratio preserved (object-fit:contain, not stretched): TALL_PNG is
  // 900x1200, ratio 1:1.33.
  expect(imgBox.height / imgBox.width).toBeGreaterThan(1.2);
});

test("a wide (landscape) image is also fully contained", async ({ page }) => {
  serveWideImage(page, (url) =>
    url.includes(`/${WIDE_ITEM.source || "met"}/${WIDE_ITEM.id}/`),
  );
  await gotoArtwork(page, WIDE_ITEM.source || "met", WIDE_ITEM.id);

  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(WIDE_ITEM.id)}"]`)
    .first();
  const frame = slide.locator(".art-frame");
  const img = frame.locator("img").first();
  await expect(img).toBeVisible();

  const [slideBox, frameBox, imgBox] = await Promise.all([
    slide.boundingBox(),
    frame.boundingBox(),
    img.boundingBox(),
  ]);
  if (!slideBox || !frameBox || !imgBox) {
    throw new Error("boundingBox() returned null for a visible element");
  }

  expect(frameBox.height).toBeLessThanOrEqual(slideBox.height + 1);
  expect(imgBox.y).toBeGreaterThanOrEqual(slideBox.y - 1);
  expect(imgBox.y + imgBox.height).toBeLessThanOrEqual(
    slideBox.y + slideBox.height + 1,
  );

  // WIDE_PNG is 1200x400, ratio 3:1 -- width-constrained, unaffected by the
  // portrait-only bug.
  expect(imgBox.width / imgBox.height).toBeGreaterThan(2.5);
});

test("a tall image still fits at a shorter viewport height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  serveTallImage(page, (url) =>
    url.includes(`/${TALL_ITEM.source || "met"}/${TALL_ITEM.id}/`),
  );
  await gotoArtwork(page, TALL_ITEM.source || "met", TALL_ITEM.id);

  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(TALL_ITEM.id)}"]`)
    .first();
  const frame = slide.locator(".art-frame");
  const img = frame.locator("img").first();
  await expect(img).toBeVisible();

  const [slideBox, frameBox, imgBox] = await Promise.all([
    slide.boundingBox(),
    frame.boundingBox(),
    img.boundingBox(),
  ]);
  if (!slideBox || !frameBox || !imgBox) {
    throw new Error("boundingBox() returned null for a visible element");
  }

  expect(frameBox.height).toBeLessThanOrEqual(slideBox.height + 1);
  expect(imgBox.y).toBeGreaterThanOrEqual(slideBox.y - 1);
  expect(imgBox.y + imgBox.height).toBeLessThanOrEqual(
    slideBox.y + slideBox.height + 1,
  );
});
