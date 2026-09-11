// CollectionStore owns the Collect/bookmark localStorage store -- see
// src/app/CollectionStore.ts's own header for the keying/migration
// rationale. No DOM environment is configured for this suite, so
// localStorage is stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionStore } from "../src/app/CollectionStore";

const KEY = "tranquilo:collection";
const KNOWN_SOURCES = [
  "met",
  "smithsonian",
  "cleveland",
  "commons",
  "europeana",
];

let store: Record<string, string>;

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
});

function makeStore(
  host?: Partial<{
    resolveItemsByIds: (ids: string[]) => Promise<unknown>;
    getItemSource: (id: string) => string | undefined;
  }>,
) {
  return new CollectionStore(KEY, KNOWN_SOURCES, {
    resolveItemsByIds: host?.resolveItemsByIds ?? (() => Promise.resolve()),
    getItemSource: host?.getItemSource ?? (() => undefined),
  });
}

describe("keyFor", () => {
  it("keys on source:id", () => {
    const cs = makeStore();
    expect(cs.keyFor({ source: "met", id: "436572" })).toBe("met:436572");
  });

  it("produces a visible tripwire when source is missing", () => {
    const cs = makeStore();
    expect(cs.keyFor({ id: "123" } as { source?: string; id: string })).toBe(
      "undefined:123",
    );
  });
});

describe("isCollectionKey", () => {
  it("recognizes a source-prefixed key", () => {
    const cs = makeStore();
    expect(cs.isCollectionKey("met:436572")).toBe(true);
  });

  it("does not mistake a colon-bearing Commons native_id for a key", () => {
    const cs = makeStore();
    expect(cs.isCollectionKey("File:A Colorful Spring.jpg")).toBe(false);
  });

  it("rejects a bare id with no colon", () => {
    const cs = makeStore();
    expect(cs.isCollectionKey("436572")).toBe(false);
  });
});

describe("getAll / isCollected / count", () => {
  it("returns an empty collection by default", () => {
    const cs = makeStore();
    expect(cs.getAll()).toEqual([]);
    expect(cs.count()).toBe(0);
  });

  it("normalizes legacy numeric entries to strings", () => {
    store[KEY] = JSON.stringify([436572]);
    const cs = makeStore();
    expect(cs.getAll()).toEqual(["436572"]);
  });

  it("returns an empty array when the stored value is corrupt JSON", () => {
    store[KEY] = "{not json";
    const cs = makeStore();
    expect(cs.getAll()).toEqual([]);
  });

  it("recognizes both the new keyed format and a legacy bare id", () => {
    store[KEY] = JSON.stringify(["met:436572", "999"]);
    const cs = makeStore();
    expect(cs.isCollected({ source: "met", id: "436572" })).toBe(true);
    expect(cs.isCollected({ source: "met", id: "999" })).toBe(true);
    expect(cs.isCollected({ source: "met", id: "111" })).toBe(false);
    expect(cs.count()).toBe(2);
  });
});

describe("toggle", () => {
  it("adds a new keyed entry and reports now-collected", () => {
    const cs = makeStore();
    const nowCollected = cs.toggle({ source: "met", id: "436572" });
    expect(nowCollected).toBe(true);
    expect(cs.getAll()).toEqual(["met:436572"]);
  });

  it("removes an existing keyed entry and reports now-uncollected", () => {
    store[KEY] = JSON.stringify(["met:436572"]);
    const cs = makeStore();
    const nowCollected = cs.toggle({ source: "met", id: "436572" });
    expect(nowCollected).toBe(false);
    expect(cs.getAll()).toEqual([]);
  });

  it("removes a legacy bare-id entry on the same click that would remove the new one", () => {
    store[KEY] = JSON.stringify(["436572"]);
    const cs = makeStore();
    const nowCollected = cs.toggle({ source: "met", id: "436572" });
    expect(nowCollected).toBe(false);
    expect(cs.getAll()).toEqual([]);
  });
});

describe("migrate", () => {
  it("resolves nothing when every entry is already keyed", async () => {
    store[KEY] = JSON.stringify(["met:436572"]);
    const resolveItemsByIds = vi.fn(() => Promise.resolve());
    const cs = makeStore({ resolveItemsByIds });
    const result = await cs.migrate();
    expect(result).toEqual({ total: 1, changed: false });
    expect(resolveItemsByIds).not.toHaveBeenCalled();
  });

  it("rewrites a resolvable legacy bare id to source:id", async () => {
    store[KEY] = JSON.stringify(["436572"]);
    const cs = makeStore({
      resolveItemsByIds: () => Promise.resolve(),
      getItemSource: (id) => (id === "436572" ? "met" : undefined),
    });
    const result = await cs.migrate();
    expect(result).toEqual({ total: 1, changed: true });
    expect(cs.getAll()).toEqual(["met:436572"]);
  });

  it("preserves an unresolvable legacy entry as-is", async () => {
    store[KEY] = JSON.stringify(["999999"]);
    const cs = makeStore({
      resolveItemsByIds: () => Promise.resolve(),
      getItemSource: () => undefined,
    });
    const result = await cs.migrate();
    expect(result).toEqual({ total: 1, changed: false });
    expect(cs.getAll()).toEqual(["999999"]);
  });
});
