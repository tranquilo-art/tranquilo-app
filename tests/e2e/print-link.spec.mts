import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { ITEMS, stubBackend } from "./harness.mts";

type FixtureItem = { id: string | number; title?: string; img?: string };

const BASE = ITEMS.find((i: FixtureItem) => i.title && i.img);

const COUNTRY_OF_REGION: Record<string, string> = {
  uk: "GB",
  us: "US",
  br: "BR",
  eu: "DE",
  ca: "CA",
  au: "AU",
};

let quoteRequests: URL[] = [];

function quoteBody(product: string, country: string) {
  const reais = country === "BR";
  return {
    available: true,
    total: reais ? 120.5 : 24.5,
    item: reais ? 90.5 : 19.6,
    delivery: reais ? 30 : 4.9,
    currency: reais ? "BRL" : "USD",
    minDays: 5,
    maxDays: 9,
    madeIn: "DE",
    product,
  };
}

async function openDetail(
  page: Page,
  {
    master,
    region,
    search = "?print=preview",
    extra = {},
    quote,
  }: {
    master: [number, number] | null;
    region: string | null;
    search?: string;
    extra?: Record<string, unknown>;
    quote?: (product: string, country: string) => Record<string, unknown> | 502;
  },
) {
  const item = {
    ...BASE,
    license: "cc0",
    ...extra,
    master_width: master?.[0] ?? null,
    master_height: master?.[1] ?? null,
  };
  const items = ITEMS.map((i: FixtureItem) => (i.id === BASE.id ? item : i));
  await stubBackend(page, { items });
  const regionRequests: string[] = [];
  await page.route("**/api/items?shape=print_region**", (route: Route) => {
    regionRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        country: region ? COUNTRY_OF_REGION[region] : "JP",
        region,
      }),
    });
  });
  quoteRequests = [];
  await page.route("**/api/items?shape=print_quote**", (route: Route) => {
    const url = new URL(route.request().url());
    quoteRequests.push(url);
    const product = url.searchParams.get("product") ?? "";
    const country = url.searchParams.get("country") ?? "";
    const answer = quote
      ? quote(product, country)
      : quoteBody(product, country);
    if (answer === 502) return route.fulfill({ status: 502, body: "{}" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(answer),
    });
  });
  await page.goto(
    `/v/${encodeURIComponent(`${BASE.source || "met"}-${BASE.id}`)}${search}`,
  );
  await page.waitForFunction(() => (window.__tranquiloFeedRenders || 0) > 0);
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
  return regionRequests;
}

test("is hidden, and the region is never looked up, unless enabled", async ({
  page,
}) => {
  const requests = await openDetail(page, {
    master: [3192, 4000],
    region: "us",
    search: "",
  });
  await expect(page.locator("#detailModal .detail-actions")).toBeVisible();
  await expect(page.locator("#detailModal .btn-print")).toBeHidden();
  expect(requests).toEqual([]);
});

test("offers every product for a large image in a print region", async ({
  page,
}) => {
  await openDetail(page, { master: [3192, 4000], region: "uk" });
  const btn = page.locator("#detailModal .btn-print");
  const panel = page.locator("#detailModal .print-panel");
  await expect(btn).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(btn).toHaveAttribute("aria-expanded", "false");

  await btn.click();
  await expect(panel).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(panel.locator("[data-product]")).toHaveCount(4);
  await expect(panel.locator('[data-product="mini_print"]')).toContainText(
    "Mini print",
  );
  await expect(panel).toContainText(/soon/i);
});

test("lists only the products a smaller image can fill", async ({ page }) => {
  await openDetail(page, { master: [2000, 4000], region: "uk" });
  await page.locator("#detailModal .btn-print").click();
  const products = page.locator("#detailModal .print-panel [data-product]");
  await expect(products).toHaveCount(2);
  await expect(products.nth(0)).toHaveAttribute("data-product", "mini_print");
  await expect(products.nth(1)).toHaveAttribute("data-product", "tote");
});

test("is not offered outside a print region", async ({ page }) => {
  const requests = await openDetail(page, {
    master: [3192, 4000],
    region: null,
  });
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator("#detailModal .detail-actions")).toBeVisible();
  await expect(page.locator("#detailModal .btn-print")).toBeHidden();
});

test("is not offered when the image's full size is unknown", async ({
  page,
}) => {
  await openDetail(page, { master: null, region: "us" });
  await expect(page.locator("#detailModal .detail-actions")).toBeVisible();
  await expect(page.locator("#detailModal .btn-print")).toBeHidden();
});

test("each product shows a thumbnail mock-up of the artwork", async ({
  page,
}) => {
  await openDetail(page, { master: [3192, 4000], region: "uk" });
  await page.locator("#detailModal .btn-print").click();
  const rows = page.locator("#detailModal .print-panel [data-product]");
  await expect(rows).toHaveCount(4);
  for (let n = 0; n < 4; n++) {
    const thumb = rows.nth(n).locator(".print-thumb");
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveAttribute("aria-expanded", "false");
    await expect(thumb.locator("img")).toHaveAttribute("src", /.+/);
  }
});

test("a thumbnail opens a larger mock-up, one at a time", async ({ page }) => {
  await openDetail(page, { master: [3192, 4000], region: "us" });
  await page.locator("#detailModal .btn-print").click();
  const poster = page.locator('#detailModal [data-product="poster"]');
  const tote = page.locator('#detailModal [data-product="tote"]');

  await expect(poster.locator(".print-mockup-large")).toBeHidden();
  await poster.locator(".print-thumb").click();
  await expect(poster.locator(".print-mockup-large")).toBeVisible();
  await expect(poster.locator(".print-thumb")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const thumbSrc = await poster.locator(".print-thumb img").getAttribute("src");
  await expect(poster.locator(".print-mockup-large img")).toHaveAttribute(
    "src",
    thumbSrc!,
  );

  await tote.locator(".print-thumb").click();
  await expect(tote.locator(".print-mockup-large")).toBeVisible();
  await expect(poster.locator(".print-mockup-large")).toBeHidden();
  await expect(poster.locator(".print-thumb")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await tote.locator(".print-thumb").click();
  await expect(tote.locator(".print-mockup-large")).toBeHidden();
});

test("the mock-up follows the artwork's orientation", async ({ page }) => {
  await openDetail(page, { master: [4000, 3000], region: "us" });
  await page.locator("#detailModal .btn-print").click();
  await expect(
    page.locator('#detailModal [data-product="poster"] .mockup').first(),
  ).toHaveAttribute("data-orientation", "hor");
});

test("mock-ups stay blurred while the artwork is behind the nudity gate", async ({
  page,
}) => {
  await openDetail(page, {
    master: [3192, 4000],
    region: "us",
    extra: { category: "Photography", contains_nudity: true },
  });
  await page.locator("#detailModal .btn-print").click();
  const thumbImg = page.locator(
    '#detailModal [data-product="poster"] .print-thumb img',
  );
  const filter = () => thumbImg.evaluate((el) => getComputedStyle(el).filter);
  expect(await filter()).toMatch(/blur/);
  await page.locator("#detailModal .d-frame .nudity-gate-overlay").click();
  await expect.poll(filter).toBe("none");
});

test("shows the live price with approximate delivery", async ({ page }) => {
  await openDetail(page, { master: [3192, 4000], region: "uk" });
  await page.locator("#detailModal .btn-print").click();
  const poster = page.locator('#detailModal [data-product="poster"]');
  await expect(poster.locator(".print-price")).toHaveText("$24.50");
  await expect(poster.locator(".print-delivery")).toContainText("$4.90");
  await expect(poster.locator(".print-delivery")).toContainText("5–9 days");
  await expect(page.locator("#detailModal .print-panel")).toContainText(
    /delivery.*approximate/i,
  );
  expect(
    quoteRequests.map((u) => u.searchParams.get("product")).sort(),
  ).toEqual(["framed", "mini_print", "poster", "tote"]);
  const sent = quoteRequests[0].searchParams;
  expect(sent.get("country")).toBe("GB");
  expect(sent.get("key")).toMatch(/:/);
});

test("quotes Brazil in reais and tells the buyer they owe import taxes", async ({
  page,
}) => {
  await openDetail(page, { master: [3192, 4000], region: "br" });
  await page.locator("#detailModal .btn-print").click();
  await expect(page.locator("#detailModal .print-option")).toHaveCount(2);
  await expect(
    page.locator('#detailModal [data-product="mug"] .print-price'),
  ).toHaveText("R$120.50");
  const panel = page.locator("#detailModal .print-panel");
  await expect(panel).toContainText(/import taxes in Brazil/i);
});

test("marks a product Gelato cannot deliver there as unavailable", async ({
  page,
}) => {
  await openDetail(page, {
    master: [3192, 4000],
    region: "uk",
    quote: (product, country) =>
      product === "tote" ? { available: false } : quoteBody(product, country),
  });
  await page.locator("#detailModal .btn-print").click();
  await expect(
    page.locator('#detailModal [data-product="tote"] .print-price'),
  ).toHaveText(/not available/i);
  await expect(
    page.locator('#detailModal [data-product="poster"] .print-price'),
  ).toHaveText("$24.50");
});

test("says the price is unavailable when the quote fails", async ({ page }) => {
  await openDetail(page, {
    master: [3192, 4000],
    region: "uk",
    quote: () => 502,
  });
  await page.locator("#detailModal .btn-print").click();
  await expect(
    page.locator('#detailModal [data-product="poster"] .print-price'),
  ).toHaveText(/unavailable/i);
});

test("lets the buyer ship to another country and re-quotes", async ({
  page,
}) => {
  await openDetail(page, { master: [3192, 4000], region: "uk" });
  await page.locator("#detailModal .btn-print").click();
  const select = page.locator("#detailModal .print-ship-to select");
  await expect(select).toHaveValue("GB");
  await expect(page.locator("#detailModal .print-option")).toHaveCount(4);

  await select.selectOption("BR");
  await expect(page.locator("#detailModal .print-option")).toHaveCount(2);
  await expect(
    page.locator('#detailModal [data-product="mug"] .print-price'),
  ).toHaveText("R$120.50");
  await expect(page.locator("#detailModal .print-panel")).toContainText(
    /import taxes in Brazil/i,
  );
  expect(
    quoteRequests.some((u) => u.searchParams.get("country") === "BR"),
  ).toBe(true);
});

test("does not mention import taxes outside Brazil", async ({ page }) => {
  await openDetail(page, { master: [3192, 4000], region: "us" });
  await page.locator("#detailModal .btn-print").click();
  await expect(page.locator("#detailModal .print-panel")).not.toContainText(
    /import tax/i,
  );
});

test("is not offered for an artwork that is not in the public domain", async ({
  page,
}) => {
  const requests = await openDetail(page, {
    master: [3192, 4000],
    region: "us",
    extra: { license: "cc-by" },
  });
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator("#detailModal .detail-actions")).toBeVisible();
  await expect(page.locator("#detailModal .btn-print")).toBeHidden();
});
