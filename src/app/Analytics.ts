// Sends custom analytics events to api/track.js, which stores them in the
// `analytics_events` table (see sql/002_analytics_events.sql), and mirrors
// the same event to PostHog (see analytics/posthogDraft.ts) when it's
// initialized -- PostHog's own real-external-traffic gate already returns
// null instead of an instance otherwise, so this needs no separate check.
// Cloudflare's page-view beacon covers pageviews. Every send is
// fire-and-forget: nothing in the UI waits on or reacts to the request, and
// a failed send fails silently. A device with the internal-traffic
// localStorage key set (a team member's own browser) skips sending
// entirely, to both destinations.
import posthog from "../analytics/posthogDraft";

export class Analytics {
  // A nonce regenerated per page load, attached only to image-failure
  // reports so the health check can say "3 page loads saw failures" rather
  // than "512 failures" -- not a user identifier, never persisted.
  readonly pageLoadId: string;

  constructor(private internalTrafficKey: string) {
    this.pageLoadId = Analytics.generatePageLoadId();
  }

  track(name: string, props?: Record<string, unknown>): void {
    // localStorage.getItem is now inside the try too, not just the fetch
    // below it: storage access can throw in privacy-strict browser
    // contexts (strict tracking protection, certain private-browsing
    // configurations), and this call used to sit unprotected ahead of the
    // try -- any caller during early, synchronous app startup (before the
    // feed has rendered) would have that throw abort everything after it,
    // not just this one measurement. See TranquiloLightbox.ts's open()
    // comment: "measurement must never sit upstream of the thing it measures."
    try {
      if (localStorage.getItem(this.internalTrafficKey)) return;
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_name: name, props: props || {} }),
        keepalive: true,
      }).catch(() => {});
      posthog?.capture(name, props);
    } catch (_e) {}
  }

  private static generatePageLoadId(): string {
    try {
      if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID().slice(0, 8);
      }
    } catch (_e) {}
    return Math.random().toString(36).slice(2, 10);
  }
}
