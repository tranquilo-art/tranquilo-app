// Storyline narrative is AI-drafted and said so nowhere: AI_DISCLOSURE_HTML
// appeared at exactly one site, the detail panel's fact-box, since
// storylines are a different render path. Placed on the storyline's own
// intro page rather than every chapter -- a badge repeated down twelve
// chapters is noise, and the intro is the honest place to say how it was written.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fixtureStoryline, gotoStoryline } from "./harness.mts";

const WITH_SOURCE = fixtureStoryline({ withSourceNote: true });
const NO_SOURCE = fixtureStoryline({ withSourceNote: false });

const intro = (page: Page) =>
  page.locator("#storylineMode .storyline-intro-page");

test("the intro page discloses that the narrative was AI-drafted", async ({
  page,
}) => {
  await gotoStoryline(page, WITH_SOURCE.id);
  await expect(intro(page).locator("[data-ai-disclosure]")).toHaveCount(1);
});

test("the disclosure opens, using the same control as the detail panel", async ({
  page,
}) => {
  // Also asserts the storyline markup is reachable by the document-level
  // delegated click handler -- a badge that renders but doesn't open would
  // look identical in a screenshot.
  await gotoStoryline(page, WITH_SOURCE.id);
  const badge = intro(page).locator("[data-ai-disclosure]");
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "true");
  await expect(intro(page).locator("[data-ai-disclosure-text]")).toBeVisible();
});

test("the disclosure says only what it is approved to say", async ({
  page,
}) => {
  // A storyline's `source_note` used to fold into the disclosure, so a
  // curator's working notes rendered inside the ToS's human-review claim --
  // 1,300 characters of citations on the cubism storyline. The disclosure
  // is now a static string that never appends dynamic content.
  await gotoStoryline(page, WITH_SOURCE.id);
  await intro(page).locator("[data-ai-disclosure]").click();
  const note = intro(page).locator("[data-ai-disclosure-text]");
  await expect(note).toBeVisible();
  await expect(note).toContainText("Drafted with AI help");
  await expect(note).toContainText("Spotted an error?");
  // This storyline has a long source_note, so if any of it reaches the badge this fails.
  await expect(note).not.toContainText("How this connection was verified");
  await expect(note).not.toContainText(WITH_SOURCE.source_note.slice(0, 40));
});

test("a storyline that carries a source_note renders none of it", async ({
  page,
}) => {
  // The element that held it is gone entirely, not merely emptied; an
  // empty container would still be an injection point for the next change.
  await gotoStoryline(page, WITH_SOURCE.id);
  await intro(page).locator("[data-ai-disclosure]").click();
  await expect(intro(page).locator(".storyline-intro-sources")).toHaveCount(0);
});

test("a storyline with nothing to cite reads identically", async ({ page }) => {
  // Previously these two cases differed; they're now the same disclosure,
  // which is the point.
  await gotoStoryline(page, NO_SOURCE.id);
  await intro(page).locator("[data-ai-disclosure]").click();
  const note = intro(page).locator("[data-ai-disclosure-text]");
  await expect(note).toBeVisible();
  await expect(note).toContainText("Drafted with AI help");
  await expect(intro(page).locator(".storyline-intro-sources")).toHaveCount(0);
});

test("chapter pages carry no badge of their own", async ({ page }) => {
  // Deliberate: rendering it per chapter is a product decision that should
  // have to change this test on purpose.
  await gotoStoryline(page, WITH_SOURCE.id);
  await expect(
    page.locator(
      "#storylineTrack .storyline-chapter-page [data-ai-disclosure]",
    ),
  ).toHaveCount(0);
});

test("the disclosure is fully readable, not clipped by the viewport", async ({
  page,
}) => {
  // Originally about a long source_note clipping mid-sentence against a
  // centred intro page's viewport. source_note was later removed from the
  // disclosure, but the positioning it guards -- the disclosure still
  // floats -- is kept, renamed so nobody reads it as covering sources.
  await gotoStoryline(page, WITH_SOURCE.id);
  await intro(page).locator("[data-ai-disclosure]").click();
  const fits = await page.evaluate(() => {
    const n = document.querySelector(
      ".storyline-intro-page [data-ai-disclosure-text]",
    )!;
    const r = n.getBoundingClientRect();
    return {
      bottom: Math.round(r.bottom),
      viewport: window.innerHeight,
      clipped: r.bottom > window.innerHeight || r.top < 0,
    };
  });
  expect(
    fits.clipped,
    `note runs to ${fits.bottom}px in a ${fits.viewport}px viewport`,
  ).toBe(false);
});

test("an open disclosure can be dismissed", async ({ page }) => {
  // The panel covers the badge that opened it at this size, so before this
  // the only way to close it was sitting underneath the thing it just
  // opened -- elementFromPoint at the badge's centre returned the note.
  await gotoStoryline(page, WITH_SOURCE.id);
  const badge = intro(page).locator("[data-ai-disclosure]");
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "true");

  await page.locator("#storylineHeaderTitle").click();
  await expect(badge).toHaveAttribute("aria-expanded", "false");
});

test("clicking inside the note does not dismiss it", async ({ page }) => {
  // Otherwise the corrections mailto link can't be reached: the click that
  // follows it would also close the panel from under it.
  await gotoStoryline(page, WITH_SOURCE.id);
  const badge = intro(page).locator("[data-ai-disclosure]");
  await badge.click();
  await intro(page)
    .locator("[data-ai-disclosure-text]")
    .click({ position: { x: 5, y: 5 } });
  await expect(badge).toHaveAttribute("aria-expanded", "true");
});
