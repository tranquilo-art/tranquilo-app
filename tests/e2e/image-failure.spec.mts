// What a visitor sees when an image does not arrive. harness.mts stubs
// /img/** to a 1x1 PNG so every image always succeeds elsewhere; the stub
// isn't removed here (see its own header on the Commons rate-limit hold) --
// it gains a failure switch instead.
import { expect, test } from "@playwright/test";
import { failImages, gotoFeed } from "./harness.mts";

test("a failed image degrades to the artwork, not a grey box", async ({
  page,
}) => {
  // 947 items carry a blur_placeholder already in the API payload, so a
  // broken image can show a soft version of the real artwork -- if the
  // failed state doesn't paint an opaque panel over it, which it used to.
  failImages(page, () => true);
  const feed = await gotoFeed(page);

  const frame = feed.locator(".slide .art-frame").first();
  await expect(frame).toHaveClass(/failed/, { timeout: 15000 });

  const painted = await frame.evaluate((el) => {
    const skeleton = el.querySelector(".art-skeleton")!;
    const bg = getComputedStyle(skeleton).backgroundColor;
    // Alpha < 1 (or no colour) means the placeholder shows through.
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? Number(m[1].split(",")[3] ?? 1) : 0;
    return {
      frameHasPlaceholder: !!el.style.backgroundImage,
      skeletonAlpha: alpha,
    };
  });
  expect(painted.frameHasPlaceholder).toBe(true);
  expect(painted.skeletonAlpha).toBeLessThan(1);
});

test("a failed image tells the visitor it can be retried", async ({ page }) => {
  failImages(page, () => true);
  const feed = await gotoFeed(page);
  const skeleton = feed
    .locator(".slide .art-frame.failed .art-skeleton")
    .first();
  await expect(skeleton).toContainText(/retry/i, { timeout: 15000 });
});

test("one broken image does not break the feed", async ({ page }) => {
  // The failure must stay local to its slide -- the recycling DOM makes
  // "one slide's state leaks into another" a real possibility.
  let n = 0;
  failImages(page, () => n++ === 0); // only the very first request
  const feed = await gotoFeed(page);
  await expect(feed.locator(".slide").first()).toBeVisible();

  await page.waitForTimeout(1500);
  const slides = await feed.locator(".slide").count();
  const failed = await feed.locator(".art-frame.failed").count();

  // Asserts a floor too: `<= 1` alone would pass even with no failure at all.
  expect(failed, "the injected failure did not happen").toBeGreaterThanOrEqual(
    1,
  );
  expect(slides).toBeGreaterThan(5);
  expect(failed, "the failure leaked to other slides").toBeLessThan(slides / 2);
});
