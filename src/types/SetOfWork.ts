// "Set of works" -- items confirmed to be genuinely distinct real objects
// that share a title/artist (e.g. two separately-accessioned Rodin "The
// Thinker" castings), badged and click-through to a small comparison view.
//
// Same eager/lazy split as Storyline.ts's Storyline/StorylineIndexEntry.
export interface SetOfWorkMember {
  id: string;
  distinguishing_trait: string;
}

export interface SetOfWork {
  id: string;
  title: string;
  items: SetOfWorkMember[];
}

// The eager half, fetched once at feed-init for the two always-on
// consumers: slideBuilder's chip/position label and TranquiloDetailModal's
// copy of the same chip. Omits `title`/`distinguishing_trait` -- the full
// SetOfWork is fetched lazily, one at a time, only when opened.
export interface SetOfWorkIndexEntry {
  id: string;
  items: Pick<SetOfWorkMember, "id">[];
}
