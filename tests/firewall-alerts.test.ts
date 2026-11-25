// The daily firewall digest: one visitor far above everyone else, or a jump
// in denied/challenged requests, read from Vercel's observability API.
import { describe, expect, it } from "vitest";
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { checkFirewallTraffic } from "../lib/firewall-alerts.ts";

const limits = TRANQUILO_CONFIG.firewall_alerts;
const ENV = {
  VERCEL_API_TOKEN: "test-token",
  VERCEL_PROJECT_ID: "prj_test",
  VERCEL_ORG_ID: "team_test",
};
const NOW = new Date("2026-11-25T08:00:00Z");

type Row = Record<string, string | number>;

const client = (asn: string, ja4: string, hour: string, n: number): Row => ({
  timestamp: `2026-11-24T${hour}:00:00.000Z`,
  asn_name: asn,
  client_ja4_digest: ja4,
  vercel_request_count_sum: n,
});

const day = (date: string, action: string, n: number): Row => ({
  timestamp: `${date}T00:00:00.000Z`,
  waf_action: action,
  vercel_request_count_sum: n,
});

const normalWeek = (action: string, n: number): Row[] =>
  [17, 18, 19, 20, 21, 22, 23].map((d) => day(`2026-11-${d}`, action, n));

function fakeApi(clients: Row[], actions: Row[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = JSON.parse(String(init.body));
    const data = body.groupBy.includes("wafAction") ? actions : clients;
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("checkFirewallTraffic", () => {
  it("stays quiet on ordinary traffic", async () => {
    const api = fakeApi(
      [client("ISP", "ja4a", "10", 300)],
      [...normalWeek("deny", 120), day("2026-11-24", "deny", 150)],
    );
    expect(await checkFirewallTraffic(api.fn, ENV, NOW)).toEqual([]);
  });

  it("flags one visitor's busy hour, naming network and fingerprint", async () => {
    const api = fakeApi(
      [client("Cable Onda", "ja4x", "19", limits.client_requests_per_hour_min)],
      [],
    );
    const lines = await checkFirewallTraffic(api.fn, ENV, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Cable Onda");
    expect(lines[0]).toContain("ja4x");
  });

  it("judges a visitor by its busiest hour, not its day", async () => {
    const steady = Array.from({ length: 10 }, (_, h) =>
      client("ISP", "ja4a", String(h).padStart(2, "0"), 100),
    );
    const api = fakeApi(steady, []);
    expect(await checkFirewallTraffic(api.fn, ENV, NOW)).toEqual([]);
  });

  it("flags denials well above the prior week's median", async () => {
    const api = fakeApi(
      [],
      [...normalWeek("deny", 120), day("2026-11-24", "deny", 120 * 4)],
    );
    const lines = await checkFirewallTraffic(api.fn, ENV, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/denied/);
    expect(lines[0]).toContain("480");
  });

  it("ignores a jump too small to matter", async () => {
    const api = fakeApi(
      [],
      [
        ...normalWeek("challenge", 5),
        day("2026-11-24", "challenge", limits.action_spike_floor - 1),
      ],
    );
    expect(await checkFirewallTraffic(api.fn, ENV, NOW)).toEqual([]);
  });

  it("never alerts on allowed traffic volume", async () => {
    const api = fakeApi(
      [],
      [...normalWeek("allow", 2000), day("2026-11-24", "allow", 20000)],
    );
    expect(await checkFirewallTraffic(api.fn, ENV, NOW)).toEqual([]);
  });

  it("says so when it cannot run, instead of staying silent", async () => {
    const api = fakeApi([], []);
    const lines = await checkFirewallTraffic(api.fn, {}, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/VERCEL_API_TOKEN/);
    expect(api.calls).toHaveLength(0);
  });

  it("says so when the API refuses, instead of staying silent", async () => {
    const failing = (async () =>
      new Response("{}", { status: 403 })) as unknown as typeof fetch;
    const lines = await checkFirewallTraffic(failing, ENV, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/403/);
  });

  it("sends the token only to the Vercel API", async () => {
    const api = fakeApi([], []);
    await checkFirewallTraffic(api.fn, ENV, NOW);
    for (const call of api.calls) {
      expect(call.url.startsWith("https://api.vercel.com/")).toBe(true);
    }
  });
});
