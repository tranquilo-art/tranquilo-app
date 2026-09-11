// CatalogueCache owns the accumulating page cache (items/itemsById/itemsByKey) --
// see src/app/CatalogueCache.ts's own header comment for the "not the catalogue" rationale.
import { describe, expect, it } from "vitest";
import { CatalogueCache } from "../src/app/CatalogueCache";

describe("absorbPage", () => {
  it("adds new rows to items/itemsById/itemsByKey", () => {
    const cache = new CatalogueCache();
    const absorbed = cache.absorbPage([
      { id: "1", source: "met" },
      { id: "2", source: "cleveland" },
    ]);
    expect(cache.items).toHaveLength(2);
    expect(cache.itemsById["1"].source).toBe("met");
    expect(cache.itemsByKey["cleveland:2"].source).toBe("cleveland");
    expect(absorbed).toEqual(cache.items);
  });

  it("marks a newly absorbed row as not yet full", () => {
    const cache = new CatalogueCache();
    cache.absorbPage([{ id: "1", source: "met" }]);
    expect(cache.itemsById["1"]._full).toBe(false);
  });

  it("returns the SAME object instance for a row already seen, preserving identity", () => {
    const cache = new CatalogueCache();
    const [first] = cache.absorbPage([{ id: "1", source: "met" }]);
    first.title = "Wheat Field"; // simulates later hydration merging into the object
    const [second] = cache.absorbPage([{ id: "1", source: "met" }]);
    expect(second).toBe(first);
    expect(second.title).toBe("Wheat Field");
    expect(cache.items).toHaveLength(1);
  });

  it("keys on source:id, so the same native id under two sources is not deduped", () => {
    const cache = new CatalogueCache();
    cache.absorbPage([
      { id: "107208", source: "met" },
      { id: "107208", source: "cleveland" },
    ]);
    expect(cache.items).toHaveLength(2);
    expect(cache.itemsByKey["met:107208"]).not.toBe(
      cache.itemsByKey["cleveland:107208"],
    );
  });

  it("indexes itemsById by the bare id, last writer wins across sources", () => {
    // itemsById is keyed on the bare id alone, so two sources sharing a
    // native id collide there; itemsByKey is what disambiguates them.
    const cache = new CatalogueCache();
    cache.absorbPage([{ id: "107208", source: "met" }]);
    cache.absorbPage([{ id: "107208", source: "cleveland" }]);
    expect(cache.itemsById["107208"].source).toBe("cleveland");
  });
});
