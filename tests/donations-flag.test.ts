/* The donations gate: donations are switched off until Stripe can onboard
 * a new business bank account. The switch is deliberately two places, and
 * this file makes two places safe by asserting they agree.
 *
 * Every test here passes in both states -- each reads the gate's actual
 * state and asserts what must be true given that state, so the suite
 * stays a real check through the flip rather than something to delete
 * when donations return.
 *
 * To turn donations back on: delete the [data-donations] rule from
 * css/style.css, delete the two redirects from vercel.json, run this file.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildIntroSlide } from "../src/feed/introSlides";

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const css = read("css/style.css");
const vercel = JSON.parse(read("vercel.json"));

// The two halves of the switch, read rather than assumed.
const cssGateOn = /^\[data-donations\]\s*\{[^}]*display\s*:\s*none/m.test(css);
const redirects = vercel.redirects || [];
const GATED_ROUTES = ["/pages/support.html", "/pages/thank-you.html"];
const routeGateOn = GATED_ROUTES.every((r) =>
  redirects.some((d: any) => d.source === r),
);

const PAGES = readdirSync(join(ROOT, "pages")).filter((f) =>
  f.endsWith(".html"),
);

describe("the donations gate", () => {
  it("has both halves in the same state", () => {
    // Hiding the links but leaving the page reachable is a donate flow
    // anyone with the URL can still enter; closing routes but leaving live
    // links strands them at a redirect.
    expect(cssGateOn).toBe(routeGateOn);
  });

  it("closes both routes together, or neither", () => {
    // thank-you.html is only reached as Stripe's post-payment redirect --
    // leaving it open while support.html is closed strands a "you paid"
    // page for someone who couldn't have.
    const closed = GATED_ROUTES.filter((r) =>
      redirects.some((d: any) => d.source === r),
    );
    expect(closed.length === 0 || closed.length === GATED_ROUTES.length).toBe(
      true,
    );
  });

  it("uses a temporary redirect, so the gate can actually be lifted", () => {
    // A permanent redirect is cached indefinitely -- every visitor who hit
    // it during the gate would keep bouncing after donations returned.
    for (const r of redirects.filter((d: any) =>
      GATED_ROUTES.includes(d.source),
    )) {
      expect(r.permanent).toBe(false);
    }
  });
});

describe("what the gate has to cover", () => {
  it("marks every link to the support page", () => {
    // No link to support.html can exist anywhere without the mark -- a new
    // page copying an existing nav block fails here rather than shipping
    // a live donate link.
    const unmarked = [];
    for (const f of PAGES) {
      const html = read(join("pages", f));
      const re = /<a\b[^>]*href="[^"]*support\.html"[^>]*>/g;
      for (const [tag] of html.matchAll(re)) {
        if (!/\bdata-donations\b/.test(tag))
          unmarked.push(`pages/${f}: ${tag}`);
      }
    }
    for (const f of ["src/app.ts", "src/feed/introSlides.ts"]) {
      const contents = read(f);
      if (/support\.html/.test(contents) && !/data-donations/.test(contents)) {
        unmarked.push(f);
      }
    }
    expect(unmarked).toEqual([]);
  });

  it("marks the homepage's Give action card", () => {
    // Checks the rendered output, not introSlides.ts's exact source
    // phrasing -- a source-text match here already broke once for free
    // when the three cards were pulled behind a shared actionCard()
    // helper, even though the rendered markup (and the guarantee this
    // test cares about) didn't change at all.
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        const el: any = { tagName: tag };
        Object.defineProperty(el, "className", {
          get() {
            return this._className;
          },
          set(v) {
            this._className = v;
          },
        });
        Object.defineProperty(el, "innerHTML", {
          get() {
            return this._innerHTML;
          },
          set(v) {
            this._innerHTML = v;
          },
        });
        return el;
      },
    });
    const html = buildIntroSlide({ sources: ["met"], total: 100 }).innerHTML;
    // Unmarked, a "Donate" affordance sits on the site's most-viewed screen.
    expect(html).toMatch(/<div class="action-card" data-donations>[\s\S]*Give/);
    vi.unstubAllGlobals();
  });

  it("keeps neither gated page in the sitemap", () => {
    // Nothing should advertise a URL that bounces.
    const sitemap = read("api/sitemap.ts");
    expect(sitemap).not.toMatch(/support\.html/);
    expect(sitemap).not.toMatch(/thank-you\.html/);
  });

  it("gates the donation clauses in both legal documents", () => {
    const terms = read("pages/terms.html");
    const privacy = read("pages/privacy.html");
    expect(terms).toMatch(/<div data-donations>\s*<h2[^>]*>Donations<\/h2>/);
    expect(privacy).toMatch(/<div data-donations>\s*<h2[^>]*>Donations<\/h2>/);
    // The LGPD lawful-basis list item is separate markup from the section.
    expect(privacy).toMatch(/<li data-donations><strong>Donations<\/strong>/);
  });

  it("leaves no sentence that breaks when its gated span is removed", () => {
    // Checked by actually removing the spans and looking at the seams --
    // the About page's donate sentence once marked the <a> alone, which
    // would have rendered "You can  to help keep Tranquilo free."
    const files = ["pages/about.html", "pages/privacy.html"];
    for (const f of files) {
      const stripped = read(f).replace(
        /<span data-donations>[\s\S]*?<\/span>/g,
        "",
      );
      // No doubled spaces, orphaned commas, or " ." left at a seam.
      expect(stripped, `${f} has a broken seam`).not.toMatch(/\w {2,}\w/);
      expect(stripped, `${f} has an orphaned comma`).not.toMatch(
        /\s,|,\s*[.—]/,
      );
      expect(stripped, `${f} has a floating full stop`).not.toMatch(/\s+\./);
    }
  });

  it("numbers the terms clauses by counter, so hiding one leaves no hole", () => {
    // With literal numbers in the markup, gating clause 7 renders 6, 8, 9 --
    // a counter skips hidden clauses on its own.
    const terms = read("pages/terms.html");
    const headings = [
      ...terms.matchAll(/<h2 class="mkt-h2">([^<]+)<\/h2>/g),
    ].map((m) => m[1]);
    expect(headings.length).toBeGreaterThan(5);
    for (const h of headings) {
      expect(h, "clause number is hardcoded in the markup").not.toMatch(
        /^\d+\.\s/,
      );
    }
    expect(css).toMatch(/\.legal-body\.numbered\s*\{\s*counter-reset/);
    // Caught for real: a stray comment delimiter made CSS error-recovery
    // swallow the counter-reset rule, and every clause silently rendered
    // "1." with no error anywhere.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments, "stray comment delimiter in style.css").not.toMatch(
      /\*\/|\/\*/,
    );
    // Scoped: privacy.html shares .legal-body and must stay unnumbered.
    expect(read("pages/privacy.html")).not.toMatch(/legal-body[^"]*numbered/);
  });
});
