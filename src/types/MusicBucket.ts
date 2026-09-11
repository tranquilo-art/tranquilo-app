import type { Category } from "./Item";

// Matches a music_buckets row, fetched via GET /api/items?shape=music.
// `track` (and its dependent fields) is null when the bucket is genuinely
// unsourced -- a null-track bucket keeps whatever was already playing
// rather than fading to silence, so null is load-bearing here, not "not
// yet filled in". `category` states the bucket's 1:1 relationship with
// Category; null is permanent for "asian-art" since no category maps to it.
export interface MusicBucket {
  label: string;
  track: string | null;
  credit: string | null;
  creditUrl: string | null;
  license: string | null;
  category: Category | null;
}

// The bucket keys themselves, a separate namespace from Category:
// "asian-art" has no current category mapping, and the Category-to-bucket
// mapping is its own data, not implied by this list.
export type MusicBucketKey =
  | "paintings"
  | "sculpture-decorative-arts"
  | "prints-drawings"
  | "asian-art"
  | "photographs"
  | "arms-armor";
