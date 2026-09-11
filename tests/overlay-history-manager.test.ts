// OverlayHistoryManager owns the browser-history integration for the
// app's seven mutually-exclusive overlays -- a single flat depth counter
// plus the popstate/Escape reducers. No DOM environment is configured for
// this suite, so window/document/history/location are stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OverlayHistoryHost,
  OverlayHistoryManager,
} from "../src/app/OverlayHistoryManager";

function fakeOverlayEl(open = false) {
  const classes = new Set<string>(open ? ["open"] : []);
  return {
    classList: {
      contains: (c: string) => classes.has(c),
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
    } as unknown as DOMTokenList,
    close: vi.fn(),
  };
}

function makeHost(overrides: Partial<OverlayHistoryHost> = {}) {
  const host = {
    detailModalEl: fakeOverlayEl(),
    shelvesModeEl: fakeOverlayEl(),
    storylineModeEl: fakeOverlayEl(),
    setOfWorksModeEl: fakeOverlayEl(),
    lightboxEl: fakeOverlayEl(),
    exportModalEl: fakeOverlayEl(),
    isSearchOpen: vi.fn(() => false),
    closeSearch: vi.fn(),
    ...overrides,
  };
  return host as unknown as OverlayHistoryHost;
}

let popstateHandlers: Array<() => void>;
let keydownHandlers: Array<(e: { key: string }) => void>;
let pushStateCalls: unknown[][];
let backCalls: number;

beforeEach(() => {
  popstateHandlers = [];
  keydownHandlers = [];
  pushStateCalls = [];
  backCalls = 0;

  vi.stubGlobal("window", {
    addEventListener: (type: string, handler: () => void) => {
      if (type === "popstate") popstateHandlers.push(handler);
    },
  });
  vi.stubGlobal("document", {
    addEventListener: (type: string, handler: (e: { key: string }) => void) => {
      if (type === "keydown") keydownHandlers.push(handler);
    },
  });
  vi.stubGlobal("history", {
    pushState: (...args: unknown[]) => {
      pushStateCalls.push(args);
    },
    back: () => {
      backCalls++;
    },
  });
  vi.stubGlobal("location", { href: "https://tranquilo.art/" });
});

describe("push", () => {
  it("pushes a history entry naming the overlay", () => {
    const manager = new OverlayHistoryManager(makeHost());
    manager.push("lightbox");
    expect(pushStateCalls).toEqual([
      [{ overlay: "lightbox" }, "", "https://tranquilo.art/"],
    ]);
  });
});

describe("requestClose", () => {
  it("closes directly when nothing was pushed", () => {
    const manager = new OverlayHistoryManager(makeHost());
    const closeFn = vi.fn();
    manager.requestClose(closeFn);
    expect(closeFn).toHaveBeenCalledOnce();
    expect(backCalls).toBe(0);
  });

  it("routes through history.back() instead of calling closeFn, once a state was pushed", () => {
    const manager = new OverlayHistoryManager(makeHost());
    manager.push("lightbox");
    const closeFn = vi.fn();
    manager.requestClose(closeFn);
    expect(closeFn).not.toHaveBeenCalled();
    expect(backCalls).toBe(1);
  });
});

describe("closeSync", () => {
  it("always calls closeFn immediately", () => {
    const manager = new OverlayHistoryManager(makeHost());
    const closeFn = vi.fn();
    manager.closeSync(closeFn);
    expect(closeFn).toHaveBeenCalledOnce();
    expect(backCalls).toBe(0);
  });

  it("also pops the stray history entry when one is pending", () => {
    const manager = new OverlayHistoryManager(makeHost());
    manager.push("search");
    const closeFn = vi.fn();
    manager.closeSync(closeFn);
    expect(closeFn).toHaveBeenCalledOnce();
    expect(backCalls).toBe(1);
  });
});

describe("attach", () => {
  it("registers exactly one popstate and one keydown listener", () => {
    const manager = new OverlayHistoryManager(makeHost());
    manager.attach();
    expect(popstateHandlers).toHaveLength(1);
    expect(keydownHandlers).toHaveLength(1);
  });
});

describe("popstate handling", () => {
  // Real stacking order: lightbox (300) > storyline (250) > set-of-works
  // (245) > shelves (240) > detail-modal/export-modal (200) > search.
  it("closes only the topmost-open overlay when several are flagged open", () => {
    const host = makeHost({
      detailModalEl: fakeOverlayEl(true),
      storylineModeEl: fakeOverlayEl(true),
    });
    const manager = new OverlayHistoryManager(host);
    manager.attach();
    manager.push("storyline");

    popstateHandlers[0]();

    expect(host.storylineModeEl.close).toHaveBeenCalledOnce();
    expect(host.detailModalEl.close).not.toHaveBeenCalled();
  });

  it("closes the lightbox ahead of every other overlay", () => {
    const host = makeHost({
      lightboxEl: fakeOverlayEl(true),
      storylineModeEl: fakeOverlayEl(true),
    });
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    popstateHandlers[0]();

    expect(host.lightboxEl.close).toHaveBeenCalledOnce();
    expect(host.storylineModeEl.close).not.toHaveBeenCalled();
  });

  it("falls through to closeSearch() when search is the only thing open", () => {
    const host = makeHost({ isSearchOpen: vi.fn(() => true) });
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    popstateHandlers[0]();

    expect(host.closeSearch).toHaveBeenCalledOnce();
  });

  it("closes nothing when no overlay is open", () => {
    const host = makeHost();
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    popstateHandlers[0]();

    for (const el of [
      host.detailModalEl,
      host.shelvesModeEl,
      host.storylineModeEl,
      host.setOfWorksModeEl,
      host.lightboxEl,
      host.exportModalEl,
    ]) {
      expect(el.close).not.toHaveBeenCalled();
    }
    expect(host.closeSearch).not.toHaveBeenCalled();
  });
});

describe("Escape handling", () => {
  it("ignores every key other than Escape", () => {
    const host = makeHost({ lightboxEl: fakeOverlayEl(true) });
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    keydownHandlers[0]({ key: "Enter" });

    expect(host.lightboxEl.close).not.toHaveBeenCalled();
    expect(backCalls).toBe(0);
  });

  it("routes through history.back() when an overlay is open and a state was pushed", () => {
    const host = makeHost({ lightboxEl: fakeOverlayEl(true) });
    const manager = new OverlayHistoryManager(host);
    manager.attach();
    manager.push("lightbox");

    keydownHandlers[0]({ key: "Escape" });

    expect(backCalls).toBe(1);
    expect(host.lightboxEl.close).not.toHaveBeenCalled();
  });

  it("falls back to closing every overlay directly when nothing was pushed", () => {
    const host = makeHost({ isSearchOpen: vi.fn(() => true) });
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    keydownHandlers[0]({ key: "Escape" });

    expect(host.detailModalEl.close).toHaveBeenCalledOnce();
    expect(host.storylineModeEl.close).toHaveBeenCalledOnce();
    expect(host.setOfWorksModeEl.close).toHaveBeenCalledOnce();
    expect(host.shelvesModeEl.close).toHaveBeenCalledOnce();
    expect(host.lightboxEl.close).toHaveBeenCalledOnce();
    expect(host.exportModalEl.close).toHaveBeenCalledOnce();
    expect(host.closeSearch).toHaveBeenCalledOnce();
  });

  // The regression this guards: detailModalEl.close() can itself reopen
  // shelvesMode as part of restoring Discover, and an unconditional
  // shelvesModeEl.close() right after would immediately undo that.
  it("does not close shelves when the detail modal is returning to it", () => {
    const detailModalEl = {
      ...fakeOverlayEl(),
      isReturningToShelves: true,
    };
    const host = makeHost({ detailModalEl });
    const manager = new OverlayHistoryManager(host);
    manager.attach();

    keydownHandlers[0]({ key: "Escape" });

    expect(host.shelvesModeEl.close).not.toHaveBeenCalled();
  });
});
