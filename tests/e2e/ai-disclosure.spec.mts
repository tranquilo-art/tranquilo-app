// Disclosing that a narrative was AI-drafted, where the narrative is read,
// not only in the Terms page. The scoping requirement matters most and is
// easiest to get wrong: it must appear on AI-drafted narrative only, never
// on factual metadata pulled from a museum record.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, ITEMS, scrollToSlide } from "./harness.mts";

const _teaItem = ITEMS.find((i: any) => i.caption_tea);
const _basicItem = ITEMS.find((i: any) => !i.caption_tea && i.caption_basic);

// Opens the detail panel on the first slide whose caption is of the wanted
// kind. Matches on rendered slugs against the fixture rather than a fixed
// index, since the feed is shuffled per session with a recycling DOM.
async function openDetailWithCaption(page: Page, wantTea: boolean) {
  const wanted: string[] = ITEMS.filter((i: any) =>
    wantTea ? !!i.caption_tea : !i.caption_tea && !!i.caption_basic,
  ).map((i: any) => `${i.source || "met"}-${i.id}`);

  // Indexed over all slides, not just those with a data-slug: the intro
  // slide has neither, and indexing into a different collection would land
  // on it and time out looking for a control that was never there.
  const idx = await page.evaluate((slugs: string[]) => {
    const set = new Set(slugs);
    const slides = [...document.querySelectorAll<HTMLElement>("#feed .slide")];
    return slides.findIndex((s) => s.dataset.slug && set.has(s.dataset.slug));
  }, wanted);

  expect(
    idx,
    `no slide in the DOM carries a ${wantTea ? "tea" : "basic"} caption`,
  ).toBeGreaterThanOrEqual(0);
  await scrollToSlide(page, idx);
  await page.locator("#feed .slide").nth(idx).locator(".art-title-btn").click();
  await expect(page.locator("#detailModal")).toHaveClass(/open/);
}

test("an AI-drafted caption carries a disclosure", async ({ page }) => {
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const box = page.locator("#detailModal .fact-box").first();
  await expect(box).toBeVisible();
  await expect(box.locator("[data-ai-disclosure]")).toHaveCount(1);
});

test("museum metadata does NOT carry one", async ({ page }) => {
  // caption_basic is assembled from the source record's own fields, so a
  // disclosure there would assert something untrue about museum text.
  await gotoFeed(page);
  await openDetailWithCaption(page, false);
  const box = page.locator("#detailModal .fact-box").first();
  await expect(box).toBeVisible();
  await expect(box).toContainText("Basic Information");
  await expect(box.locator("[data-ai-disclosure]")).toHaveCount(0);
});

test("the disclosure says all four things it needs to", async ({ page }) => {
  // Must survive condensing from the Terms wording: AI-drafted, grounded in
  // sources, human-reviewed, and a way to report an error.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const badge = page.locator("[data-ai-disclosure]").first();
  await badge.click();
  const text = await page
    .locator("[data-ai-disclosure-text]")
    .first()
    .innerText();
  expect(text).toMatch(/AI/);
  expect(text).toMatch(/review/i);
  expect(text).toMatch(/@tranquilo\.art/);

  // No longer asserts "sources": the earlier copy claimed drafting came
  // "from the source institution's own record", but across 40 Tea captions
  // grounding references are mostly elsewhere entirely.
  expect(text).not.toMatch(/source institution/i);
  expect(text.length).toBeLessThan(120); // also too long, not just inaccurate
});

test("it opens by tap and by keyboard, not hover alone", async ({ page }) => {
  // A hover-only badge discloses nothing on a phone; also reachable without
  // a pointer at all.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const badge = page.locator("[data-ai-disclosure]").first();

  expect(await badge.evaluate((el) => el.tagName)).toBe("BUTTON");
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "true");
  await badge.click();
  await expect(badge).toHaveAttribute("aria-expanded", "false");

  await badge.focus();
  await page.keyboard.press("Enter");
  await expect(badge).toHaveAttribute("aria-expanded", "true");
});

test("it stays subtle: small, quiet, and never wider than the label it sits by", async ({
  page,
}) => {
  // A disclosure that shouts competes with the artwork; a badge nobody can
  // ignore reads as a warning rather than a note.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  // openDetailWithCaption's click on .art-title-btn leaves the real cursor
  // sitting wherever that button was; if the badge renders near that same
  // point in the opened modal it picks up a genuine :hover, so move the
  // pointer away and let the 0.15s opacity transition (css/style.css)
  // settle before reading the resting style.
  await page.mouse.move(0, 0);
  const badge = page.locator("[data-ai-disclosure]").first();
  await expect
    .poll(() =>
      badge.evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
    )
    .toBeLessThanOrEqual(0.75);
  const m = await badge.evaluate((el) => {
    const s = getComputedStyle(el);
    const label = el.closest(".fact-box")!.querySelector(".fact-label")!;
    return {
      fontPx: parseFloat(s.fontSize),
      opacity: parseFloat(s.opacity),
      width: el.getBoundingClientRect().width,
      labelWidth: label.getBoundingClientRect().width,
    };
  });
  expect(m.fontPx).toBeLessThanOrEqual(14);
  expect(m.opacity).toBeLessThanOrEqual(0.75);
  expect(m.width).toBeLessThan(m.labelWidth);
});

test("the badge is an icon, not the word AI", async ({ page }) => {
  // "AI" beside "Did you know?" reads as a label on the caption rather than
  // a control that explains it.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const badge = page.locator("[data-ai-disclosure]").first();
  await expect(badge).not.toContainText("AI");
  expect(await badge.locator("svg").count()).toBe(1);
  const label = await badge.getAttribute("aria-label");
  expect(label).toMatch(/writ|AI/i);
});

test("on a pointer device, hovering reveals it without a click", async ({
  page,
}) => {
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const badge = page.locator("[data-ai-disclosure]").first();
  const note = page.locator("[data-ai-disclosure-text]").first();

  await expect(note).toBeHidden();
  await badge.hover();
  await expect(note).toBeVisible();
});

test("keyboard focus reveals it too, since a keyboard cannot hover", async ({
  page,
}) => {
  // Keyed on :focus-visible, not :focus: plain :focus would let a mouse
  // click pin the tooltip open with no way to close it. Requires
  // establishing keyboard modality first, since a bare .focus() is
  // programmatic and browsers correctly decline to treat it as :focus-visible.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  const note = page.locator("[data-ai-disclosure-text]").first();

  await page.keyboard.press("Tab"); // keyboard modality
  await page.locator("[data-ai-disclosure]").first().focus();
  await expect(note).toBeVisible();
});

test("the disclosure itself is legible, even though the badge is quiet", async ({
  page,
}) => {
  // Subtle-until-asked and clear-once-asked are different jobs. This
  // shipped at 2.36:1 on first measurement against WCAG AA's 4.5:1 minimum
  // for small text.
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  await page.locator("[data-ai-disclosure]").first().click();

  const ratio = await page
    .locator("[data-ai-disclosure-text]")
    .first()
    .evaluate((el) => {
      const lum = (rgb: number[]) => {
        const [r, g, b] = rgb.map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const s = getComputedStyle(el);
      const op = parseFloat(s.opacity);
      const fg = s.color.match(/\d+/g)!.map(Number);
      const bg = (
        getComputedStyle(el.closest(".fact-box")!).backgroundColor.match(
          /\d+/g,
        ) || [20, 19, 17]
      ).map(Number);
      const mix = fg.map((c, i) => c * op + bg[i] * (1 - op));
      const L1 = lum(mix),
        L2 = lum(bg);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("the corrections email is underlined once, not twice", async ({
  page,
}) => {
  // `.detail-modal-inner a`'s border-bottom and `.ai-badge-note a`'s
  // text-decoration:underline are both specificity 0,1,1, so the link
  // renders with two stacked lines. Counts underline sources rather than
  // asserting one specific property, so this holds if the styling later
  // flips (border only, no text-decoration).
  await gotoFeed(page);
  await openDetailWithCaption(page, true);
  await page.locator("[data-ai-disclosure]").first().click();

  const link = page.locator("[data-ai-disclosure-text] a").first();
  await expect(link).toBeVisible();

  const lines = await link.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      textDecoration: s.textDecorationLine.includes("underline"),
      border:
        parseFloat(s.borderBottomWidth) > 0 && s.borderBottomStyle !== "none",
    };
  });
  expect(Object.values(lines).filter(Boolean)).toHaveLength(1);
});

// A touch device has no hover, so tap-to-expand has to carry it. Emulated
// with a real touch context rather than a narrow viewport, since `hover:
// none` is what the CSS switches on and width is a poor proxy for it.
test.describe("on a touch device", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("tapping expands it in flow", async ({ page }) => {
    await gotoFeed(page);
    await openDetailWithCaption(page, true);
    const badge = page.locator("[data-ai-disclosure]").first();
    const note = page.locator("[data-ai-disclosure-text]").first();

    await expect(note).toBeHidden();
    await badge.tap();
    await expect(note).toBeVisible();
    await expect(badge).toHaveAttribute("aria-expanded", "true");
    await badge.tap();
    await expect(note).toBeHidden();
  });

  test("the expanded note pushes the caption rather than covering it", async ({
    page,
  }) => {
    // In flow on purpose: a floating tooltip on a 390px screen would sit
    // over the sentence it describes, with nowhere else to go.
    await gotoFeed(page);
    await openDetailWithCaption(page, true);

    // Scrolls the badge into view before measuring, since tap() would
    // otherwise scroll the panel itself and conflate that scroll delta with
    // the caption's actual movement (boundingBox() is viewport-relative).
    const badge = page.locator("[data-ai-disclosure]").first();
    await badge.scrollIntoViewIfNeeded();

    const caption = page.locator("#detailModal .fact-box p").first();
    const settledY = async () => {
      let last = null;
      for (let i = 0; i < 40; i++) {
        const y = (await caption.boundingBox())!.y;
        if (last !== null && y === last) return y;
        last = y;
        await page.waitForTimeout(50);
      }
      throw new Error("detail panel never stopped moving");
    };
    const before = await settledY();
    await badge.tap();
    await expect(
      page.locator("[data-ai-disclosure-text]").first(),
    ).toBeVisible();
    const after = (await caption.boundingBox())!.y;
    expect(after).toBeGreaterThan(before);
  });
});
