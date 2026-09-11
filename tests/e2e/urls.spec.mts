// Real per-item URLs. /v/{slug} used to render a stub and then
// location.replace() a human into /index.html#{slug}, leaving no URL to
// copy. These assert the URL is now real, and that the historical hash
// form still works since old links live in people's messages forever.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, scrollToSlide, stubBackend } from "./harness.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A resume sets scrollTop on a `scroll-behavior: smooth` container, so the
// feed animates to the target (~1.8s for a far slide). Polls rather than a
// fixed wait, which either flakes or is needlessly slow.
async function landedOn(page: Page, slug: string) {
  try {
    await page.waitForFunction(
      (s: string) => {
        const feed = document.getElementById("feed")!;
        const el = feed.querySelector<HTMLElement>(`[data-slug="${s}"]`);
        if (!el) return false;
        return Math.abs(feed.scrollTop - el.offsetTop) < feed.clientHeight / 2;
      },
      slug,
      { polling: 100, timeout: 15000 },
    );
    return true;
  } catch {
    return false;
  }
}

test("the URL follows the slide you are looking at", async ({ page }) => {
  await gotoFeed(page);
  // Index 0 is the intro slide, which is the top of the feed, i.e. "/".
  await scrollToSlide(page, 4);
  const slug = await page
    .locator("#feed .slide")
    .nth(4)
    .getAttribute("data-slug");
  // Compared against the encoded form: Commons slugs carry colons and
  // spaces, which the address bar shows percent-encoded -- and, same as
  // encodeSlugId()'s own copies in app.ts/TranquiloFeed.ts, Commons'
  // "File:" prefix is stripped and Europeana's leading "/N/" is
  // normalized to "N-" before that (SlugCodec.decodeId() reverses both
  // on read), or a random landing on either source fails this assertion.
  const cut = (slug || "").indexOf("-");
  const source = cut === -1 ? "" : (slug || "").slice(0, cut);
  let idPart = cut === -1 ? slug || "" : (slug || "").slice(cut + 1);
  if (source === "commons" && idPart.slice(0, 5) === "File:") {
    idPart = idPart.slice(5);
  } else if (source === "europeana") {
    const m = /^\/([0-9]+)\/(.+)$/.exec(idPart);
    if (m) idPart = `${m[1]}-${m[2]}`;
  }
  const encoded = `/v/${source}-${encodeURIComponent(idPart)}`;
  await expect(page).toHaveURL(
    new RegExp(`${encoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
  );
});

test("scrolling back to the top restores the bare URL", async ({ page }) => {
  await gotoFeed(page);
  await scrollToSlide(page, 4);
  await expect(page).toHaveURL(/\/v\//);
  await scrollToSlide(page, 0);
  await expect(page).not.toHaveURL(/\/v\//);
});

test("the feed does not stack history entries per slide", async ({ page }) => {
  // replaceState, not pushState: pushing one entry per slide would turn
  // Back into a slide-by-slide rewind of everything scrolled past.
  await gotoFeed(page);
  const before = await page.evaluate(() => history.length);
  for (const i of [3, 6, 9, 12, 15]) await scrollToSlide(page, i);
  const after = await page.evaluate(() => history.length);
  expect(after - before).toBeLessThanOrEqual(1);
});

test("a /v/{slug} URL opens that artwork directly", async ({ page }) => {
  // api/v/[slug].js now serves index.html in place (with <base href="/">)
  // rather than bouncing to a hash. Emulated here by answering /v/** with
  // the real index.html, exercising slugFromLocation() reading location.pathname.
  const item = ITEMS[7];
  const slug = `${item.source}-${item.id}`;
  await stubBackend(page);

  // Reads dist/index.html (the real Vite build), not repo-root source: the
  // test server only serves the built output, so an unbundled stub would
  // point the browser at a path it can't resolve.
  const indexHtml = readFileSync(
    path.join(__dirname, "../../dist/index.html"),
    "utf8",
  ).replace("<head>", '<head>\n<base href="/">');
  await page.route("**/v/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: indexHtml }),
  );

  await page.goto(`/v/${slug}`);
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );
  expect(await landedOn(page, slug)).toBe(true);
});

test("the legacy #slug form still resumes", async ({ page }) => {
  // Old links are in people's messages and bookmarks permanently; dropping
  // the hash form would break every one of them.
  const item = ITEMS[11];
  const slug = `${item.source}-${item.id}`;
  await stubBackend(page);
  await page.goto(`/index.html#${slug}`);
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );
  expect(await landedOn(page, slug)).toBe(true);
});

test("the app at /v/{slug} is actually styled", async ({ page }) => {
  // <base href="/"> was once injected at </head> -- well-formed but too
  // late, since it only affects URLs after it and the stylesheet link is
  // inside <head>. It 404'd while the app's <script> at end of <body>
  // loaded fine: JS ran, CSS didn't, unstyled column. Only computed style shows it.
  const item = ITEMS[3];
  const slug = `${item.source}-${item.id}`;
  await stubBackend(page);
  await page.goto(`/v/${slug}`);
  await page.waitForFunction(
    () => document.querySelectorAll("#feed .slide").length > 1,
  );

  const feed = await page.evaluate(() => {
    const f = document.getElementById("feed")!;
    const s = getComputedStyle(f);
    return {
      overflowY: s.overflowY,
      snap: s.scrollSnapType,
      height: f.clientHeight,
    };
  });
  expect(feed.overflowY).toBe("scroll");
  expect(feed.snap).toContain("mandatory");

  // A slide fills the viewport, which the recycling window's index
  // arithmetic depends on.
  const slideHeight = await page
    .locator("#feed .slide")
    .first()
    .evaluate((e: HTMLElement) => e.clientHeight);
  expect(Math.abs(slideHeight - feed.height)).toBeLessThan(2);
});
