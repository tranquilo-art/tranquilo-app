import type vocabulary from "../../shared/vocabulary.json";

// Controlled-vocabulary fields, derived from shared/vocabulary.json rather
// than duplicated as literal unions -- duplicated values is the kind of
// drift that has caused real bugs before (see logic.ts's
// UNKNOWN_ARTIST_PREFIXES comment).
export type Category = (typeof vocabulary.categories)[number];
export type RegionPrimary = (typeof vocabulary.regions)[number];
export type Timeframe = (typeof vocabulary.timeframes)[number];
export type MediaType = (typeof vocabulary.media_types)[number];
export type Palette = (typeof vocabulary.palettes)[number];
export type SubjectType = (typeof vocabulary.subject_types)[number];

export interface TeaVoiceSource {
  text: string;
  url: string;
}

export interface CastMember {
  name: string;
  attribution_confidence?: "normal" | "hedged";
  // Only rendered once "grounded" -- an ungrounded member still gets a
  // list entry, just with a placeholder instead of tidbit/source_url.
  status?: string;
  tidbit?: string;
  source_url?: string;
}

export interface CastContext {
  status: string;
  text: string;
}

// The shape api/items.js's serializeRow() returns. Nullable wherever the
// underlying Postgres column has no NOT NULL constraint.
export interface Item {
  id: string;
  source: string;
  title: string | null;
  artist: string | null;
  bio: string | null;
  attribution_type: string | null;
  artist_nationality: string | null;
  artist_lifespan: string | null;
  culture: string | null;
  culture_period: string | null;
  date: string | null;
  photograph_date: string | null;
  medium: string | null;
  credit: string | null;
  tags: string | null;
  img: string;
  lightbox_img: string;
  blur_placeholder: string | null;
  // TRA-274 Phase 1: additive, ingestion-time visual metadata. Absent
  // (null) for any item not yet backfilled -- consumers must treat these
  // as optional, not assume every item carries them.
  img_width: number | null;
  img_height: number | null;
  palette_hex: string[] | null;
  // Every distinct hue bucket among palette_hex's several colors (the
  // real color filter) -- see classify_palette_buckets() in the ingestion
  // repo. Same 9-value vocabulary as the existing `palette` facet, but
  // multi-valued: an item can carry several.
  palette_buckets: Palette[] | null;
  url: string | null;
  license: string | null;
  category: Category | null;
  region_primary: RegionPrimary | null;
  region_alt: RegionPrimary[] | null;
  timeframe: Timeframe | null;
  media_type: MediaType | null;
  palette: Palette | null;
  subject_type: SubjectType | null;
  accentColor: string | null;
  contains_nudity: boolean | null;
  caption_tea: string | null;
  caption_basic: string | null;
  tea_voice_status: string | null;
  tea_voice_eligible: boolean | null;
  tea_voice_sources: TeaVoiceSource[] | null;
  cast: CastMember[] | null;
  cast_context: CastContext | null;
  cast_tier: string | null;
  storyline_ids: string[] | null;
  // Single-membership, unlike storyline_ids.
  set_of_work_id: string | null;
  twist_category: string | null;
  twist_hook: string | null;
  twist_story: string | null;
  twist_confidence: string | null;
  twist_source_url: string | null;
  music_mood: string | null;
  shuffle_key: number;
  // Computed client-side after fetch, stashed onto the item -- never part
  // of the API response itself.
  _century?: number | null;
  // The manifest (?shape=manifest) omits heavy fields; `_full` marks
  // whether they've since arrived via ?ids= -- absent/false means
  // "manifest row only, do not render yet."
  _full?: boolean;
  // Set alongside `_full` when the server reports an id as missing from an
  // ?ids= response, so an unresolvable id renders as a permanent empty
  // shell instead of retrying forever.
  _unavailable?: boolean;
}
