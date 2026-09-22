// PostHog Analytics -- live in production (VITE_POSTHOG_TOKEN is set,
// loaded on index.html). File name/module path are pre-launch leftovers --
// promoting this out of "draft" status for real (rename, confirm the two
// checklist items below actually landed) is still open.
// Outstanding from before this shipped, unconfirmed:
//   1. "Discard client IP data" in the PostHog project settings --
//      posthog-js's own `ip` init option is deprecated and has no effect
//      (confirmed against its source), so raw IPs otherwise reach PostHog
//      regardless of anything set here, which pages/privacy.html does not permit.
//   2. pages/privacy.html has no PostHog disclosure at all as of 22 Sep
//      2026 -- this was supposed to be updated before shipping and looks
//      like it got missed.
//
// Mirrors trackEvent()'s named product events too now (src/app/Analytics.ts
// imports this module's default export and calls .capture() alongside its
// own /api/track send) -- originally additive alongside Cloudflare Web
// Analytics and trackEvent()'s /api/track pipeline for general
// click/pageview/navigation-timing signals neither captured, now also the
// mirror target for the events analytics-report.ts used to summarize.
//
// Configured for the strictest anonymous mode posthog-js supports: no
// person profiles ever created, autocapture scoped to clicks only (no form
// input content), no session recording/heatmaps, no on-page surveys.
// Same real-site/not-opted-out gate as the Cloudflare beacon; calls
// syncInternalTrafficFlag() itself so it's correct regardless of script order.

import posthog from "posthog-js";
import { isRealExternalTraffic, syncInternalTrafficFlag } from "./trafficGate";

declare global {
  interface Window {
    posthog: {
      init(token: string, config: Record<string, unknown>): void;
    };
  }
}

syncInternalTrafficFlag();

// Returns null rather than throwing when disabled (no token, internal
// traffic, or a non-production host): every dev/preview/test/CI load hits
// this path, and a thrown Error here would abort app.ts's entire module
// graph, since this is a bare side-effect import with nothing to catch it.
export function initPosthog() {
  const POSTHOG_TOKEN = import.meta.env.VITE_POSTHOG_TOKEN;

  if (isRealExternalTraffic() && POSTHOG_TOKEN) {
    posthog.init(POSTHOG_TOKEN, {
      api_host: "https://us.i.posthog.com",
      person_profiles: "never",
      autocapture: { dom_event_allowlist: ["click"] },
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      capture_heatmaps: false,
      disable_surveys: true,
      disable_web_experiments: true,
    });
    return posthog;
  }

  return null;
}

const posthogInstance = initPosthog();

export default posthogInstance;
