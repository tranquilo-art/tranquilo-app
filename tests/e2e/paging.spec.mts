// Assertions about what the client actually FETCHES. The flow tests pass
// either way -- they assert the app works, and it worked before too. These
// pin the architecture itself, so a regression to loading the whole
// catalogue up front fails loudly instead of just getting slower.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { actAndSettle, gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

function recordRequests(page: Page) {
  const seen: URLSearchParams[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/items") seen.push(u.searchParams);
  });
  return seen;
}

// Hydration is debounced 120ms (HYDRATE_DEBOUNCE_MS), so the first id lookup
// lands after gotoFeed() returns (as soon as shells exist). Asserting
// straight after therefore races the debounce -- passed locally, failed on
// CI's slower machine.
async function waitForRequests(
  seen: URLSearchParams[],
  predicate: (seen: URLSearchParams[]) => boolean,
  timeout = 10000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate(seen)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

test("first load fetches a page and an aggregate, never the catalogue", async ({
  page,
}) => {
  // A prior design fetched a complete order manifest (every live item) up
  // front, which grows linearly -- ~5.4MB of JSON at 20k items. The contract
  // now: nothing unbounded crosses the wire. The feed pages in a
  // server-decided order; whole-catalogue questions are answered by
  // aggregates sized by distinct values, not item count.
  const seen = recordRequests(page);
  await gotoFeed(page);

  // Exactly one aggregate, and it is not a row payload.
  const facets = seen.filter((p) => p.get("shape") === "facets");
  expect(facets).toHaveLength(1);

  // Feed pages are ordered and bounded. Every one of them must carry a limit,
  // or it is a whole-catalogue fetch wearing a shape parameter.
  const pages = seen.filter((p) => p.get("shape") === "manifest");
  expect(pages.length).toBeGreaterThan(0);
  for (const p of pages) {
    expect(p.get("order")).toBe("shuffle");
    expect(Number(p.get("limit"))).toBeGreaterThan(0);
  }

  // The two things that must never come back: a bare /api/items, and an
  // unbounded manifest.
  const fullPayload = seen.filter(
    (p) => !p.get("shape") && !p.getAll("ids").length,
  );
  expect(fullPayload).toHaveLength(0);
  const unbounded = seen.filter(
    (p) => p.get("shape") === "manifest" && !p.get("limit"),
  );
  expect(unbounded).toHaveLength(0);
});

test("slides are hydrated by id as the window approaches them", async ({
  page,
}) => {
  const seen = recordRequests(page);
  await gotoFeed(page);
  expect(
    await waitForRequests(seen, (s) => s.some((p) => p.getAll("ids").length)),
  ).toBe(true);
  const atStart = seen.filter((p) => p.getAll("ids").length).length;

  await scrollToSlide(page, 70);
  expect(
    await waitForRequests(
      seen,
      (s) => s.filter((p) => p.getAll("ids").length).length > atStart,
    ),
  ).toBe(true);

  // Hydration must not degenerate into fetching the whole catalogue one
  // page at a time on a single scroll.
  const idCounts = seen
    .filter((p) => p.getAll("ids").length)
    .map((p) => p.getAll("ids").length);
  for (const n of idCounts) expect(n).toBeLessThanOrEqual(500); // endpoint MAX_IDS
});

test("an item is never fetched twice", async ({ page }) => {
  // hydrateInFlight stops the window re-requesting ids already in the air.
  const seen = recordRequests(page);
  await gotoFeed(page);
  await scrollToSlide(page, 40);
  await scrollToSlide(page, 10);
  await scrollToSlide(page, 40);

  // Let the final debounced flush land before reading the tally.
  await waitForRequests(seen, () => false, 400);
  const all = seen.flatMap((p) => p.getAll("ids"));
  expect(all.length).toBe(new Set(all).size);
});

test("search asks the server rather than filtering locally", async ({
  page,
}) => {
  // The catalogue isn't in the browser at all now, so a local matchesQuery()
  // would have nothing to run against.
  const seen = recordRequests(page);
  await gotoFeed(page);
  await page.locator("#searchToggle").click();
  await page.locator("#searchInput").fill("bronze");
  await page.locator("#searchSubmit").click();
  // A successful search closes the panel and hands the announcement to the
  // filter banner rather than the panel's own results line.
  await expect(page.locator("#filterBanner")).toBeVisible();

  const queries = seen.filter((p) => p.get("q") === "bronze");
  expect(queries.length).toBeGreaterThan(0);

  // The results line comes from a count, not from measuring a fetched
  // result set -- counting rows client-side under-reports on a paged feed.
  expect(queries.some((p) => p.get("shape") === "count")).toBe(true);
  // ...and the rows themselves arrive as ordinary bounded feed pages.
  const rows = queries.filter((p) => p.get("shape") === "manifest");
  for (const p of rows) expect(Number(p.get("limit"))).toBeGreaterThan(0);
});

test("the catalogue's shape is fetched once, not per view change", async ({
  page,
}) => {
  // A paged feed necessarily re-queries when the view changes; the invariant
  // that survives is the aggregate describing the catalogue, which no view
  // change can alter.
  const seen = recordRequests(page);
  await gotoFeed(page);
  await actAndSettle(page, () => page.locator("#chips button").nth(1).click());
  await actAndSettle(page, () => page.locator("#chips button").nth(0).click());
  await page.locator("#collectionToggle").click();

  const facets = seen.filter((p) => p.get("shape") === "facets");
  expect(facets).toHaveLength(1);

  // And every feed page stayed bounded throughout.
  const pages = seen.filter((p) => p.get("shape") === "manifest");
  for (const p of pages) expect(Number(p.get("limit"))).toBeGreaterThan(0);
});

test("slugs are correct before an item is hydrated", async ({ page }) => {
  // Regression: with source missing from the manifest, createSlideShell()'s
  // slugFor() silently fell back to "met" for every non-Met shell, so a
  // slug read before the full row landed resolved to nothing. Asserted on
  // shells specifically, since a hydrated slide would mask it.
  const feed = await gotoFeed(page);
  const bad = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els: HTMLElement[]) =>
      els
        .map((e) => e.dataset.slug || "")
        .filter((s) => /^met-(ld1|commons|europeana|cleveland)/.test(s)),
    );
  expect(bad).toEqual([]);

  // And every rendered slug matches a source prefix we actually serve.
  const slugs = await feed
    .locator(".slide[data-slug]")
    .evaluateAll((els: HTMLElement[]) => els.map((e) => e.dataset.slug));
  expect(slugs.length).toBeGreaterThan(50);
  for (const s of slugs) {
    expect(s).toMatch(/^(met|smithsonian|cleveland|commons|europeana)-/);
  }
});

test("an id containing a comma still resolves", async ({ page }) => {
  // Live production bug: 41 Commons items have a comma in their native_id
  // (real filenames), and the lookup used to comma-join ids into one
  // parameter, splitting each into two ids matching nothing and rendering
  // blank slides. Survived earlier runs because the fixture had no Commons
  // or Europeana items; it now covers all five sources for this reason.
  const item = ITEMS.find((i: any) => String(i.id).includes(","));
  expect(item, "fixture must contain a comma-bearing id").toBeTruthy();

  const seen = recordRequests(page);
  await gotoFeed(page);

  const resolved = await page.evaluate(async (id) => {
    const res = await fetch(`/api/items?ids=${encodeURIComponent(id)}`);
    const body = await res.json();
    return {
      found: body.items.map((i: any) => String(i.id)),
      missing: body.missing,
    };
  }, String(item.id));

  expect(resolved.missing).toEqual([]);
  expect(resolved.found).toEqual([String(item.id)]);

  // And the app must never send a comma-joined list again: one param per id.
  const lookups = seen.filter((p) => p.getAll("ids").length);
  for (const p of lookups) {
    for (const value of p.getAll("ids")) {
      expect(value).not.toBe("");
    }
  }
});
