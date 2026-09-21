// pages/get-involved.html: replaces pages/volunteer.html (retired -- see
// vercel.json's redirect and tests/donations-flag.test.ts, which checks the
// support.html cross-link stays marked data-donations). Carries the mission
// blurb, the GitHub callout, and the role listings that used to live on the
// volunteer page.

import { expect, test } from "@playwright/test";
import { stubBackend } from "./harness.mts";

test.describe("Get involved page", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/get-involved.html");
  });

  test("carries the committed mission copy verbatim", async ({ page }) => {
    await expect(page.locator(".mkt-lead")).toContainText(
      "looking for art lovers who are interested in volunteering their time",
    );
  });

  test("invites GitHub contributions", async ({ page }) => {
    const github = page.locator(
      'main a[href="https://github.com/tranquilo-art/tranquilo-app"]',
    );
    await expect(github).toHaveCount(1);
    await expect(page.locator("main")).toContainText(
      /welcome your contributions/i,
    );
  });

  test("the cross-link to Support us is marked for the donations gate", async ({
    page,
  }) => {
    const link = page.locator('main a[href="support.html"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("data-donations", "");
  });

  test("lists all three volunteer roles", async ({ page }) => {
    await expect(page.locator(".role-item")).toHaveCount(3);
    const titles = await page.locator(".role-item .mkt-h2").allInnerTexts();
    expect(titles).toEqual([
      "Art Storyteller — Content Curation",
      "UX Researcher — Art Use Cases",
      "Grant Advisor",
    ]);
  });

  test("invites reach-out even without a matching role", async ({ page }) => {
    await expect(page.locator("main")).toContainText(
      /don't see a role here that matches your skills/i,
    );
  });
});
