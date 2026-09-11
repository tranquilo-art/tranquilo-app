// PostHog Analytics -- DRAFT, not live. Loaded on index.html only.
// VITE_POSTHOG_TOKEN is unset until this ships. Before shipping:
//   1. Set VITE_POSTHOG_TOKEN to a real project token, and api_host below
//      to the matching region.
//   2. Turn on "Discard client IP data" in the PostHog project settings --
//      posthog-js's own `ip` init option is deprecated and has no effect
//      (confirmed against its source), so raw IPs otherwise reach PostHog
//      regardless of anything set here, which pages/privacy.html does not permit.
//   3. Update the commented-out pages/privacy.html copy ("PostHog Analytics
//      -- draft") to describe what's actually configured, and un-comment it.
//   4. No new Vercel function needed -- events go straight to PostHog's
//      ingestion host, not through api/ (already at Hobby's 12-function cap).
//
// Additive alongside Cloudflare Web Analytics and trackEvent()'s /api/track
// pipeline, not replacing either -- covers general click/pageview/
// navigation-timing signals neither captures today.
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
