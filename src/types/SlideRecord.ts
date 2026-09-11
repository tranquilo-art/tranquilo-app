import type { ImageState } from "../feed/slideBuilder";
import type { Item } from "./Item";

// One record per feedEl child, in DOM order, including non-item slides
// (marked `permanent`) -- keeping them in the array keeps record index and
// DOM child index the same number, with no offset to get wrong.
export interface SlideRecord {
  el: HTMLElement;
  item: Item | null;
  // Never recycled. hydrateSlide()/dehydrateSlide() are no-ops for these.
  permanent: boolean;
  hydrated: boolean;
  // Set by hydrateSlide(), read by dehydrateSlide() to cancel a pending
  // image load before releasing the slide.
  imageState?: ImageState | null;
}
