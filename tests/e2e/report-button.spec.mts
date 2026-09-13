// The flag/report button in the detail view. Server side is fully covered
// by tests/feedback-endpoint.test.ts; this file covers what only a browser
// can: the button lives next to share, the menu is multi-select checkboxes,
// Send is what submits, and the confirmation is the shared toast.

import type { Page, Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

async function openDetail(page: Page) {
  await page.locator("#feed .slide").nth(3).locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

// Not stubbed in harness.mts's stubBackend(); captures the body so tests can
// assert on the payload, not just that a request happened.
async function stubReportEndpoint(page: Page) {
  const requests: any[] = [];
  await page.route("**/api/submit-collection", (route: Route) => {
    requests.push(JSON.parse(route.request().postData() || "{}"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });
  return requests;
}

test.describe("the report button", () => {
  test("sits next to share, as a flag icon, closed by default", async ({
    page,
  }) => {
    await gotoFeed(page);
    await openDetail(page);
    const actions = page
      .locator(
        "#detailModal .detail-modal-page.active .caption-actions, " +
          "#detailModal .caption-actions",
      )
      .first();
    await expect(actions.locator(".btn-share")).toBeVisible();
    const reportBtn = actions.locator(".btn-report");
    await expect(reportBtn).toBeVisible();
    await expect(reportBtn).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".report-menu").first()).toBeHidden();
  });

  test("opens a menu with a checkbox for each category, plus a comment box", async ({
    page,
  }) => {
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await expect(menu).toBeVisible();

    const checkboxes = menu.locator('.report-checkbox input[type="checkbox"]');
    await expect(checkboxes).toHaveCount(4);
    for (const c of await checkboxes.all()) {
      await expect(c).not.toBeChecked();
    }
    await expect(menu.getByText("There's an issue with image")).toBeVisible();
    await expect(menu.getByText("There's an issue with content")).toBeVisible();
    await expect(
      menu.getByText("I'm having a technical issue (broken link)"),
    ).toBeVisible();
    await expect(menu.getByText("Tell us more")).toBeVisible();
    await expect(menu.locator(".report-comment")).toBeVisible();
    await expect(menu.locator(".report-send")).toBeVisible();
  });

  test("more than one checkbox can be checked at once", async ({ page }) => {
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu.getByText("There's an issue with image").click();
    await menu.getByText("I'm having a technical issue (broken link)").click();
    await expect(
      menu.locator('input[value="There\'s an issue with image"]'),
    ).toBeChecked();
    await expect(
      menu.locator(
        'input[value="I\'m having a technical issue (broken link)"]',
      ),
    ).toBeChecked();
    await expect(
      menu.locator('input[value="There\'s an issue with content"]'),
    ).not.toBeChecked();
  });

  test("closes again on a second click of the flag", async ({ page }) => {
    await gotoFeed(page);
    await openDetail(page);
    const reportBtn = page.locator(".btn-report").first();
    await reportBtn.click();
    await expect(page.locator(".report-menu").first()).toBeVisible();
    await reportBtn.click();
    await expect(page.locator(".report-menu").first()).toBeHidden();
  });

  test("closes on an outside click", async ({ page }) => {
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    await expect(page.locator(".report-menu").first()).toBeVisible();
    // Unscoped ".art-title" also matches the feed slide's caption title
    // behind the open modal (#feed renders before #detailModal in
    // index.html), so it has to be scoped to the modal's own heading.
    await page.locator("#detailModal .art-title").first().click();
    await expect(page.locator(".report-menu").first()).toBeHidden();
  });

  test("checking a box alone does not submit -- only Send does", async ({
    page,
  }) => {
    const requests = await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    await page
      .locator(".report-menu")
      .first()
      .getByText("There's an issue with image")
      .click();
    await page.waitForTimeout(200);
    expect(requests.length).toBe(0);
  });

  test("Send submits the checked categories and comment, shows the toast, and closes", async ({
    page,
  }) => {
    const requests = await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu.getByText("There's an issue with image").click();
    await menu.getByText("I'm having a technical issue (broken link)").click();
    await menu
      .locator(".report-comment")
      .fill("The colors look washed out on my phone.");
    await menu.locator(".report-send").click();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].kind).toBe("report");
    expect(requests[0].categories).toEqual([
      "There's an issue with image",
      "I'm having a technical issue (broken link)",
    ]);
    expect(requests[0].comment).toBe("The colors look washed out on my phone.");
    expect(requests[0].itemSource).toBeTruthy();
    expect(requests[0].itemNativeId).toBeTruthy();
    expect(requests[0].itemUrl).toContain("/v/");

    // The shared toast (app.ts's toastEl), same one the share button uses.
    await expect(page.locator("#toast")).toHaveClass(/show/);
    await expect(page.locator("#toast")).toHaveText(
      "Thanks, your feedback has been sent. We'll take a look.",
    );
    await expect(menu).toBeHidden();
  });

  test("a comment alone, with no category checked, still submits", async ({
    page,
  }) => {
    const requests = await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu
      .locator(".report-comment")
      .fill("The lightbox never opens on this one.");
    await menu.locator(".report-send").click();

    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].categories).toEqual([]);
    expect(requests[0].comment).toBe("The lightbox never opens on this one.");
  });

  test("Send does nothing when neither a category nor a comment is given", async ({
    page,
  }) => {
    const requests = await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu.locator(".report-send").click();
    await page.waitForTimeout(200);
    expect(requests.length).toBe(0);
    await expect(menu).toBeVisible(); // nothing to confirm, so it stays open
  });

  test("resets checkboxes and comment the next time the menu is opened", async ({
    page,
  }) => {
    await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu.getByText("There's an issue with image").click();
    await menu.locator(".report-comment").fill("leftover text");
    await menu.locator(".report-send").click();
    await expect(menu).toBeHidden();

    await page.locator(".btn-report").first().click();
    await expect(
      menu.locator('input[value="There\'s an issue with image"]'),
    ).not.toBeChecked();
    await expect(menu.locator(".report-comment")).toHaveValue("");
  });

  test("does not affect the item's own state -- purely fire-and-forget", async ({
    page,
  }) => {
    // A report never touches quarantine/live status; guards against a
    // future change accidentally wiring one up.
    const requests = await stubReportEndpoint(page);
    await gotoFeed(page);
    await openDetail(page);
    const title = await page.locator(".art-title").first().textContent();
    await page.locator(".btn-report").first().click();
    const menu = page.locator(".report-menu").first();
    await menu.getByText("I'm having a technical issue (broken link)").click();
    await menu.locator(".report-send").click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator(".art-title").first()).toHaveText(title || "");
  });
});
