// The support strip and its Donate chooser. Every button is a plain <a> to
// a Stripe-hosted Payment Link -- no fetch, no key, no serverless function
// -- since api/ is at Vercel Hobby's 12-function cap and linking out keeps
// us inside Vercel's donations carve-out. These tests check that every
// path reaches a real, correctly-shaped Stripe URL, and that the one
// catastrophic misconfiguration cannot ship.

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { gotoFeed, scrollToSlide, stubBackend } from "./harness.mts";

const strip = (page: Page) => page.locator("[data-support-strip]").first();
const dialog = (page: Page) => page.locator("#supportDialog");

async function openChooser(page: Page) {
  await strip(page).locator("[data-support-open]").click();
  await expect(dialog(page)).toHaveClass(/open/);
}

test.describe("Support Us page", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/support.html");
  });

  test("carries the committed mission copy verbatim", async ({ page }) => {
    // Quoted from the source copy, so a reword here without changing it
    // there would go unnoticed.
    await expect(page.locator(".mkt-lead")).toContainText("ad-free by choice");
    await expect(page.locator(".mkt-lead")).toContainText(
      "hosting and the quiet cost of keeping this running",
    );
  });

  test("offers a real button when open, and says so when not", async ({
    page,
  }) => {
    // Holds in both states, since the gate can be closed again in a hurry
    // and a one-state test has to be rewritten at exactly the worst moment.
    const soon = await page.evaluate(
      () => window.TranquiloSupport!.COMING_SOON,
    );
    if (soon) {
      await expect(strip(page)).toContainText(/donations open soon/i);
      await expect(strip(page).locator("[data-support-open]")).toHaveCount(0);
    } else {
      await expect(strip(page).locator("[data-support-open]")).toHaveCount(1);
      await expect(strip(page)).not.toContainText(/donations open soon/i);
    }
    await expect(strip(page)).not.toContainText(/patreon|catarse/i);
  });

  test("the links stay configured behind the flag", async ({ page }) => {
    // Only COMING_SOON hides the chooser; if the links were dropped too,
    // flipping the flag would ship an empty one.
    const links = await page.evaluate(() =>
      window.TranquiloSupport!.allLinks(),
    );
    expect(links).toHaveLength(4);
    for (const l of links)
      expect(l).toMatch(/^https:\/\/(buy|donate)\.stripe\.com\//);
  });

  test("the Support Us page leads with the button, not a second sentence", async ({
    page,
  }) => {
    // .mkt-lead already says the same thing at more length; a strip line
    // here would be a third restatement above the fold. Scoped to this page
    // only -- the homepage strip has no surrounding copy and still needs it.
    await expect(strip(page).locator(".support-strip-line")).toHaveCount(0);
    await expect(strip(page).locator("[data-support-open]")).toHaveCount(1);
  });
});

test.describe("the Donate chooser", () => {
  // Built, tested, and dormant behind COMING_SOON until Stripe returns the
  // live Payment Links; skipping rather than deleting since the feature is
  // finished.
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/support.html");
    const soon = await page.evaluate(
      () => window.TranquiloSupport!.COMING_SOON,
    );
    test.skip(soon, "donations not open yet -- COMING_SOON is set");
  });

  test("offers one-time and monthly as a single entry point", async ({
    page,
  }) => {
    // One button, both modes behind it: a single Stripe Payment Link can't do both.
    await openChooser(page);
    await expect(dialog(page)).toContainText("Give once");
    await expect(dialog(page)).toContainText("Give monthly");
  });

  test("every path reaches a real Stripe link", async ({ page }) => {
    await openChooser(page);
    const hrefs = await dialog(page)
      .locator("a[href]")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThanOrEqual(4); // 1 one-time + 3 tiers
    for (const href of hrefs) {
      expect(href, `${href} is not a Stripe payment link`).toMatch(
        /^https:\/\/(buy|donate)\.stripe\.com\//,
      );
    }
    // No duplicates: two tiers pointing at the same link silently charges
    // the wrong amount.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test("only the one-time option promises a choosable amount", async ({
    page,
  }) => {
    // Stripe cannot do customer-chooses-amount on a recurring price.
    await openChooser(page);
    await expect(dialog(page).locator(".support-once")).toContainText(
      /choose your own/i,
    );
    const tierText = await dialog(page).locator(".support-tiers").innerText();
    expect(tierText).not.toMatch(/choose your own/i);
    await expect(dialog(page).locator(".support-tier")).toHaveCount(3);
    for (const t of await dialog(page).locator(".support-tier").all()) {
      await expect(t).toContainText(/^R\$\d+/);
      await expect(t).toContainText("per month");
    }
  });

  test("opens payment in a new tab, with rel=noopener", async ({ page }) => {
    await openChooser(page);
    for (const a of await dialog(page).locator("a[href]").all()) {
      await expect(a).toHaveAttribute("target", "_blank");
      await expect(a).toHaveAttribute("rel", /noopener/);
    }
  });

  test("closes on Escape and on the backdrop, but not on its own body", async ({
    page,
  }) => {
    // Without a target check on the backdrop handler, clicking a tier
    // closes the dialog underneath the navigation it just started.
    await openChooser(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).not.toHaveClass(/open/);

    await openChooser(page);
    await dialog(page)
      .locator(".support-dialog-inner")
      .click({ position: { x: 5, y: 5 } });
    await expect(dialog(page)).toHaveClass(/open/);

    await dialog(page).click({ position: { x: 3, y: 3 } });
    await expect(dialog(page)).not.toHaveClass(/open/);
  });

  test("returns focus to the button that opened it", async ({ page }) => {
    await openChooser(page);
    await page.keyboard.press("Escape");
    const focused = await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-support-open"),
    );
    expect(focused).toBe(true);
  });
});

test.describe("the sandbox-link guard", () => {
  // The single catastrophic failure: a sandbox link on the live domain
  // looks normal and accepts no money, with no UI sign until a donor says
  // they paid when no payment exists.
  test("sandbox links are allowed on preview and local hosts", async ({
    page,
  }) => {
    // liveConfigProblem() is pure, so this keeps testing the guard even
    // while COMING_SOON means it isn't consulted at mount time.
    await stubBackend(page);
    await page.goto("/pages/support.html");
    const problem = await page.evaluate(() =>
      window.TranquiloSupport!.liveConfigProblem(
        "tranquilo-git-branch.vercel.app",
      ),
    );
    expect(problem).toBeNull();
    // The strip's contents, unlike liveConfigProblem(), do depend on
    // COMING_SOON. Asserted in both directions so this stays meaningful the
    // day the switch flips instead of turning red at that exact moment.
    const comingSoon = await page.evaluate(
      () => window.TranquiloSupport!.COMING_SOON,
    );
    await expect(strip(page).locator("[data-support-open]")).toHaveCount(
      comingSoon ? 0 : 1,
    );
  });

  test("sandbox links on the live domain disable donation entirely", async ({
    page,
  }) => {
    // Fails closed: not offering to take money is a recoverable
    // embarrassment; appearing to take it and not taking it is not.
    await stubBackend(page);
    await page.goto("/pages/support.html");
    const problem = await page.evaluate(() =>
      window.TranquiloSupport!.liveConfigProblem("tranquilo.art"),
    );
    const usingSandbox = await page.evaluate(() =>
      window
        .TranquiloSupport!.allLinks()
        .some(window.TranquiloSupport!.isTestLink),
    );
    // Both directions asserted, so this stays meaningful after launch too.
    if (usingSandbox) {
      expect(problem).toMatch(/sandbox payment link/);
    } else {
      expect(problem).toBeNull();
    }
  });

  test("www and apex are both treated as production", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/support.html");
    const hosts = await page.evaluate(() =>
      ["tranquilo.art", "www.tranquilo.art"].map(
        window.TranquiloSupport!.isProductionHost,
      ),
    );
    expect(hosts).toEqual([true, true]);
  });
});

test.describe("on the homepage", () => {
  // The intro slide's donate button was replaced by three action cards
  // (Mission/Connect/Support); the Give card is a plain link out to
  // pages/support.html rather than an inline chooser, so the strip/dialog
  // itself is only exercised on that page (see "Support Us page" and "the
  // Donate chooser" above).
  test("shows all three action cards", async ({ page }) => {
    await gotoFeed(page);
    const cards = page.locator("#feed .slide.intro .action-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText("Mission");
    await expect(cards.nth(1)).toContainText("Connect");
    await expect(cards.nth(2)).toContainText("Support");
  });

  test("the Give card matches whichever state the donations gate is in", async ({
    page,
  }) => {
    await gotoFeed(page);
    const giveCard = page.locator("#feed .slide.intro .action-card", {
      hasText: "Support",
    });
    // The kill switch hides the whole card via [data-donations]; whether
    // it's currently armed is read from the CSS rather than assumed.
    const gateOn = await page.evaluate(() => {
      const rule = [...document.styleSheets]
        .flatMap((s) => {
          try {
            return [...s.cssRules];
          } catch {
            return [];
          }
        })
        .find(
          (r) =>
            r instanceof CSSStyleRule && r.selectorText === "[data-donations]",
        ) as CSSStyleRule | undefined;
      return rule?.style.display === "none";
    });
    if (gateOn) {
      await expect(giveCard).toBeHidden();
    } else {
      await expect(
        giveCard.locator('a[href="/pages/support.html"]'),
      ).toHaveCount(1);
    }
  });

  test("Connect opens the newsletter modal, not the donate chooser", async ({
    page,
  }) => {
    await gotoFeed(page);
    await page.locator("[data-open-newsletter]").click();
    await expect(page.locator("#newsletterDialog")).toHaveClass(/open/);
    // The donate dialog is created lazily on first [data-support-open]
    // click; with no such trigger left on the homepage, it never exists at
    // all here (unlike on pages/support.html, where it still does).
    await expect(dialog(page)).toHaveCount(0);
  });

  test("Support us is reachable from the app's own nav", async ({ page }) => {
    await gotoFeed(page);
    await expect(
      page.locator('#feed .slide.intro a[href="/pages/support.html"]'),
    ).toHaveCount(1);
  });
});

test.describe("the homepage newsletter modal", () => {
  test("subscribes with a distinct source tag", async ({ page }) => {
    let posted: unknown = null;
    await gotoFeed(page);
    // Registered after gotoFeed (whose stubBackend() already routes
    // **/api/subscribe** to a bare 204): Playwright runs the
    // most-recently-added matching handler first, so this one has to be
    // added after stubBackend's for it to actually see the request.
    await page.route("**/api/subscribe", async (route) => {
      posted = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.locator("[data-open-newsletter]").click();
    await page.fill("#newsletterEmail", "reader@example.com");
    await page.click("#newsletterSubmitBtn");
    await expect(page.locator("#newsletterSuccess")).toBeVisible();
    expect(posted).toEqual({
      email: "reader@example.com",
      source: "homepage_newsletter",
    });
  });

  test("closes on Escape and returns focus", async ({ page }) => {
    await gotoFeed(page);
    await page.locator("[data-open-newsletter]").click();
    await expect(page.locator("#newsletterDialog")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#newsletterDialog")).not.toHaveClass(/open/);
    const focused = await page.evaluate(() =>
      document.activeElement?.hasAttribute("data-open-newsletter"),
    );
    expect(focused).toBe(true);
  });
});

test.describe("the thank-you page", () => {
  test("exists and explains the Boleto delay", async ({ page }) => {
    // Boleto clears in days, not instantly; saying so keeps a pending
    // donation from reading as a failure.
    await stubBackend(page);
    await page.goto("/pages/thank-you.html");
    await expect(page.locator("h1")).toContainText("Thank you");
    await expect(page.locator("main")).toContainText(/boleto/i);
    await expect(page.locator("main")).toContainText(/few days/i);
  });
});

test.describe("site navigation after the nav/footer trim", () => {
  // The nav and footer were pared back for stacking on mobile; pinned here
  // since a deliberate trim and an accidental loss look identical in a diff.
  const PAGES = [
    "about",
    "submit",
    "get-involved",
    "pro",
    "terms",
    "privacy",
    "support",
    "feedback",
    "thank-you",
  ];

  for (const slug of PAGES) {
    test(`${slug}.html carries the agreed nav and footer`, async ({ page }) => {
      await stubBackend(page);
      await page.goto(`/pages/${slug}.html`);

      await expect(page.locator(".mkt-nav-links a")).toHaveText([
        "Home",
        "About",
        "Submit",
        "Get involved",
        "Support us",
      ]);
      await expect(page.locator(".mkt-footer-links a")).toHaveText([
        "Feedback",
        "Terms & Privacy",
        "Pro Waitlist",
      ]);

      // A stray mailto: would quietly reinstate an address nobody is watching.
      await expect(
        page.locator(".mkt-footer-links a[href^='mailto:']"),
      ).toHaveCount(0);
    });
  }

  test("the privacy policy survives the merged footer entry", async ({
    page,
  }) => {
    // One footer entry covers two documents, but LGPD requires the privacy
    // policy stay independently addressable.
    await stubBackend(page);
    await page.goto("/pages/terms.html");
    const through = page.locator('main a[href="privacy.html"]');
    await expect(through).toHaveCount(1);
    await expect(through).toBeVisible();
    await through.click();
    await expect(page).toHaveURL(/privacy\.html/);
  });
});

test.describe("About page", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/about.html");
  });

  test("is written in the first person throughout", async ({ page }) => {
    // Written in Mel's own voice, not "a small team who cares"; a leftover
    // "we" reads as a company pretending to be a person.
    const main = await page.locator("main").innerText();
    expect(main).toContain("I'm Mel");
    expect(main).not.toMatch(/\bwe don't accept\b/i);
    expect(main).not.toMatch(/\bsmall team\b/i);
  });

  test("every Tranquilo Pro reference is gone", async ({ page }) => {
    // Pro was demoted to a waitlist; the page once still described it as a
    // shipping paid tier.
    const main = await page.locator("main").innerText();
    expect(main).not.toMatch(/tranquilo pro/i);
    expect(main).not.toMatch(/\bbeta\b/i);
  });

  test("its three inline links all point somewhere real", async ({ page }) => {
    // These are the page's calls to action, appearing mid-sentence; a dead
    // one is invisible.
    for (const href of [
      "terms.html",
      "support.html",
      "feedback.html",
      "submit.html",
    ]) {
      await expect(
        page.locator(`main a[href="${href}"]`).first(),
        `${href} link missing from About`,
      ).toHaveCount(1);
    }
  });

  test("bug reports route to the feedback form, not an email", async ({
    page,
  }) => {
    const faq = await page.locator(".faq-list").innerText();
    expect(faq).toMatch(/feedback form/i);
    await expect(page.locator("main a[href^='mailto:']")).toHaveCount(0);
  });

  test("the licence list matches what the submit form actually accepts", async ({
    page,
  }) => {
    // If the FAQ omits a licence the form accepts, someone self-rejects a
    // valid collection.
    const faq = await page.locator(".faq-list").innerText();
    await page.goto("/pages/submit.html");
    const offered = await page
      .locator("#licenseType option")
      .evaluateAll((os: HTMLOptionElement[]) =>
        os.map((o) => o.value).filter((v) => v && v !== "Other"),
      );
    // Case-insensitive: the form's values are title-case, the FAQ runs
    // prose lowercase.
    const faqLower = faq.toLowerCase();
    for (const licence of offered) {
      expect(
        faqLower,
        `submit.html offers "${licence}" but About does not list it`,
      ).toContain(licence.toLowerCase());
    }
  });

  test("the newsletter form still posts to the capture endpoint", async ({
    page,
  }) => {
    let posted = null;
    await page.route("**/api/subscribe", async (route) => {
      posted = JSON.parse(route.request().postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.fill("#notifyEmail", "reader@example.com");
    await page.click("#notifySubmitBtn");
    await expect(page.locator("#notifySuccess")).toBeVisible();
    expect(posted).toEqual({
      email: "reader@example.com",
      source: "feature_notify",
    });
  });

  test("the opening runs as one continuous piece of writing", async ({
    page,
  }) => {
    // The intro and origin story were in two <section>s, so .mkt-section's
    // 56px break landed mid-paragraph. Asserted structurally rather than as
    // a pixel gap, so it survives type-scale changes.
    const sameSection = await page.evaluate(() => {
      const lead = document.querySelector("main .mkt-lead");
      const firstBody = document.querySelector("main .about-body");
      if (!lead || !firstBody) return null;
      return lead.closest("section") === firstBody.closest("section");
    });
    expect(
      sameSection,
      "the lead and the first body paragraph are in different sections, " +
        "which puts a section-sized gap mid-sentence",
    ).toBe(true);
  });

  test("the styled-copy classes actually exist in the stylesheet", async ({
    page,
  }) => {
    // Caught .mkt-lede on the Support page, which matched no CSS rule at
    // all -- a class name is not a style.
    for (const sel of [".mkt-lead", ".about-body", ".about-list"]) {
      const styled = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        return getComputedStyle(el).fontFamily;
      }, sel);
      expect(styled, `${sel} matched no element`).toBeTruthy();
      expect(styled, `${sel} has no font-family, so no rule applies`).not.toBe(
        "",
      );
    }
  });
});

test.describe("logo", () => {
  const PAGES = [
    "about",
    "submit",
    "get-involved",
    "pro",
    "terms",
    "privacy",
    "support",
    "feedback",
    "thank-you",
  ];

  for (const slug of PAGES) {
    test(`${slug}.html shows the mark and has a favicon`, async ({ page }) => {
      await stubBackend(page);
      await page.goto(`/pages/${slug}.html`);
      // The mark is decorative beside the word "Tranquilo": the text is the
      // accessible name, so the image must not announce itself twice.
      const mark = page.locator(".wordmark .wordmark-mark");
      await expect(mark).toHaveCount(1);
      await expect(mark).toHaveAttribute("alt", "");
      await expect(page.locator('link[rel="icon"]')).toHaveCount(1);
      await expect(page.locator(".wordmark")).toContainText("Tranquilo");
    });
  }

  test("the mark actually loads rather than showing a broken image", async ({
    page,
  }) => {
    // A wrong relative path would render a broken image invisibly, since
    // alt is empty by design.
    await stubBackend(page);
    await page.goto("/pages/about.html");
    const ok = await page
      .locator(".wordmark-mark")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      );
    expect(ok, "the wordmark mark failed to load").toBe(true);
  });

  test("the homepage carries the full lockup, and keeps a real heading", async ({
    page,
  }) => {
    // The lockup is an image; "A calmer way to scroll" is still the page's
    // heading for search engines and screen readers.
    await gotoFeed(page);
    const lockup = page.locator("#feed .slide.intro .intro-lockup");
    await expect(lockup).toHaveCount(1);
    await expect(lockup).toHaveAttribute("alt", "");
    const h1 = page.locator("#feed .slide.intro h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toContainText("calmer way");
    await expect(h1).not.toBeInViewport();
  });

  test("the top-bar mark is violet, not white", async ({ page }) => {
    // The bar is a 55% scrim over whatever painting is behind it; white
    // disappears over a pale one, and the supplied blue measures 2.41:1.
    await gotoFeed(page);
    const src = await page.locator(".wordmark-mark").getAttribute("src");
    expect(src).toContain("violet");
  });
});

test.describe("the top bar sheds the word once you reach the art", () => {
  test("shows tulip AND word on the intro slide", async ({ page }) => {
    await gotoFeed(page);
    await expect(page.locator(".topbar")).not.toHaveClass(/compact/);
    await expect(page.locator(".topbar .wordmark span")).toBeVisible();
  });

  test("collapses to the tulip alone once past the first slide", async ({
    page,
  }) => {
    await gotoFeed(page);
    await scrollToSlide(page, 2);
    await expect(page.locator(".topbar")).toHaveClass(/compact/);
    await expect(page.locator(".topbar .wordmark-mark")).toBeVisible();
    // The class toggles immediately, but the collapse itself is a 0.32s
    // max-width transition (css/style.css) -- poll rather than read a
    // single frame that can land mid-animation.
    const wordmarkSpan = page.locator(".topbar .wordmark span");
    await expect
      .poll(() =>
        wordmarkSpan.evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBeLessThan(2);
  });

  test("comes back when you scroll home", async ({ page }) => {
    await gotoFeed(page);
    await scrollToSlide(page, 2);
    await expect(page.locator(".topbar")).toHaveClass(/compact/);
    await scrollToSlide(page, 0);
    await expect(page.locator(".topbar")).not.toHaveClass(/compact/);
  });

  test("the link keeps a name even with the word collapsed", async ({
    page,
  }) => {
    // Collapsing the only text in a link would leave a screen reader
    // announcing an unnamed link.
    await gotoFeed(page);
    await scrollToSlide(page, 2);
    await expect(page.locator(".topbar .wordmark")).toHaveAttribute(
      "aria-label",
      /Tranquilo/,
    );
  });

  test("the static pages are unaffected", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/about.html");
    await expect(page.locator(".mkt-nav .wordmark")).toContainText("Tranquilo");
    await expect(page.locator(".topbar")).toHaveCount(0);
  });
});

test.describe("the brand typeface", () => {
  test("Glacial Indifference actually loads", async ({ page }) => {
    // If it 404s the wordmark silently falls back to Work Sans and looks
    // almost-right, the hardest kind of wrong to notice.
    await gotoFeed(page);
    await page.evaluate(() => document.fonts.ready);
    const ok = await page.evaluate(() =>
      document.fonts.check("16px 'Glacial Indifference'"),
    );
    expect(ok, "the brand face did not load").toBe(true);
  });

  test("the lockup is an icon plus live text, not one flat image", async ({
    page,
  }) => {
    await gotoFeed(page);
    const word = page.locator(".intro-lockup-word");
    await expect(word).toHaveText("Tranquilo.art");
    // Rendered uppercase by CSS; the DOM keeps readable casing so a screen
    // reader says "Tranquilo dot art", not letter by letter.
    await expect(word).toHaveCSS("text-transform", "uppercase");
    await expect(page.locator(".intro-lockup")).toHaveAttribute("alt", "");
  });

  test("both surfaces use the same face and the same tracking", async ({
    page,
  }) => {
    await gotoFeed(page);
    await page.evaluate(() => document.fonts.ready);
    const [word, bar] = await Promise.all([
      page.locator(".intro-lockup-word").evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontFamily, s.letterSpacing, s.textTransform];
      }),
      page.locator(".topbar .wordmark span").evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.fontFamily, s.letterSpacing, s.textTransform];
      }),
    ]);
    expect(word[0]).toContain("Glacial Indifference");
    expect(bar[0]).toContain("Glacial Indifference");
    expect(word[2]).toBe("uppercase");
    expect(bar[2]).toBe("uppercase");
  });
});

test.describe("the collection bookmark", () => {
  async function save(page: Page, i: number) {
    await scrollToSlide(page, i);
    await page.locator("#feed .slide").nth(i).locator(".btn-collect").click();
  }
  const btn = (page: Page) => page.locator("#collectionToggle");
  const count = (page: Page) => page.locator("#collectionCount");

  test("the My Collection chip is gone", async ({ page }) => {
    // The bookmark is the single route in now; two controls for one
    // destination was the thing to remove.
    await gotoFeed(page);
    await expect(page.locator(".chip-collection")).toHaveCount(0);
    await expect(page.locator("#chips")).not.toContainText(/my collection/i);
  });

  test("the bookmark is outlined, never filled black", async ({ page }) => {
    // This SVG alone was missing fill="none", defaulting to black --
    // invisible against a dark bar.
    await gotoFeed(page);
    await expect(btn(page).locator("svg path")).toHaveCSS("fill", "none");
  });

  test("says nothing when nothing is saved", async ({ page }) => {
    await gotoFeed(page);
    await expect(btn(page)).not.toHaveClass(/has-items/);
    await expect(count(page)).toBeHidden();
    await expect(btn(page)).toHaveAttribute("aria-label", /empty/);
  });

  test("shows the count once something is saved", async ({ page }) => {
    await gotoFeed(page);
    await save(page, 1);
    await expect(btn(page)).toHaveClass(/has-items/);
    await expect(count(page)).toHaveText("1");
    // The number is aria-hidden, so the label has to carry it instead.
    await expect(btn(page)).toHaveAttribute("aria-label", /1 item$/);
  });

  test("caps at 9+ rather than overflowing the shape", async ({ page }) => {
    // Two digits inside a 17px bookmark are unreadable; the real count
    // stays in the label.
    await gotoFeed(page);
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) await save(page, i);
    await expect(count(page)).toHaveText("9+");
    await expect(btn(page)).toHaveAttribute("aria-label", /11 items/);
  });

  test("the count sits inside the button it belongs to", async ({ page }) => {
    // It first shipped inside the Music button -- the insertion matched the
    // first of four identical `</svg></button>` endings, rendering 186px
    // away from where anyone would look.
    await gotoFeed(page);
    await save(page, 1);
    const inside = await page.evaluate(() => {
      const b = document
        .getElementById("collectionToggle")!
        .getBoundingClientRect();
      const r = document
        .getElementById("collectionCount")!
        .getBoundingClientRect();
      return (
        r.x >= b.x && r.right <= b.right && r.y >= b.y && r.bottom <= b.bottom
      );
    });
    expect(inside, "the count is not inside the bookmark button").toBe(true);
  });

  test("active looks like an active category chip", async ({ page }) => {
    await gotoFeed(page);
    // Captured before entering the collection: chips have no active state
    // while the collection filter is on, so there'd be nothing to compare
    // against once the bookmark lights up.
    const chipColour = await page
      .locator(".chip.active")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await save(page, 1);
    await btn(page).click();
    await expect(btn(page)).toHaveClass(/active/);
    // toHaveCSS rather than a one-shot evaluate: `transition: all 0.2s`
    // means reading the style the instant the class lands returns the
    // colour it's transitioning from.
    await expect(btn(page)).toHaveCSS("background-color", chipColour);
  });

  test("saving does not reset the chip row's scroll", async ({ page }) => {
    // It used to call renderChips() to refresh the count, rebuilding every
    // chip and snapping the row back to the start mid-browse. Pinned to a
    // phone viewport, since on desktop the row collapses into a More menu
    // and scrollLeft is always 0.
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoFeed(page);
    // Save from the slide the row already shows, so only a rebuild could
    // move the chips.
    await scrollToSlide(page, 1);
    await page.locator("#chips").evaluate((el) => {
      el.scrollLeft = 200;
    });
    const before = await page.locator("#chips").evaluate((el) => el.scrollLeft);
    expect(
      before,
      "the chip row does not scroll at this width",
    ).toBeGreaterThan(0);
    await page.locator("#feed .slide").nth(1).locator(".btn-collect").click();
    await expect(btn(page)).toHaveClass(/has-items/);
    expect(await page.locator("#chips").evaluate((el) => el.scrollLeft)).toBe(
      before,
    );
  });
});

test.describe("Discover has the site's dressing", () => {
  test.beforeEach(async ({ page }) => {
    await gotoFeed(page);
    await page.locator("#discoverToggle").click();
    await expect(page.locator("#shelvesMode")).toHaveClass(/open/);
  });

  test("carries the mark, since the overlay hides the top bar", async ({
    page,
  }) => {
    // #shelvesMode is fixed inset:0 over everything, so without this the
    // tulip vanishes while you're in here and the view has no brand at all.
    const mark = page.locator("#shelvesMode .shelves-mark");
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute("alt", "");
    const ok = await mark.evaluate(
      (i: HTMLImageElement) => i.complete && i.naturalWidth > 0,
    );
    expect(ok, "the Discover mark failed to load").toBe(true);
  });

  test("names its two sections, each with a sub-line", async ({ page }) => {
    await expect(page.locator(".shelf-section-title")).toHaveText([
      "Storylines",
      "Shelves, Curated by Hand",
    ]);
    await expect(page.locator(".shelf-section-sub").first()).toHaveText(
      "Curated stories behind the art",
    );
    await expect(page.locator(".shelf-section-sub").nth(1)).toHaveText(
      "Pick a mood and enjoy",
    );
  });

  test("splits on the storylines shelf, not on shelf.type", async ({
    page,
  }) => {
    // `type` says how a shelf is populated, and almost every shelf is
    // hand-picked; splitting on it put everything in the first section.
    const first = page.locator(".shelf-section").first();
    const storyTitles = await page.locator(".shelf-title").allInnerTexts();
    expect(storyTitles).not.toContain("Storylines");
    expect(storyTitles.length).toBeGreaterThan(0);
    await expect(first.locator(".shelf-section-title")).toHaveText(
      "Storylines",
    );
  });

  test("nothing on the page is set in italic serif", async ({ page }) => {
    // Italic Cormorant at small sizes on a dark ground was the least
    // legible combination available for labels people scan.
    const styles = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#shelvesMode h2, .shelf-section-title, .shelf-title",
        ),
      ].map((el) => {
        const c = getComputedStyle(el);
        return {
          text: el.textContent.slice(0, 24),
          style: c.fontStyle,
          family: c.fontFamily.split(",")[0],
        };
      }),
    );
    expect(styles.length).toBeGreaterThan(2);
    for (const s of styles) {
      expect(s.style, `"${s.text}" is italic`).toBe("normal");
      expect(s.family, `"${s.text}" is set in a serif`).toContain("Work Sans");
    }
  });

  test("still closes", async ({ page }) => {
    await page.locator("#shelvesClose").click();
    await expect(page.locator("#shelvesMode")).not.toHaveClass(/open/);
  });
});

test.describe("the marketing header", () => {
  test("puts the wordmark on the LEFT", async ({ page }) => {
    // Rendered on the right at >=720px because `.wordmark{ order:1 }`,
    // written for the top bar, was unscoped and also hit .mkt-nav .wordmark,
    // sorting after the unordered links.
    await stubBackend(page);
    await page.setViewportSize({ width: 1000, height: 400 });
    await page.goto("/pages/about.html");
    const [mark, links] = await Promise.all([
      page
        .locator(".mkt-nav .wordmark")
        .evaluate((el) => el.getBoundingClientRect().x),
      page
        .locator(".mkt-nav-links")
        .evaluate((el) => el.getBoundingClientRect().x),
    ]);
    expect(mark, "the wordmark is to the right of the nav links").toBeLessThan(
      links,
    );
  });

  test("uses the brand face, like the app's bar", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/about.html");
    await page.evaluate(() => document.fonts.ready);
    const s = await page.locator(".mkt-nav .wordmark").evaluate((el) => {
      const c = getComputedStyle(el);
      return [c.fontFamily, c.textTransform];
    });
    expect(s[0]).toContain("Glacial Indifference");
    expect(s[1]).toBe("uppercase");
  });
});

test.describe("the intro slide fits its screen", () => {
  // Both the top bar and the scroll cue are position:fixed, so neither
  // takes layout space -- a padding value chosen by eye once left the logo
  // 3px from the chips and the donations text overlapping the scroll cue.
  const SIZES: Array<[string, number, number]> = [
    ["320x568", 320, 568],
    ["360x640", 360, 640],
    ["360x740", 360, 740],
    ["390x844", 390, 844],
    ["412x880", 412, 880],
    ["desktop", 1280, 900],
  ];

  for (const [label, w, h] of SIZES) {
    test(`${label}: the logo clears the top bar`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await gotoFeed(page);
      const gap = await page.evaluate(() => {
        const chips = document.getElementById("chips")!.getBoundingClientRect();
        const logo = document
          .querySelector(".intro-lockup")!
          .getBoundingClientRect();
        return Math.round(logo.top - chips.bottom);
      });
      expect(
        gap,
        `logo overlaps or crowds the chips at ${label}`,
      ).toBeGreaterThan(12);
    });

    test(`${label}: nothing collides with the scroll cue`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await gotoFeed(page);
      const clear = await page.evaluate(() => {
        const cue = document.getElementById("scrollHint")!;
        // Hidden by design below 700px tall, where the slide scrolls
        // instead of cramming.
        if (getComputedStyle(cue).display === "none") return null;
        const cards = document.querySelector(".slide.intro .action-cards")!;
        return Math.round(
          cue.getBoundingClientRect().top -
            cards.getBoundingClientRect().bottom,
        );
      });
      if (clear === null) return;
      expect(
        clear,
        `the action cards run under the scroll cue at ${label}`,
      ).toBeGreaterThan(0);
    });
  }
});

test.describe("responsive overflow", () => {
  const WIDTHS = [320, 360, 390, 412, 620, 1280];

  for (const w of WIDTHS) {
    test(`${w}px: every marketing nav link is on screen`, async ({ page }) => {
      // "Support us" was off the right edge by 143px at 320 wide, still
      // 51px at 412 -- every phone, not a narrow-phone edge case.
      await stubBackend(page);
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/pages/about.html");
      const worst = await page.evaluate(() => {
        const nav = document.querySelector(".mkt-nav")!.getBoundingClientRect();
        return (
          Math.max(
            ...[...document.querySelectorAll(".mkt-nav-links a")].map(
              (a) => a.getBoundingClientRect().right,
            ),
          ) - nav.right
        );
      });
      expect(
        worst,
        `a nav link overflows the header at ${w}px`,
      ).toBeLessThanOrEqual(0);
    });

    test(`${w}px: no page scrolls sideways`, async ({ page }) => {
      await stubBackend(page);
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/pages/about.html");
      const over = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(
        over,
        `about.html scrolls horizontally at ${w}px`,
      ).toBeLessThanOrEqual(0);
    });

    test(`${w}px: all four top-bar icons fit`, async ({ page }) => {
      // The bookmark overflowed by 56px at 320: the wordmark grew from
      // plain "Tranquilo" to a tulip plus letterspaced caps and took the
      // collection button's space with it.
      await page.setViewportSize({ width: w, height: 800 });
      await gotoFeed(page);
      const shown = await page.evaluate(() => {
        const vw = window.innerWidth;
        return [...document.querySelectorAll(".topbar-icons button")].filter(
          (b) => b.getBoundingClientRect().right <= vw + 0.5,
        ).length;
      });
      expect(shown, `an icon is off-screen at ${w}px`).toBe(4);
    });
  }

  test("the marketing nav stacks on a phone and not on a desktop", async ({
    page,
  }) => {
    await stubBackend(page);
    const stackedAt = async (w: number) => {
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto("/pages/about.html");
      return page.evaluate(() => {
        const mark = document
          .querySelector(".mkt-nav .wordmark")!
          .getBoundingClientRect();
        const link = document
          .querySelector(".mkt-nav-links a")!
          .getBoundingClientRect();
        return mark.bottom <= link.top + 1;
      });
    };
    expect(await stackedAt(390)).toBe(true);
    expect(await stackedAt(1280)).toBe(false);
  });

  test("the word yields before the icons do", async ({ page }) => {
    // On a narrow screen the wordmark collapses to the tulip whether or not
    // you've scrolled, the same collapse the bar performs in the art.
    await page.setViewportSize({ width: 360, height: 800 });
    await gotoFeed(page);
    const w = await page
      .locator(".topbar .wordmark span")
      .evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBeLessThan(2);
    await expect(page.locator(".topbar .wordmark-mark")).toBeVisible();
  });
});
