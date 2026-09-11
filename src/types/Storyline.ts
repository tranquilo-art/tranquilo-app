// Item ids are usually numeric, but a few are Wikimedia Commons filename
// strings -- id is always a string at runtime, but literals here are still
// written as JS numbers wherever the source native id is numeric.
export type StoryItemId = number | string;

export interface StorylineChapter {
  id: StoryItemId;
  position: number;
  chapter_caption: string;
}

// `tier` is a plain string literal union, not the StorylineTier enum,
// since the frozen fixture data was never converted to reference it.
// `type` is a free-text editorial label describing the kind of connection,
// not a controlled vocabulary.
export interface Storyline {
  id: string;
  title: string;
  type: string;
  tier: "structural" | "narrative";
  cover_item_id: StoryItemId;
  intro_caption: string;
  // Required when tier is "narrative"; a "structural" storyline's
  // connection is already visible in the items' own fields.
  source_note?: string;
  items: StorylineChapter[];
}

// The eager half of a storyline, fetched once at feed-init for the two
// always-on consumers: slideBuilder's chip/position label and the
// "Storylines" hero shelf. Deliberately omits title/intro_caption/
// source_note/caption text -- the full Storyline is fetched lazily, one at
// a time, only when a reader opens it.
export interface StorylineIndexEntry {
  id: string;
  cover_item_id: StoryItemId;
  items: Pick<StorylineChapter, "id" | "position">[];
}
