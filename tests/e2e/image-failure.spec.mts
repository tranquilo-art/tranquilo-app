// What a visitor sees when an image does not arrive. harness.mts stubs
// /img/** to a 1x1 PNG so every image always succeeds elsewhere; the stub
// isn't removed here (see its own header) --
// it gains a failure switch instead.
import { expect, type Page, test } from "@playwright/test";
import { failImages, gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

// Slugs (slide data-slug, source-id) of fixture items that carry a
// blur_placeholder. Not every item does, the "All" feed starts at a random
// point in the shuffle, and only the slide on screen requests its image --
// so asserting on "the first frame" failed whenever an item without a
// placeholder happened to open the feed (roughly one run in fifteen). The
// test scrolls to the first slide that has one instead.
const SLUGS_WITH_PLACEHOLDER: string[] = ITEMS.filter(
  (i: { blur_placeholder?: string }) => i.blur_placeholder,
).map((i: { source?: string; id: string }) => `${i.source || "met"}-${i.id}`);

test("a failed image degrades to the artwork, not a grey box", async ({
  page,
}) => {
  // 947 items carry a blur_placeholder already in the API payload, so a
  // broken image can show a soft version of the real artwork -- if the
  // failed state doesn't paint an opaque panel over it, which it used to.
  failImages(page, () => true);
  const feed = await gotoFeed(page);

  const index = await page.evaluate((slugs) => {
    const wanted = new Set(slugs);
    return Array.from(
      document.querySelectorAll<HTMLElement>("#feed .slide"),
    ).findIndex((s) => wanted.has(s.dataset.slug ?? ""));
  }, SLUGS_WITH_PLACEHOLDER);
  expect(
    index,
    "no slide with a placeholder in the opening page",
  ).toBeGreaterThan(0);
  await scrollToSlide(page, index);

  const frame = feed.locator(".slide").nth(index).locator(".art-frame");
  await expect(frame).toHaveClass(/failed/, { timeout: 15000 });

  const painted = await frame.evaluate((el) => {
    const skeleton = el.querySelector(".art-skeleton")!;
    const bg = getComputedStyle(skeleton).backgroundColor;
    // Alpha < 1 (or no colour) means the placeholder shows through.
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const alpha = m ? Number(m[1].split(",")[3] ?? 1) : 0;
    return {
      frameHasPlaceholder: !!(el as HTMLElement).style.backgroundImage,
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
  let broken: string | null = null;
  failImages(page, (url) => {
    const image = url.split("?")[0]; // every attempt at the first image
    broken ??= image;
    return image === broken;
  });
  const feed = await gotoFeed(page);
  await expect(feed.locator(".slide").first()).toBeVisible();

  // Asserts a floor too: `<= 1` alone would pass even with no failure at all.
  await expect(
    feed.locator(".art-frame.failed"),
    "the injected failure did not happen",
  ).not.toHaveCount(0, { timeout: 15000 });
  const slides = await feed.locator(".slide").count();
  const failed = await feed.locator(".art-frame.failed").count();
  expect(slides).toBeGreaterThan(5);
  expect(failed, "the failure leaked to other slides").toBeLessThan(slides / 2);
});

test("an image refused once loads on its own, without a failed state", async ({
  page,
}) => {
  failImages(page, (url) => !url.includes("retry="));
  const requests = imageRequests(page);
  const feed = await gotoFeed(page);
  const frame = feed.locator(".slide .art-frame").first();

  await expect(frame).not.toHaveClass(/loading|failed/, { timeout: 10000 });
  expect(
    requests.some((url) => url.includes("retry=")),
    "no automatic retry was requested",
  ).toBe(true);
  expect(await feed.locator(".art-frame.failed").count()).toBe(0);
});

async function firstFailedFrame(page: Page) {
  const feed = page.locator("#feed");
  const frame = feed.locator(".slide .art-frame.failed").first();
  await expect(frame).toBeVisible({ timeout: 15000 });
  return frame;
}

function imageRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/img/")) urls.push(r.url());
  });
  return urls;
}

test("tapping a failed image fetches it again and shows it", async ({
  page,
}) => {
  failImages(page, () => true);
  await gotoFeed(page);
  const frame = await firstFailedFrame(page);
  const slug = await frame.evaluate(
    (el) => (el.closest(".slide") as HTMLElement).dataset.slug,
  );

  const slide = page.locator(`#feed .slide[data-slug="${slug}"]`);
  const retryFrame = slide.locator(".art-frame");

  const requests = imageRequests(page);
  failImages(page, () => false);
  await expect(retryFrame).toHaveClass(/failed/, { timeout: 15000 });
  // The caption or topbar can cover the frame's center, blocking a real click.
  await retryFrame.dispatchEvent("click");

  await expect(retryFrame).not.toHaveClass(/failed/, {
    timeout: 10000,
  });
  await expect(retryFrame).not.toHaveClass(/loading/);
  expect(requests.length, "the retry made no network request").toBeGreaterThan(
    0,
  );
});

test("failed images recover without a tap when the connection returns", async ({
  page,
}) => {
  failImages(page, () => true);
  await gotoFeed(page);
  await firstFailedFrame(page);

  failImages(page, () => false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect(page.locator("#feed .slide .art-frame.failed")).toHaveCount(0, {
    timeout: 10000,
  });
});

test("failed images recover when the tab becomes visible again", async ({
  page,
}) => {
  failImages(page, () => true);
  await gotoFeed(page);
  await firstFailedFrame(page);

  failImages(page, () => false);
  await page.evaluate(() => {
    const setState = (s: string) =>
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => s,
      });
    setState("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setState("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(page.locator("#feed .slide .art-frame.failed")).toHaveCount(0, {
    timeout: 10000,
  });
});
