// Cloudflare Web Analytics -- loaded on index.html, pages/about.html,
// pages/pro.html and pages/submit.html. Conditionally injected: skipped on
// a team member's own opted-out device and everywhere but the production
// hostname (see trafficGate.ts).
import { isRealExternalTraffic, syncInternalTrafficFlag } from "./trafficGate";

syncInternalTrafficFlag();

interface BeaconOptions {
  token: string;
}

export class CloudflareAnalytics {
  private readonly endpoint = "https://static.cloudflareinsights.com/beacon.min.js";
  private token: string;

  constructor(options: BeaconOptions) {
    this.token = options.token;
  }
  // The clean method you call to inject the script
  public load(): void {
    const script = document.createElement("script");
    script.type = "module";
    script.src = this.endpoint;
    script.setAttribute("data-cf-beacon", JSON.stringify({ token: this.token }));

    document.head.appendChild(script);
  }
}

/**
 * @returns void
 * @throws Error if Cloudflare analytics token is not set.
 */
export function initCloudflareAnalytics() {
  const CLOUDFLARE_BEACON_TOKEN = import.meta.env.VITE_CLOUDFLARE_BEACON_TOKEN;
  if (isRealExternalTraffic() && CLOUDFLARE_BEACON_TOKEN) {
    const analytics = new CloudflareAnalytics({ token: CLOUDFLARE_BEACON_TOKEN });
    analytics.load();
    return;
  }

  throw new Error("Cloudflare analytics token is not set.");
}

initCloudflareAnalytics();
