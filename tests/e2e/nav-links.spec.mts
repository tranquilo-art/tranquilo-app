// Navigation links must survive the URL changing under them. The bug this
// prevents: the feed pushState()s to /v/{slug} without going through
// api/v/[slug].js, so its injected <base href="/"> is absent, and a relative
// href like "pages/pro.html" resolves against /v/cleveland-108401 and 404s.
// Invisible on a fresh page load, so every earlier e2e test passed.
import { expect, test } from "@playwright/test";
import { gotoFeed, scrollToSlide } from "./harness.mts";

test("nav links still resolve after the feed has rewritten the URL", async ({
  page,
}) => {
  await gotoFeed(page);
  await scrollToSlide(page, 4);

  // Precondition: the URL really has moved, or this would pass trivially.
  await expect.poll(() => page.url()).toContain("/v/");

  // Resolved against the current url, as an actual click does.
  const resolved = await page.evaluate(() => {
    const out: { raw: string; resolved: string }[] = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const raw = a.getAttribute("href");
      if (!raw || raw.startsWith("#") || raw.startsWith("mailto:")) return;
      out.push({ raw, resolved: new URL(raw, document.baseURI).pathname });
    });
    return out;
  });

  expect(resolved.length).toBeGreaterThan(0);
  const broken = resolved.filter((l) => l.resolved.startsWith("/v/"));
  expect(
    broken,
    `links resolving under /v/ would 404: ${JSON.stringify(broken)}`,
  ).toEqual([]);
});

test("the Collect upsell CTA points at the waitlist, not into /v/", async ({
  page,
}) => {
  // Checked by resolution, not string match: "pages/pro.html" looks right in
  // the markup and is only wrong relative to where the browser thinks it is.
  await gotoFeed(page);
  await scrollToSlide(page, 4);
  // The URL sync is debounced behind scrollToSlide's settle, so asserting
  // immediately would test /index.html (where the link is correct) and pass
  // regardless of the bug.
  await expect.poll(() => page.url()).toContain("/v/");

  const target = await page.evaluate(() => {
    const cta = document.getElementById("upsellCta");
    return cta
      ? new URL(cta.getAttribute("href")!, document.baseURI).pathname
      : null;
  });
  expect(target).toBe("/pages/pro.html");
});

test("the menu's links survive it too", async ({ page }) => {
  // Injected by js/app.js rather than present in index.html, so this can
  // regress independently of the other links.
  await gotoFeed(page);
  await scrollToSlide(page, 4);
  await expect.poll(() => page.url()).toContain("/v/");

  const menuTargets = await page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll('a[href*="pages/"]').forEach((a) => {
      out[(a.textContent || "").trim()] = new URL(
        a.getAttribute("href")!,
        document.baseURI,
      ).pathname;
    });
    return out;
  });

  for (const [label, path] of Object.entries(menuTargets)) {
    expect(path, `"${label}" resolves to ${path}`).toMatch(/^\/pages\//);
  }
});
