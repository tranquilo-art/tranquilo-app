import type { Item } from "../types/Item";

// `items` is not the catalogue -- it's an accumulating cache of pages this
// session has actually seen, in server order. `items.filter(...)` therefore
// answers from a partial set, not the full catalogue; it would not throw if misused this way.
export class CatalogueCache {
  readonly items: Item[] = [];
  readonly itemsById: Record<string, Item> = {};
  // source:native_id, matching dedupe_key()
  readonly itemsByKey: Record<string, Item> = {};

  // Preserves object identity for rows already seen -- the feed, the
  // collection and every slideRecord alias these objects, and hydration
  // merges into them, so replacing one would strand existing references.
  absorbPage(rows: any[]): Item[] {
    return rows.map((row: any) => {
      const key = `${row.source}:${row.id}`;
      const existing = this.itemsByKey[key];
      if (existing) {
        return existing;
      }
      // _full marks whether the heavy render fields (title, medium, tags,
      // bio, img, blur_placeholder, captions) have arrived yet.
      row._full = false;
      this.items.push(row);
      this.itemsById[row.id] = row;
      this.itemsByKey[key] = row;
      return row;
    });
  }
}
