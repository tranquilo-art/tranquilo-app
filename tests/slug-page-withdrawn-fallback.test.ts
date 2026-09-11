// A /v/{slug} whose row exists but isn't LIVE used to bounce a visitor
// straight back to the homepage with no trace of what they came for,
// throwing away a real bookmark. items.url is the object's own museum
// page, already public, so a withdrawn item's /v/{slug} redirects there
// instead -- but only for review_status = 'delisted' (the source
// withdrew it), never 'rejected' or 'quarantined' (our own curatorial
// decisions, which don't obligate tracking the item for visitors forever).
//
// Source-text assertions, not an invoked handler -- same constraint
// storyline-share-page.test.ts documents: @neondatabase/serverless is
// externalized, so vi.mock() can't intercept the driver import.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "../api/v/[slug].ts"), "utf8");

// Isolated to the item branch specifically, so an assertion here can't
// accidentally pass by matching sendStorylinePage()'s own not-found handling.
const itemBranch = src.slice(
  src.indexOf("if (!item) {"),
  src.indexOf("const title = item.title"),
);

describe("/v/{slug} for a delisted (source withdrew it) item", () => {
  it("only runs the fallback lookup once parseSlug() actually produced a source/nativeId", () => {
    const guardLine = itemBranch
      .split("\n")
      .find((l) => l.includes("if (parsed && client)"));
    expect(
      guardLine,
      "fallback lookup should be guarded on parsed && client",
    ).toBeTruthy();
  });

  it("queries items WITHOUT the live-items filter, since the live query's whole job is to hide this row", () => {
    expect(itemBranch).toMatch(
      /SELECT url FROM items WHERE source = \$1 AND native_id = \$2/,
    );
    const liveFilterMentions = (itemBranch.match(/LIVE_ITEMS_AND/g) || [])
      .length;
    expect(liveFilterMentions).toBeLessThanOrEqual(1);
  });

  it("gates the fallback on review_status = 'delisted' specifically, not any non-live row", () => {
    expect(itemBranch).toMatch(
      /SELECT url FROM items WHERE source = \$1 AND native_id = \$2 AND review_status = 'delisted'/,
    );
  });

  it("selects only url, not *, from the unfiltered lookup", () => {
    expect(itemBranch).not.toMatch(
      /SELECT \*.*WHERE source = \$1 AND native_id = \$2 LIMIT 1\)/s,
    );
  });

  it("a failed fallback lookup is caught, not thrown -- degrades to the ordinary not-found page", () => {
    const fallbackQueryIdx = itemBranch.indexOf("SELECT url FROM items");
    const nearby = itemBranch.slice(fallbackQueryIdx, fallbackQueryIdx + 400);
    expect(nearby).toContain("catch (err)");
    expect(nearby).toContain("reportError(err)");
  });

  it("redirects to the item's own museum URL when one was found, not the homepage", () => {
    expect(itemBranch).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on app.ts's literal source text, not an interpolation.
      "redirectUrl: fallbackUrl || `${origin}/index.html`",
    );
  });

  it("uses a distinct status note and link label when redirecting externally", () => {
    expect(itemBranch).toContain("View it on the museum's site");
    expect(itemBranch).toContain(
      "This piece is no longer part of Tranquilo's collection",
    );
    expect(itemBranch).toContain("That piece couldn't be found.");
  });

  it("renderPage escapes the redirect URL for the href, since it's now external text", () => {
    const renderPageBody = src.slice(
      src.indexOf("function renderPage(opts"),
      src.indexOf("function renderPage(opts") +
        src.slice(src.indexOf("function renderPage(opts")).indexOf("\n}\n"),
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on app.ts's literal source text, not an interpolation.
    expect(renderPageBody).toContain('href="${escapeHtml(opts.redirectUrl)}"');
    // The <script> redirect uses JSON.stringify() on the raw value, which
    // already produces a safe JS string literal.
    expect(renderPageBody).toContain("JSON.stringify(opts.redirectUrl)");
  });

  it("renderPage's link label is parameterized, not hardcoded to the homepage wording", () => {
    expect(src).toContain(
      'const redirectLabel = opts.redirectLabel || "Open Tranquilo"',
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting on app.ts's literal source text, not an interpolation.
    expect(src).toContain("${redirectLabel}</a>");
  });

  it("the fallback query's own condition never widens back to 'rejected' or 'quarantined'", () => {
    // An early cut of this fallback offered the museum link for any
    // non-live row; only the query's own condition clause needs to stay
    // narrow, not the surrounding comment.
    const queryLine = itemBranch
      .split("\n")
      .find((l) => l.includes("SELECT url FROM items"))!;
    expect(queryLine).not.toContain("rejected");
    expect(queryLine).not.toContain("quarantined");
    expect(queryLine).toContain("delisted");
  });
});
