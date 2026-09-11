// Server side is covered in tests/feedback-endpoint.test.js. What only a
// browser can check: reporting a bug needs no identity, and the referrer
// prefill never carries anything from outside Tranquilo.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, stubBackend } from "./harness.mts";

// Captures what the page would have POSTed, and answers as the real endpoint
// does, so the success path is exercised without sending anyone an email.
async function stubFeedbackApi(page: Page, { ok = true } = {}) {
  const calls: any[] = [];
  await page.route("**/api/submit-collection", async (route: Route) => {
    calls.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({
      status: ok ? 200 : 502,
      contentType: "application/json",
      body: JSON.stringify(ok ? { ok: true } : { error: "nope" }),
    });
  });
  return calls;
}

test("a report can be sent without giving an email address", async ({
  page,
}) => {
  await stubBackend(page);
  const calls = await stubFeedbackApi(page);
  await page.goto("/pages/feedback.html");

  await page.fill("#message", "The images do not load on iOS Safari.");
  await page.click("#submitBtn");

  await expect(page.locator("#formSuccess")).toHaveClass(/show/);
  expect(calls).toHaveLength(1);
  expect(calls[0].kind).toBe("feedback");
  expect(calls[0].message).toBe("The images do not load on iOS Safari.");
  expect(calls[0].email).toBe("");
});

test("an empty message is refused, since it is the only thing needed", async ({
  page,
}) => {
  await stubBackend(page);
  const calls = await stubFeedbackApi(page);
  await page.goto("/pages/feedback.html");

  await page.click("#submitBtn");
  await expect(page.locator('[data-field="message"]')).toHaveClass(/error/);
  expect(calls).toHaveLength(0);
});

test("a blank email is fine but a malformed one is caught", async ({
  page,
}) => {
  // Blank is a supported choice; only a non-empty, malformed address fails.
  await stubBackend(page);
  const calls = await stubFeedbackApi(page);
  await page.goto("/pages/feedback.html");

  await page.fill("#message", "Something is off.");
  await page.fill("#email", "ada@");
  await page.click("#submitBtn");
  await expect(page.locator('[data-field="email"]')).toHaveClass(/error/);
  expect(calls).toHaveLength(0);

  await page.fill("#email", "ada@example.com");
  await page.click("#submitBtn");
  await expect(page.locator("#formSuccess")).toHaveClass(/show/);
  expect(calls[0].email).toBe("ada@example.com");
});

test("a failed send keeps the message the person wrote", async ({ page }) => {
  // Clearing the form on a network error destroys the one thing they wrote.
  await stubBackend(page);
  await stubFeedbackApi(page, { ok: false });
  await page.goto("/pages/feedback.html");

  const written = "Long and carefully written bug report.";
  await page.fill("#message", written);
  await page.click("#submitBtn");

  await expect(page.locator("#submitErrorMsg")).toHaveClass(/show/);
  await expect(page.locator("#message")).toHaveValue(written);
  // And the button goes back to being pressable, rather than stranding them on
  // a permanently disabled "Sending…".
  await expect(page.locator("#submitBtn")).toBeEnabled();
});

test("the context field prefills from wherever on the site you came from", async ({
  page,
}) => {
  // Clicks a real link rather than calling goto(), which sends no referrer
  // and would make the prefill assertion pass vacuously.
  await stubBackend(page);
  await stubFeedbackApi(page);
  await page.goto("/pages/about.html");
  await page.click('.mkt-footer-links a[href="feedback.html"]');

  await expect(page).toHaveURL(/feedback\.html/);
  await expect(page.locator("#context")).toHaveValue("/pages/about.html");
  // Path only -- never the query string.
  expect(await page.inputValue("#context")).not.toContain("?");
});

test("it never prefills from an external referrer", async ({
  page,
  baseURL,
}) => {
  // A referrer from anywhere else is none of our business and would land in
  // a kept email. The fake site is http, not https, since an https->http
  // downgrade makes the browser drop the referrer on its own, letting the
  // test pass without the guard existing.
  await stubBackend(page);
  const target = new URL("/pages/feedback.html", baseURL).href;
  await page.route("http://example.com/external-referrer", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<a id="go" href="${target}">go</a>`,
    }),
  );
  await page.goto("http://example.com/external-referrer");
  await page.click("#go");

  await expect(page).toHaveURL(/feedback\.html/);
  // Confirms a referrer really was sent, so this tests the guard itself.
  expect(await page.evaluate(() => document.referrer)).toContain("example.com");
  await expect(page.locator("#context")).toHaveValue("");
});

test("it is reachable from the static pages' footer", async ({ page }) => {
  // The footer is the single front door: "Contact" was removed with
  // feedback taking its job, making this the only way to reach a human.
  await stubBackend(page);
  await page.goto("/pages/about.html");
  const link = page.locator('.mkt-footer-links a[href="feedback.html"]');
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await expect(link).toHaveText("Feedback");
});

test("the homepage nav stays short", async ({ page }) => {
  // It stacks on mobile past three or four items, which is why Pro and
  // Feedback came out of it.
  await gotoFeed(page);
  const links = page.locator("#feed .slide.intro .intro-links a");
  await expect(links).toHaveCount(3);
  await expect(links).toHaveText([
    "About",
    "Submit a Collection",
    "Support us",
  ]);
});
