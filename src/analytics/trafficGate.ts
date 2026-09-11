// Shared by every analytics beacon (Cloudflare Web Analytics, the PostHog
// draft), since a divergence between them would mean one beacon quietly
// reports traffic the other suppresses.
//
// A team member's own device-level opt-out, set via ?tranquilo_internal=1
// (cleared via =0). Deliberately not IP-based: dev/team IPs change
// constantly, so a device flag is the one mechanism covering both beacons.
// Never touches or identifies real visitors.
const INTERNAL_TRAFFIC_KEY = "tranquilo:internalTraffic";

// Idempotent -- safe to call from every beacon's own entrypoint regardless
// of script load order.
export function syncInternalTrafficFlag(): void {
  const params = new URLSearchParams(location.search);
  if (!params.has("tranquilo_internal")) return;
  if (params.get("tranquilo_internal") === "0") {
    localStorage.removeItem(INTERNAL_TRAFFIC_KEY);
  } else {
    localStorage.setItem(INTERNAL_TRAFFIC_KEY, "1");
  }
}

// Never report from anywhere that is not the real site. The opt-out above
// is localStorage-based and gets wiped by any fresh browser context
// (Playwright creates one per test), so a hostname check covers the e2e
// suite, local dev and preview deploys where the opt-out can't.
export function isRealExternalTraffic(): boolean {
  if (location.hostname !== "tranquilo.art") return false;
  if (localStorage.getItem(INTERNAL_TRAFFIC_KEY)) return false;
  return true;
}
