// ShareService owns share-link URL construction and the native-share-sheet
// vs. clipboard decision. No DOM environment is configured for this
// suite, so location/navigator/window are stubbed directly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareService } from "../src/app/ShareService";

let trackEvent: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;
let encodeSlugId: ReturnType<typeof vi.fn>;

function makeService() {
  trackEvent = vi.fn();
  showToast = vi.fn();
  encodeSlugId = vi.fn((_source: string, rawId: string | number) =>
    String(rawId),
  );
  return new ShareService({ trackEvent, showToast, encodeSlugId });
}

beforeEach(() => {
  vi.stubGlobal("location", { origin: "https://tranquilo.art" });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shareUrlFor", () => {
  it("builds a /v/{source}-{id} URL, defaulting source to met", () => {
    const svc = makeService();
    expect(svc.shareUrlFor({ id: "436572" })).toBe(
      "https://tranquilo.art/v/met-436572",
    );
    expect(encodeSlugId).toHaveBeenCalledWith("met", "436572");
  });

  it("uses the item's own source when present", () => {
    const svc = makeService();
    expect(svc.shareUrlFor({ id: "1", source: "commons" })).toBe(
      "https://tranquilo.art/v/commons-1",
    );
  });
});

describe("storylineShareUrlFor", () => {
  it("builds a /s/{id} URL", () => {
    const svc = makeService();
    expect(svc.storylineShareUrlFor({ id: "el-greco-evolution" })).toBe(
      "https://tranquilo.art/s/el-greco-evolution",
    );
  });
});

describe("shareItem / shareStoryline", () => {
  it("tracks share_click with id and source, then copies the link on desktop", async () => {
    const svc = makeService();
    svc.shareItem({ id: "1", source: "met", title: "Wheat Field" });
    expect(trackEvent).toHaveBeenCalledWith("share_click", {
      id: "1",
      source: "met",
    });
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
  });

  it("tracks share_click with storyline_id", () => {
    const svc = makeService();
    svc.shareStoryline({
      id: "el-greco-evolution",
      title: "El Greco",
      items: [1, 2, 3],
    });
    expect(trackEvent).toHaveBeenCalledWith("share_click", {
      storyline_id: "el-greco-evolution",
    });
  });
});

describe("shareLink / copyShareLink (no navigator.share, desktop path)", () => {
  it("copies the link and toasts success", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    expect(writeText).toHaveBeenCalledWith("https://tranquilo.art/v/met-1");
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Link copied"),
    );
  });

  it("toasts failure when the clipboard write rejects", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const svc = makeService();
    svc.copyShareLink("https://tranquilo.art/v/met-1");
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't copy link"),
    );
  });

  it("toasts failure when there is no clipboard API at all", () => {
    vi.stubGlobal("navigator", {});
    const svc = makeService();
    svc.copyShareLink("https://tranquilo.art/v/met-1");
    expect(showToast).toHaveBeenCalledWith("Couldn't copy link");
  });
});

describe("shareLink (navigator.share path)", () => {
  it("uses the native share sheet on a coarse pointer and does not toast on success", async () => {
    const share = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { share });
    vi.stubGlobal("window", {});
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    expect(share).toHaveBeenCalledWith({
      title: "Title",
      text: "Text",
      url: "https://tranquilo.art/v/met-1",
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("falls back to clipboard copy on desktop even though navigator.share exists", () => {
    const share = vi.fn(() => Promise.resolve());
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    vi.stubGlobal("window", {
      matchMedia: () => ({ matches: true }),
    });
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalled();
  });

  it("falls through to clipboard copy when navigator.share throws synchronously", () => {
    vi.stubGlobal("navigator", {
      share: () => {
        throw new TypeError("bad data");
      },
    });
    vi.stubGlobal("window", {});
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    expect(showToast).toHaveBeenCalledWith("Couldn't copy link");
  });

  it("swallows a slow AbortError as a genuine cancellation, no clipboard fallback", async () => {
    // Advancing the mocked Date.now() between the startedAt read and the
    // rejection handler simulates the sheet's dismiss animation elapsing.
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const err = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const share = vi.fn(() => {
      now += 500;
      return Promise.reject(err);
    });
    vi.stubGlobal("navigator", { share });
    vi.stubGlobal("window", {});
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    await vi.waitFor(() => expect(share).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("falls through to clipboard when the AbortError arrives faster than the sheet could animate in", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const err = Object.assign(new Error("no sheet"), { name: "AbortError" });
    const share = vi.fn(() => {
      now += 5;
      return Promise.reject(err);
    });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    vi.stubGlobal("window", {});
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  });

  it("falls back to clipboard when navigator.share rejects with a non-cancellation error", async () => {
    const err = Object.assign(new Error("no target"), {
      name: "NotAllowedError",
    });
    const share = vi.fn(() => Promise.reject(err));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { share, clipboard: { writeText } });
    vi.stubGlobal("window", {});
    const svc = makeService();
    svc.shareLink("https://tranquilo.art/v/met-1", "Title", "Text");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
  });
});
