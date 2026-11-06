// The language switcher: a globe button closing the top bar's icon group,
// opening a menu of languages by native name, plus the same choice in the
// static pages' footer. The guarantees:
//   - a draft language is never advertised to someone who isn't already
//     reading it (pinned on fixtures in tests/i18n.test.ts)
//   - a reviewer on a ?lang= preview can see where they are and get back
//   - a switch is remembered: the next page, and the feed, follow it
//   - icon-only, so a longer translation can't push the top bar onto a
//     second line on a phone
import { expect, test } from "@playwright/test";
import { gotoFeed, stubBackend } from "./harness.mts";

test("an English visitor can switch to Portuguese", async ({ page }) => {
  // That a draft language is never listed is pinned on fixtures in
  // tests/i18n.test.ts (switcherLocales); this is the shipped case.
  await gotoFeed(page);
  await page.locator("#languageToggle").click();
  const menu = page.locator("#languageMenu");
  await expect(menu.locator("[aria-current=true]")).toHaveAttribute(
    "lang",
    "en",
  );
  await menu.locator("[lang=pt-BR]").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

test.describe("on a ?lang=pt-BR preview", () => {
  test("lists each language by its own name and marks the current one", async ({
    page,
  }) => {
    await gotoFeed(page, "?lang=pt-BR");
    const toggle = page.locator("#languageToggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("title", "Idioma");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator("#languageMenu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("[lang=en]")).toHaveText("English");
    await expect(menu.locator("[lang=pt-BR]")).toHaveText("Português (Brasil)");
    await expect(menu.locator("[aria-current=true]")).toHaveAttribute(
      "lang",
      "pt-BR",
    );

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("picking English redraws everything in English and remembers it", async ({
    page,
  }) => {
    await gotoFeed(page, "?lang=pt-BR");
    await page.locator("#languageToggle").click();
    await page.locator("#languageMenu [lang=en]").click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.locator('#categorySelect option[value="All"]'),
    ).toHaveText("All Categories");
    // The preview link's ?lang= must not survive the switch, or it would
    // undo the choice on the next reload.
    expect(new URL(page.url()).searchParams.has("lang")).toBe(false);

    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  for (const width of [390, 1440]) {
    test(`${width}px: the globe closes the icon group, on the same line`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoFeed(page, "?lang=pt-BR");
      const box = async (id: string) =>
        (await page.locator(`#${id}`).boundingBox())!;
      const music = await box("musicToggle");
      const globe = await box("languageToggle");
      expect(Math.abs(globe.x - (music.x + music.width))).toBeLessThanOrEqual(
        1.5,
      );
      expect(Math.abs(globe.y - music.y)).toBeLessThanOrEqual(1);
      expect(globe.x + globe.width).toBeLessThanOrEqual(width);
    });
  }
});

test.describe("a static page's footer", () => {
  test("an English page offers itself in Portuguese", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/pages/terms.html");
    const langs = page.locator(".mkt-footer-langs");
    await expect(langs.locator("[aria-current=true]")).toHaveText("English");
    await langs.locator("a[lang=pt-BR]").click();
    await expect(page).toHaveURL(/\/pages\/pt-BR\/terms\.html/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  });

  test("English from a translated page sticks, even on a page with no script", async ({
    page,
  }) => {
    // terms.html loads no script of its own -- the case that used to show
    // English but leave pt-BR stored.
    await stubBackend(page);
    await page.goto("/pages/pt-BR/terms.html");
    const langs = page.locator(".mkt-footer-langs");
    await expect(langs.locator("[aria-current=true]")).toHaveText(
      "Português (Brasil)",
    );
    await langs.locator("a[lang=en]").click();
    await expect(page).toHaveURL(/\/pages\/terms\.html/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    // The choice is recorded by a module script; wait for it rather than
    // racing it to the next navigation.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("tranquilo:locale")))
      .toBe("en");

    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
