// The lightbox's way out to the source institution's own copy, since
// Tranquilo caps what it serves at ~2000-2400px. Points at `url` (the object
// page) rather than `full_img`, which across all 1358 live rows is four
// different things wearing one name (a .tif, a download endpoint, various
// aggregator formats) -- the object page is the only URL reliably
// human-facing across all five sources.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoArtwork, gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

declare global {
  interface Window {
    __popstateCount?: number;
  }
}

const link = (page: Page) => page.locator("#lightboxSourceLink");

// Slide 0 is `.slide.intro` -- a title card with no artwork and no frame to
// click. Real artwork starts at index 1.
const FIRST_ARTWORK_SLIDE = 1;

// Returns the fixture item the lightbox is currently showing, resolved from
// the link's own href rather than the slide index, since the feed shuffles
// per session and slide N is not ITEMS[N].
async function openLightboxAt(page: Page, index = FIRST_ARTWORK_SLIDE) {
  await scrollToSlide(page, index);
  // Top-left of the frame, not centre: the caption overlays the lower part
  // of a slide and intercepts pointer events there on tall captions.
  await page
    .locator("#feed .slide")
    .nth(index)
    .locator(".art-frame")
    .click({ position: { x: 12, y: 12 } });
  await expect(page.locator("#lightbox")).toHaveClass(/open/);
  await expect(link(page)).toBeVisible();
  const href = await link(page).getAttribute("href");
  const item = ITEMS.find((i: any) => i.url === href);
  expect(item, `lightbox href ${href} matched no fixture item`).toBeTruthy();
  // Cross-check that the link and the picture describe the same object; a
  // stale href would fail this regardless of feed ordering.
  await expect(page.locator("#lightboxImg")).toHaveAttribute(
    "alt",
    item.title || "",
  );
  return item;
}

test("the lightbox offers a way out to the source", async ({ page }) => {
  await gotoFeed(page);
  await openLightboxAt(page);
  await expect(link(page)).toBeVisible();
  await expect(link(page)).toHaveAttribute("target", "_blank");
  // rel=noopener is not decoration here: without it the museum's page gets a
  // handle on the window it was opened from.
  await expect(link(page)).toHaveAttribute("rel", /noopener/);
});

test("it points at the object page, and never at the raw original", async ({
  page,
}) => {
  await gotoFeed(page);
  const item = await openLightboxAt(page);
  const href = await link(page).getAttribute("href");

  // `full` is the source's true original -- a .tif for Cleveland, a download
  // endpoint for Smithsonian -- a different action on every source.
  if (item.full) expect(href).not.toBe(item.full);
  expect(href).not.toMatch(/\/img\//); // and never back through our own proxy
});

test("it names the institution rather than our internal source slug", async ({
  page,
}) => {
  // "View on commons" shipped for 471 of 1358 live items (35%) -- the
  // internal adapter name shown to a reader as though it were a museum.
  // Drives one KNOWN item per source via deep link rather than walking
  // shuffled feed slides, since a shuffled sample needs a median of 15
  // slides (p95 32) to see all five sources at least once.
  const sources = [
    ...new Set((ITEMS as any[]).map((i): string => i.source)),
  ].sort();
  expect(
    sources.length,
    "fixture should carry several sources",
  ).toBeGreaterThan(1);
  const visited = [];

  // A /v/{slug} URL rotates that item to the front of the feed
  // (renderFeed's pendingDeepLinkSlug branch), making slide 0 a known
  // artwork. Measured faster than seeking by data-slug within one boot
  // (8.1s vs 11.4s), since scrollToSlide's convergence over ~80 slides
  // costs more than a fresh page load.
  for (const source of sources) {
    const item = ITEMS.find((i: any) => i.source === source && i.img);
    expect(item, `fixture has no usable ${source} item`).toBeTruthy();

    const slide = await gotoArtwork(page, source, item.id);
    await slide.locator(".art-frame").click({ position: { x: 12, y: 12 } });
    await expect(page.locator("#lightbox")).toHaveClass(/open/);

    const text = await link(page).locator(".link-text").innerText();
    expect(text, `${source} shows its raw slug`).not.toMatch(
      new RegExp(`\\b${source}\\b(?!\\.)`),
    );
    expect(text, `${source} has no institution label`).toMatch(
      /\.(org|eu|edu|com)\b/,
    );
    visited.push(source);
    await page.locator("#lightboxClose").click();
  }

  // A source silently skipped by the loop must fail here, not pass by omission.
  expect(visited).toEqual(sources);
});

test("an aggregator does not promise full resolution on someone else's behalf", async ({
  page,
}) => {
  // Europeana aggregates rather than holds: its url lands on a portal record
  // pointing at whichever of ~26 institutions actually has the object, so
  // the copy differs from sources that hold their own works.
  await gotoFeed(page);

  // Located by slug rather than walking the feed, since the shuffle makes
  // "the first N slides" a different set every run.
  const indexOf = (prefix: string) =>
    page.evaluate((p: string) => {
      const slides = [
        ...document.querySelectorAll<HTMLElement>("#feed .slide"),
      ];
      return slides.findIndex((s) => (s.dataset.slug || "").startsWith(p));
    }, prefix);

  const aggregatorAt = await indexOf("europeana-");
  const holdingAt = await indexOf("met-");
  expect(aggregatorAt, "no europeana slide in the feed").toBeGreaterThan(-1);
  expect(holdingAt, "no met slide in the feed").toBeGreaterThan(-1);

  const aggregator = await openLightboxAt(page, aggregatorAt);
  expect(aggregator.source).toBe("europeana");
  await expect(link(page).locator(".link-text")).toHaveText(
    /^Source record at/,
  );
  await page.locator("#lightboxClose").click();

  // The contrast is the assertion: checking only the aggregator would keep
  // passing if every source got the cautious wording.
  const holding = await openLightboxAt(page, holdingAt);
  expect(holding.source).toBe("met");
  await expect(link(page).locator(".link-text")).toHaveText(
    /^Full resolution at/,
  );
});

test("it is rebuilt per item, not left pointing at the previous artwork", async ({
  page,
}) => {
  // #lightboxSourceLink is a single persistent element reused per item, so a
  // stale href could offer the last museum's page. openLightboxAt() already
  // asserts the link and image agree; what's left is that the href moved.
  await gotoFeed(page);
  const firstItem = await openLightboxAt(page, FIRST_ARTWORK_SLIDE);
  await page.locator("#lightboxClose").click();
  const secondItem = await openLightboxAt(page, FIRST_ARTWORK_SLIDE + 1);

  expect(secondItem.id).not.toBe(firstItem.id);
  expect(await link(page).getAttribute("href")).toBe(secondItem.url);
});

test("it gets out of the way while the image is zoomed", async ({ page }) => {
  // A link sitting over the bottom of the frame would swallow any drag
  // starting there, silently breaking the pan.
  await gotoFeed(page);
  await openLightboxAt(page);
  await expect(link(page)).toBeVisible();

  const box = (await page.locator("#lightboxImg").boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.locator("#lightbox")).toHaveClass(/zoomed/);
  await expect(link(page)).toHaveCSS("opacity", "0");

  // And comes back on zoom out.
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#lightbox")).not.toHaveClass(/zoomed/);
  await expect(link(page)).toHaveCSS("opacity", "1");
});

// pushOverlayHistoryState/requestOverlayClose routes an explicit close
// through history.back() rather than calling close() directly, so a pushed
// history entry never gets left behind for the next real back press to
// consume. Caught once already when <tranquilo-lightbox> bypassed this,
// passing every other test in this file since none look at history.
test("closing via the close button consumes its own history entry", async ({
  page,
}) => {
  await gotoFeed(page);
  await openLightboxAt(page);

  // history.back() fires a real popstate event; a plain classList removal
  // does not. More reliable than history.state, which the feed's own
  // background URL-sync can mutate independently of whether back() ran.
  await page.evaluate(() => {
    window.__popstateCount = 0;
    window.addEventListener("popstate", () => {
      window.__popstateCount = (window.__popstateCount || 0) + 1;
    });
  });

  await page.locator("#lightboxClose").click();
  await expect(page.locator("#lightbox")).not.toHaveClass(/open/);
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__popstateCount)).toBe(1);
});
