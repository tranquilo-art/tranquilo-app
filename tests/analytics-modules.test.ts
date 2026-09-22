// posthogDraft.ts and cloudflareBeacon.ts both run real work at import
// time (syncInternalTrafficFlag(), then their own init*() call), so this
// suite re-imports them fresh per test via vi.resetModules() -- a plain
// import would only ever exercise whichever state ran first.
//
// Regression coverage for the incident this file exists to catch: both
// modules used to throw when disabled (no token configured, or traffic
// that doesn't qualify), which is the state every dev/test/CI/preview
// load is in -- and since both are bare side-effect imports in
// src/app.ts, that throw aborted the app's entire module graph. Neither
// module may throw on import, in any of the disabled branches below.
//
// A second incident, same shape: once Analytics.ts (src/app/Analytics.ts)
// started importing posthogDraft.ts to mirror events to PostHog, a plain
// Node-based test importing Analytics.ts -- no `location` global at all,
// not just a non-production one -- crashed the same way. `location` being
// entirely absent needs the same "disabled, don't throw" treatment as
// every other branch here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function stubProductionSite() {
  vi.stubGlobal("location", { hostname: "tranquilo.art", search: "" });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
}

function stubNonProductionSite() {
  vi.stubGlobal("location", { hostname: "localhost", search: "" });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("posthog-js");
});

describe("initPosthog", () => {
  it("returns null without throwing when `location` doesn't exist at all (a plain Node import)", async () => {
    vi.stubGlobal("location", undefined);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_POSTHOG_TOKEN", "test-token");
    const { default: instance, initPosthog } = await import(
      "../src/analytics/posthogDraft"
    );
    expect(instance).toBeNull();
    expect(initPosthog()).toBeNull();
  });

  it("returns null without throwing when no token is configured", async () => {
    stubProductionSite();
    vi.stubEnv("VITE_POSTHOG_TOKEN", "");
    const { default: instance, initPosthog } = await import(
      "../src/analytics/posthogDraft"
    );
    expect(instance).toBeNull();
    expect(initPosthog()).toBeNull();
  });

  it("returns null without throwing on a non-production host, even with a token", async () => {
    stubNonProductionSite();
    vi.stubEnv("VITE_POSTHOG_TOKEN", "test-token");
    const { default: instance } = await import("../src/analytics/posthogDraft");
    expect(instance).toBeNull();
  });

  it("initializes posthog-js exactly once, anonymously, when both a token and real traffic are present", async () => {
    stubProductionSite();
    vi.stubEnv("VITE_POSTHOG_TOKEN", "test-token");
    const init = vi.fn();
    vi.doMock("posthog-js", () => ({ default: { init } }));

    const { default: instance } = await import("../src/analytics/posthogDraft");

    expect(init).toHaveBeenCalledOnce();
    const [token, config] = init.mock.calls[0];
    expect(token).toBe("test-token");
    // The strictest-anonymous-mode contract pages/privacy.html promises --
    // a regression here is a silent privacy-policy violation, not just a
    // config typo.
    expect(config).toMatchObject({
      person_profiles: "never",
      disable_session_recording: true,
      capture_heatmaps: false,
      disable_surveys: true,
      disable_web_experiments: true,
    });
    expect(instance).toBeTruthy();
  });
});

describe("initCloudflareAnalytics", () => {
  it("injects nothing without throwing when no token is configured", async () => {
    stubProductionSite();
    vi.stubEnv("VITE_CLOUDFLARE_BEACON_TOKEN", "");
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(),
      head: { appendChild },
    });
    await import("../src/analytics/cloudflareBeacon");
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("injects nothing without throwing on a non-production host, even with a token", async () => {
    stubNonProductionSite();
    vi.stubEnv("VITE_CLOUDFLARE_BEACON_TOKEN", "test-token");
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(),
      head: { appendChild },
    });
    await import("../src/analytics/cloudflareBeacon");
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("injects the beacon script with the configured token when real traffic is present", async () => {
    stubProductionSite();
    vi.stubEnv("VITE_CLOUDFLARE_BEACON_TOKEN", "test-token");
    const script: any = { setAttribute: vi.fn() };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => script),
      head: { appendChild },
    });

    await import("../src/analytics/cloudflareBeacon");

    expect(script.src).toBe(
      "https://static.cloudflareinsights.com/beacon.min.js",
    );
    expect(script.setAttribute).toHaveBeenCalledWith(
      "data-cf-beacon",
      JSON.stringify({ token: "test-token" }),
    );
    expect(appendChild).toHaveBeenCalledWith(script);
  });
});
