// The i18n layer in a real browser: <html lang> must name the language
// actually rendered, and converted components must show real text, never
// raw keys. pt-BR is the shipped second language: a Portuguese browser is
// served it automatically, and an explicit choice wins over the browser
// either way. (That a draft locale is never picked automatically is pinned
// on fixtures in tests/i18n.test.ts.)
import { expect, type Page, test } from "@playwright/test";
import { gotoArtwork, gotoFeed, ITEMS, stubBackend } from "./harness.mts";

test("an English browser gets lang=en and real toast copy", async ({
  page,
}) => {
  await gotoFeed(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const toast = page.locator("#upsellToast");
  await expect(toast.locator(".upsell-body")).toContainText(
    "Saved temporarily in this browser",
  );
  await expect(toast.locator(".upsell-body")).toContainText(
    "part of Tranquilo Curator",
  );
  await expect(toast.locator("#upsellCta")).toHaveText("Join the waitlist");
  await expect(toast.locator("#upsellClose")).toHaveAttribute(
    "aria-label",
    "Dismiss",
  );
});

test.describe("a browser asking for pt-BR", () => {
  test.use({ locale: "pt-BR" });

  test("is served pt-BR automatically -- the page says lang=pt-BR", async ({
    page,
  }) => {
    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(
      page.locator('#categorySelect option[value="All"]'),
    ).toHaveText("Todas as categorias");
  });

  test("still gets English after choosing it", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tranquilo:locale", "en");
    });
    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("an explicit stored opt-in sets lang=pt-BR and its strings", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tranquilo:locale", "pt-BR");
    });
    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    // Per-key fallback to English is pinned by tests/i18n.test.ts with
    // fixture dictionaries; pt-BR itself now covers every key.
    await expect(page.locator("#upsellCta")).toHaveText(
      "Entrar na lista de espera",
    );
  });
});

// ?lang= is the shareable way into a locale, draft ones included, so a
// preview can be shared before the language is public. It must apply to
// the very first screen and stick for the rest of the visit.
test.describe("a ?lang=pt-BR link", () => {
  test("opens the site in pt-BR and is remembered", async ({ page }) => {
    await gotoFeed(page, "?lang=pt-BR");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    // That the link wins even for text drawn while modules are still
    // evaluating (before start()) is pinned by the unit test "is honoured
    // by the very first lookup" -- chips render inside start(), so this
    // line alone can't tell the two apart.
    await expect(
      page.locator('#categorySelect option[value="All"]'),
    ).toHaveText("Todas as categorias");

    // A later visit without the parameter keeps the choice.
    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  });

  test("the top-right buttons have pt-BR hover tooltips", async ({ page }) => {
    // Icon-only buttons: the tooltip is the only visible name on hover.
    await gotoFeed(page, "?lang=pt-BR");
    for (const [id, tip] of [
      ["searchToggle", "Busca"],
      ["discoverToggle", "Descobrir prateleiras"],
      ["collectionToggle", "Minha coleção"],
      ["musicToggle", "Ligar ou desligar a música"],
    ]) {
      await expect(page.locator(`#${id}`), id).toHaveAttribute("title", tip);
    }
  });

  test("the scroll hint is in pt-BR", async ({ page }) => {
    // Plain markup in index.html rather than a component, so it is easy to
    // miss when converting text to dictionary keys.
    await gotoFeed(page, "?lang=pt-BR");
    await expect(page.locator("#scrollHint")).toHaveText("role para explorar");
  });

  test("the top bar, drawn while modules load, is already in pt-BR", async ({
    page,
  }) => {
    // <tranquilo-topbar> renders its markup in connectedCallback, which
    // runs when its module defines the element -- before app.ts's start().
    // So this fails if the link were only honoured at startup.
    await gotoFeed(page, "?lang=pt-BR");
    await expect(page.locator("#searchToggle")).toHaveAttribute(
      "aria-label",
      "Busca",
    );
  });

  test("never shows a raw dictionary key anywhere on the page", async ({
    page,
  }) => {
    await gotoFeed(page, "?lang=pt-BR");
    await page.locator("#searchToggle").click();
    // Visible text plus the attributes screen readers and placeholders use.
    const text = await page.evaluate(() => {
      const attrs = Array.from(
        document.querySelectorAll("[aria-label], [placeholder], [title]"),
      ).flatMap((el) => [
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("placeholder") ?? "",
        el.getAttribute("title") ?? "",
      ]);
      return [document.body.innerText, ...attrs].join("\n");
    });
    const keyLike =
      /\b(?:intro|topbar|slide|detail|search|support|shelves|storyline|chips|common|facet|filter|error|lightbox|export|share|collection|upsell|artistCard|setOfWorks|newsletter|form)\.[a-zA-Z][\w-]*(?:\.[\w-]+)*/g;
    expect(text.match(keyLike) ?? []).toEqual([]);
  });

  test("the newsletter modal is in pt-BR and tags the signup pt-BR", async ({
    page,
  }) => {
    const posted: { locale?: string } = {};
    await gotoFeed(page, "?lang=pt-BR");
    // Added after gotoFeed's stubBackend() so this handler runs first.
    await page.route("**/api/subscribe", async (route) => {
      Object.assign(posted, JSON.parse(route.request().postData() || "{}"));
      await route.fulfill({ status: 204 });
    });
    await page.locator("#feed [data-open-newsletter]").click();
    const dialog = page.locator("#newsletterDialog");
    await expect(dialog).toHaveClass(/open/);
    await expect(dialog.locator("#newsletterDialogTitle")).toHaveText(
      "Um momento de arte por mês",
    );
    await expect(dialog.locator("[data-newsletter-close]")).toHaveAttribute(
      "aria-label",
      "Fechar",
    );
    await expect(dialog.locator("#newsletterEmail")).toHaveAttribute(
      "placeholder",
      "voce@exemplo.com",
    );

    // An invalid address shows the Portuguese validation message.
    await page.fill("#newsletterEmail", "not-an-email");
    await page.click("#newsletterSubmitBtn");
    await expect(dialog.locator(".field.error .error-msg")).toHaveText(
      "Digite um endereço de e-mail válido.",
    );

    await page.fill("#newsletterEmail", "leitora@example.com");
    await page.click("#newsletterSubmitBtn");
    await expect(page.locator("#newsletterSuccess")).toBeVisible();
    await expect(page.locator("#newsletterSuccess")).toContainText(
      "Você está na lista",
    );
    expect(posted.locale).toBe("pt-BR");
  });

  test("?lang=en switches back", async ({ page }) => {
    await gotoFeed(page, "?lang=pt-BR");
    await gotoFeed(page, "?lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.locator('#categorySelect option[value="All"]'),
    ).toHaveText("All Categories");
  });
});

// The detail panel's link to the institution's own page was assembled from
// English words around the institution's name, so it stayed English in
// every locale.
test.describe("the detail panel's source link with pt-BR opted in", () => {
  test("reads in Portuguese", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tranquilo:locale", "pt-BR");
    });
    const item = ITEMS.find((i: any) => i.title && i.url && i.source === "met");
    await gotoArtwork(page, "met", item.id);
    await page
      .locator(`#feed .slide[data-slug$="-${String(item.id)}"] .art-title-btn`)
      .first()
      .click();
    await expect(page.locator("#detailModal")).toHaveClass(/open/);
    await expect(
      page.locator("#detailModal a.source-link .link-text"),
    ).toHaveText("Ver em metmuseum.org");
  });
});

// Category values are data keys (filters, shelves, music buckets), so only
// their on-screen label is translated. These pin that split: the chip reads
// in Portuguese, but selecting it still filters by the stored English value.
test.describe("category labels with pt-BR opted in", () => {
  test.use({ locale: "pt-BR" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("tranquilo:locale", "pt-BR");
    });
  });

  test("filter dropdowns show translated labels and still filter by value", async ({
    page,
  }) => {
    await gotoFeed(page);
    const category = page.locator("#categorySelect");
    await expect(category.locator('option[value="All"]')).toHaveText(
      "Todas as categorias",
    );
    await expect(
      category.locator('option[value="Paintings & Portraits"]'),
    ).toHaveText("Pinturas e retratos");
    await expect(page.locator("#paletteSelect")).toContainText(
      "Todas as paletas",
    );

    await category.selectOption("Paintings & Portraits");
    await expect(category).toHaveValue("Paintings & Portraits");
    const labels = page.locator("#feed .slide .cat-label");
    await expect(labels.first()).toHaveText("Pinturas e retratos");
    for (const text of await labels.allTextContents()) {
      expect(text).toBe("Pinturas e retratos");
    }
  });

  test("search's Browse-by chips show labels but search by stored value", async ({
    page,
  }) => {
    await gotoFeed(page);
    await page.locator("#searchToggle").click();
    const hints = page.locator(".search-hint-chip");
    await expect(hints.first()).toBeVisible();
    // Two of the six hints are always categories, all of which have pt-BR
    // labels, so none may show its English stored value.
    const english = new Set([
      "Paintings & Portraits",
      "Sculpture & Objects",
      "Works on Paper",
      "Arms & Armor",
      "Photography",
    ]);
    const texts = await hints.allTextContents();
    expect(texts.filter((t) => english.has(t.trim()))).toEqual([]);
    expect(
      texts.some((t) => /Pinturas|Esculturas|Obras|Armas|Fotografia/.test(t)),
    ).toBe(true);
  });
});

// Translated static pages (pages/pt-BR/*.html). The page itself is
// Portuguese; landing on it is choosing Portuguese, so the rest of the
// site follows -- and links lead to translated pages where they exist.
test.describe("pt-BR static pages", () => {
  test.beforeEach(async ({ page }) => {
    await stubBackend(page);
  });

  test("the About page is Portuguese, chrome included", async ({ page }) => {
    await page.goto("/pages/pt-BR/about.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("h1")).toHaveText("Por que Tranquilo existe");
    await expect(page.locator(".mkt-nav-links a.current")).toHaveText("Sobre");
    await expect(
      page.locator('.mkt-footer a[href="/pages/about.html?lang=en"]'),
    ).toHaveText("English");
  });

  test("the Support page's donation strip follows the page's language", async ({
    page,
  }) => {
    await page.goto("/pages/pt-BR/support.html");
    await expect(page.locator(".support-donate-btn")).toContainText("Doar");
  });

  test("landing on a pt-BR page carries Portuguese into the feed", async ({
    page,
  }) => {
    await page.goto("/pages/pt-BR/get-involved.html");
    await gotoFeed(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    // The intro's cards lead to the translated pages.
    await expect(
      page.locator(
        '.slide.intro a.action-card-btn[href="/pages/pt-BR/get-involved.html"]',
      ),
    ).toHaveText("Participe");
  });

  // The forms' busy and error text is set from each page's script rather
  // than its HTML, so a translated page can still fall back to English
  // exactly when something goes wrong. Each test fails the request to see it.
  const failApi = (page: Page, path: string) =>
    page.route(`**${path}**`, (route) =>
      route.fulfill({ status: 500, body: "{}" }),
    );

  test("the Feedback page and its form messages are Portuguese", async ({
    page,
  }) => {
    await failApi(page, "/api/submit-collection");
    await page.goto("/pages/pt-BR/feedback.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.fill("#message", "Teste");
    await page.click("#submitBtn");
    await expect(page.locator("#submitErrorMsg")).toContainText(
      "não foi enviada",
    );
    await expect(page.locator("#submitBtn")).toHaveText("Enviar opinião");
  });

  test("the Submit page and its form messages are Portuguese", async ({
    page,
  }) => {
    await failApi(page, "/api/submit-collection");
    await page.goto("/pages/pt-BR/submit.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.fill("#collectionName", "Acervo de teste");
    await page.fill("#submitterName", "Pessoa Teste");
    await page.fill("#submitterEmail", "teste@exemplo.com");
    await page.fill("#collectionLink", "https://exemplo.com");
    await page.selectOption("#licenseType", "CC0");
    await page.fill("#licenseVerificationLink", "https://exemplo.com/licenca");
    await page.fill("#description", "Descrição");
    await page.check("#confirmLicense");
    await page.click("#submitBtn");
    await expect(page.locator("#submitErrorMsg")).toContainText(
      "Algo deu errado",
    );
    await expect(page.locator("#submitBtn")).toHaveText(
      "Enviar para avaliação",
    );
  });

  test("the Tranquilo Curator page and its form messages are Portuguese", async ({
    page,
  }) => {
    await failApi(page, "/api/subscribe");
    await page.goto("/pages/pt-BR/curator.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.fill("#waitlistEmail", "teste@exemplo.com");
    await page.click("#waitlistSubmitBtn");
    await expect(page.locator("#waitlistErrorMsg")).toContainText(
      "Algo deu errado",
    );
    await expect(page.locator("#waitlistSubmitBtn")).toHaveText(
      "Entrar na lista de espera",
    );
  });

  test("the Thank-you page is Portuguese and leads back to the art", async ({
    page,
  }) => {
    await page.goto("/pages/pt-BR/thank-you.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("h1")).toHaveText("Agradecemos o seu apoio");
    await expect(
      page.getByRole("link", { name: "Voltar para a arte" }),
    ).toHaveAttribute("href", "/");
  });

  test("English pages offer the same page in Portuguese", async ({ page }) => {
    await page.goto("/pages/about.html");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.locator(
        '.mkt-footer-langs a[href="/pages/pt-BR/about.html?lang=pt-BR"]',
      ),
    ).toHaveText("Português (Brasil)");
  });
});
