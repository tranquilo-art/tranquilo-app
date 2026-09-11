// `culture`/`culture_period` is unconditionally the OBJECT's place for
// Europeana rows (harmonize/attribution.py's _PLACE_ONLY_SOURCES), never the
// artist's, regardless of attribution_type. The old label picked "Origin" vs
// "Culture" off attribution_type, mislabelling a Europeana row naming a real
// artist as "Culture: <nationality>". Scoped to Europeana only.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

const BASE = ITEMS.find(
  (i: any) => i.source === "met" && i.artist_nationality && i.artist_lifespan,
);

function testItem(id: string, overrides: Record<string, unknown>) {
  return { ...BASE, id, ...overrides };
}

async function openDetailFor(page: Page, item: any) {
  await stubBackend(page, { items: [item, ...ITEMS.slice(0, 5)] });
  await page.goto(`/v/${encodeURIComponent(`${item.source}-${item.id}`)}`);
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  const slide = page
    .locator(`#feed .slide[data-slug$="-${String(item.id)}"]`)
    .first();
  await slide.locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

// Exact match on the label span, not a substring filter: "Origin" as a
// substring also matches "Artist origin", which this fixture always has.
const metaRow = (page: Page, label: string) =>
  page.locator("#detailModal .meta-row").filter({
    has: page.locator(".meta-label", { hasText: new RegExp(`^${label}$`) }),
  });

test("Europeana row with a named artist shows Object origin, not Culture", async ({
  page,
}) => {
  const item = testItem("test-eu-origin-person", {
    source: "europeana",
    attribution_type: "person",
    culture: "Netherlands",
    culture_period: "",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Object origin")).toContainText("Netherlands");
  await expect(metaRow(page, "Culture")).toHaveCount(0);
});

test("Europeana row with no named artist still shows Object origin, not the old Origin label", async ({
  page,
}) => {
  const item = testItem("test-eu-origin-culture", {
    source: "europeana",
    attribution_type: "culture",
    culture: "Sweden",
    culture_period: "",
  });
  await openDetailFor(page, item);
  await expect(metaRow(page, "Object origin")).toContainText("Sweden");
});

test("non-Europeana sources keep the existing attribution_type-based label", async ({
  page,
}) => {
  const person = testItem("test-non-eu-origin-person", {
    source: "met",
    attribution_type: "person",
    culture: "Netherlands",
    culture_period: "",
  });
  await openDetailFor(page, person);
  await expect(metaRow(page, "Origin")).toContainText("Netherlands");
  await expect(metaRow(page, "Object origin")).toHaveCount(0);
});

test("non-Europeana culture attribution still shows Culture, unaffected", async ({
  page,
}) => {
  const culture = testItem("test-non-eu-origin-culture", {
    source: "met",
    attribution_type: "culture",
    artist: "Unknown",
    artist_nationality: "",
    artist_lifespan: "",
    culture: "Tang dynasty",
    culture_period: "618-907",
  });
  await openDetailFor(page, culture);
  await expect(metaRow(page, "Culture")).toContainText("Tang dynasty");
});
