// Analytics owns the api/track fire-and-forget beacon and the per-page-load
// nonce, extracted out of src/app.ts's own start() (see that file's own
// header comment). No DOM environment is configured for this project's
// Vitest suite (see vitest.config.mts), so localStorage/fetch/window are
// stubbed directly rather than pulled from jsdom.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Analytics } from "../src/app/Analytics";

const KEY = "tranquilo:internalTraffic";

let store: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  });
  fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {});
});

describe("track", () => {
  it("posts the event name and props to /api/track", () => {
    const analytics = new Analytics(KEY);
    analytics.track("share_click", { id: "1", source: "met" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/track");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      event_name: "share_click",
      props: { id: "1", source: "met" },
    });
  });

  it("defaults props to an empty object", () => {
    const analytics = new Analytics(KEY);
    analytics.track("music_toggle");

    const [, opts] = fetchMock.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      event_name: "music_toggle",
      props: {},
    });
  });

  it("sends nothing at all once the internal-traffic flag is set", () => {
    store[KEY] = "1";
    const analytics = new Analytics(KEY);
    analytics.track("share_click", {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws even if fetch itself throws synchronously", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("network down");
    });
    const analytics = new Analytics(KEY);
    expect(() => analytics.track("share_click", {})).not.toThrow();
  });
});

describe("pageLoadId", () => {
  it("is an 8-character nonce", () => {
    const analytics = new Analytics(KEY);
    expect(analytics.pageLoadId).toHaveLength(8);
  });

  it("differs between instances (falls back to Math.random without crypto)", () => {
    const a = new Analytics(KEY);
    const b = new Analytics(KEY);
    expect(a.pageLoadId).not.toBe(b.pageLoadId);
  });

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("window", {
      crypto: { randomUUID: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    });
    const analytics = new Analytics(KEY);
    expect(analytics.pageLoadId).toBe("aaaaaaaa");
  });
});
