import type { Item } from "./Item";
import type { StoryItemId } from "./Storyline";

interface ShelfBase {
  id: string;
  title: string;
}

// `type` is a plain string literal, not the ShelfType enum, since a shelf
// arrives as JSON over the wire and JSON has no enum-value concept.

// A fixed, hand-curated list. Doesn't scale with catalogue size and isn't meant to.
export interface HeroShelf extends ShelfBase {
  type: "hero";
  itemIds: StoryItemId[];
}

// A generic filter matched against `item[key] === value` for every key
// present, evaluated at render time, gated by minItems (the shelf only
// renders once its filter currently qualifies at least that many items).
export interface RuleShelf extends ShelfBase {
  type: "rule";
  filter: Partial<Item>;
  minItems: number;
}

export type Shelf = HeroShelf | RuleShelf;
