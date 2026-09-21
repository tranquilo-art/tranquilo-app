// The deep-link share banner (TRANQ-49 pre-work): shown once per session
// when a visitor lands via /v/{slug} or /s/{id}, since that path skips the
// intro slide (and its Mission/Connect/Support cards) entirely.
//
// Source assertions rather than DOM tests, since app.ts is a browser IIFE
// with no module exports and this suite is offline by design -- same
// approach as tests/share-links.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(__dirname, "../src/app.ts"), "utf8");
const topbarSource = readFileSync(
  path.join(__dirname, "../src/components/TranquiloTopbar.ts"),
  "utf8",
);

describe("share banner trigger", () => {
  it("fires on either deep-link signal, not just one", () => {
    const triggerBlock = appSource.slice(
      appSource.indexOf("const arrivedViaShareLink"),
      appSource.indexOf("function slugFromLocation"),
    );
    expect(triggerBlock).toMatch(/hadDeepLinkArtwork/);
    expect(triggerBlock).toMatch(/initialStorylineId/);
  });

  it("gates on a dedicated session key, not the upsell toast's", () => {
    expect(appSource).toMatch(
      /SESSION_SHARE_BANNER_KEY\s*=\s*"tranquilo:shareBannerShownThisSession"/,
    );
  });

  it("has a ?resetShareBanner=1 test switch, same shape as resetUpsellThrottle", () => {
    const resetBlock = appSource.slice(
      appSource.indexOf("function resetShareBanner"),
      appSource.indexOf("function resetShareBanner") + 300,
    );
    expect(resetBlock).toMatch(/resetShareBanner/);
    expect(resetBlock).toMatch(/SESSION_SHARE_BANNER_KEY/);
  });
});

describe("share banner analytics", () => {
  // Every event in the funnel -- not just the impression -- should carry
  // which entry type (artwork vs storyline) triggered the banner, or the
  // funnel can't be segmented by entry type past the first event.
  for (const eventName of [
    "share_banner_shown",
    "share_banner_dismiss",
    "share_banner_cta_click",
  ]) {
    it(`${eventName} reports shareBannerSource`, () => {
      const callIndex = appSource.indexOf(`"${eventName}"`);
      expect(
        callIndex,
        `${eventName} call not found in app.ts`,
      ).toBeGreaterThan(-1);
      const callSite = appSource.slice(callIndex, callIndex + 120);
      expect(callSite).toMatch(/shareBannerSource/);
    });
  }
});

describe("share banner CTAs", () => {
  it("the newsletter button opens the existing newsletter modal", () => {
    expect(topbarSource).toMatch(
      /id="shareBannerNewsletter"[^>]*data-open-newsletter/,
    );
  });

  it("the get-involved link points at the existing page", () => {
    expect(topbarSource).toMatch(
      /id="shareBannerInvolved"[^>]*href="\/pages\/get-involved\.html"/,
    );
  });
});
