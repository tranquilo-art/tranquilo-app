// Serves the Tranquilo catalogue. Every field name and shape matches
// what app.ts expects.
//
// Renames two columns at serialization time (see sql/001_items_schema.sql):
// full_img -> full, accent_color -> accentColor. native_id becomes the
// JSON `id`; the composite source:native_id primary key stays invisible
// to the client.
//
// Cached at the CDN with a short TTL: the ingestion pipeline writes
// straight to Postgres outside any Vercel deploy, so app.ts's own
// CACHE_BUST_VERSION query param forces an immediate flush when a
// direct-to-Postgres write can't wait out the TTL.
//
// Uses @neondatabase/serverless's HTTP driver, same as api/track.ts/
// api/subscribe.ts, rather than a pooled `pg` client.
//
// Required env var: DATABASE_URL.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authenticateKey,
  type KeyAuth,
  keyBudgetOrRespond,
  recordKeyUsage,
  tierLimits,
} from "../lib/api-keys.ts";
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { signCursor, verifyCursor } from "../lib/cursor-signature.ts";
import { getSql } from "../lib/db.ts";
import { quotePrint } from "../lib/gelato-quote.ts";
import { getHeroPool } from "../lib/hero-items.ts";
import { FACETS, facetClauses } from "../lib/item-facets.ts";
import {
  detailRateLimitOrRespond,
  itemsCost,
  itemsRateLimitOrRespond,
} from "../lib/items-rate-limit.ts";
import { LIVE_ITEMS_PREDICATE } from "../lib/items-sql.ts";
import { getMusicBuckets } from "../lib/music.ts";
import { handlePrintQuote } from "../lib/print-quote-api.ts";
import { printRegionFromHeaders } from "../lib/print-region.ts";
import { safeHttpUrl } from "../lib/safe-url.ts";
import { reportError } from "../lib/sentry.ts";
import { getSetOfWork, getSetOfWorksIndex } from "../lib/setOfWorks.ts";
import { getShelves } from "../lib/shelves.ts";
// ?shape=storylines/storyline and ?shape=set_of_works/set_of_work reuse
// this handler instead of dedicated endpoints -- Vercel Hobby's
// 12-function cap.
import { getStoryline, getStorylineIndex } from "../lib/storylines.ts";
import { loadCoverage } from "../lib/translation-coverage.ts";
import {
  parseLocaleParam,
  translateItems,
  translateShelves,
  translateStoryline,
} from "../lib/translations.ts";
import { vocabularyLabels } from "../lib/vocabulary-labels.ts";

type QueryParams = Record<string, string | string[] | undefined>;

// Only ?ids= and ?keys= may repeat; any other repeated param takes its first value.
function scalar(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

interface ItemRow {
  id: string;
  source: string;
  native_id: string;
  img?: string | null;
  full_img?: string | null;
  shuffle_key?: number;
  [column: string]: unknown;
}

interface FacetRow {
  facet: string;
  value: string;
  n: number;
}

interface SuggestRow {
  value: string;
  type: string;
  item_count: number;
}

interface BuiltQuery {
  text: string | null;
  params: unknown[];
  facets?: true;
  suggest?: true;
  empty?: true;
  correction?: true;
  vibeSearch?: true;
  counting?: true;
  lookup?: true;
  detail?: true;
  requestedIds?: string[];
  byKey?: true;
  limit?: number;
  manifest?: boolean;
  shuffled?: boolean;
  start?: number | null;
  wrapped?: boolean;
}

// A raw JSON string is handled defensively even though the driver
// normally parses JSONB already -- fails soft instead of shipping a
// stringified blob to the client.
function parseJsonbField(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return value;
    }
  }
  return value;
}

// Builds a /img proxy URL; "" (not a broken URL) when the row has no
// source image. The source URL itself isn't passed along -- the proxy
// reads it from the row, never from the request.
function imgProxyUrl(
  source: string,
  nativeId: string,
  tier: string,
  sourceImgUrl?: string | null,
): string {
  if (!sourceImgUrl) return "";
  return `/img/${encodeURIComponent(source)}/${encodeURIComponent(nativeId)}/${tier}`;
}

interface RawPublication {
  acquisition_url?: unknown;
  title?: string;
  author?: string;
  publisher?: string;
  year?: number | string;
  pages?: number | string;
}

interface TeaVoiceClaim {
  status?: string;
  text?: string;
  source_url?: string;
  publication?: RawPublication | null;
}

interface TeaVoicePublication {
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | string | null;
  pages: number | string | null;
  url: string;
}

interface TeaVoiceSource {
  text: string;
  url: string | undefined;
  publication?: TeaVoicePublication;
}

function teaVoiceSources(claims: unknown): TeaVoiceSource[] | null {
  const parsed = parseJsonbField(claims);
  if (!Array.isArray(parsed)) return null;
  const out = (parsed as (TeaVoiceClaim | null)[])
    .filter(
      (c): c is TeaVoiceClaim =>
        !!c && c.status === "grounded" && !!safeHttpUrl(c.source_url),
    )
    .map((c) => {
      const source: TeaVoiceSource = { text: c.text || "", url: c.source_url };
      const publication = teaVoicePublication(c.publication);
      if (publication) source.publication = publication;
      return source;
    });
  return out.length ? out : null;
}

// A book is only worth showing with a link to where a reader can get it.
function teaVoicePublication(
  pub: RawPublication | null | undefined,
): TeaVoicePublication | null {
  const url = pub && safeHttpUrl(pub.acquisition_url);
  if (!url || !pub.title) return null;
  return {
    title: pub.title,
    author: pub.author || null,
    publisher: pub.publisher || null,
    year: pub.year || null,
    pages: pub.pages || null,
    url,
  };
}

// Drops a non-http(s) source_url from each person rather than the person,
// so the name and tidbit still render -- just without the link.
function castWithSafeLinks(cast: unknown): unknown {
  const parsed = parseJsonbField(cast);
  if (!Array.isArray(parsed)) return parsed;
  return parsed.map((person: unknown) =>
    person && typeof person === "object" && "source_url" in person
      ? { ...person, source_url: safeHttpUrl(person.source_url) }
      : person,
  );
}

function serializeRow(row: ItemRow) {
  return {
    id: row.native_id,
    source: row.source,
    title: row.title,
    artist: row.artist,
    bio: row.bio,
    attribution_type: row.attribution_type,
    artist_nationality: row.artist_nationality,
    artist_lifespan: row.artist_lifespan,
    culture: row.culture,
    culture_period: row.culture_period,
    date: row.date,
    photograph_date: row.photograph_date,
    photographer: row.photographer,
    medium: row.medium,
    credit: row.credit,
    tags: row.tags,
    // img/lightbox_img are proxy URLs, not raw source-CDN URLs -- every
    // request routes through the Blob cache. `full`/full_img stays the
    // true-original URL, used only for the outbound link.
    img: imgProxyUrl(row.source, row.native_id, "display", row.img),
    lightbox_img: imgProxyUrl(
      row.source,
      row.native_id,
      "lightbox",
      row.full_img || row.img,
    ),
    blur_placeholder: row.blur_placeholder,
    img_width: row.img_width,
    img_height: row.img_height,
    master_width: row.master_width,
    master_height: row.master_height,
    // Ranking inputs and fields the UI never reads are deliberately absent.
    url: safeHttpUrl(row.url),
    license: row.license,
    category: row.category,
    region_primary: row.region_primary,
    region_alt: row.region_alt,
    place_of_origin: row.place_of_origin,
    timeframe: row.timeframe,
    media_type: row.media_type,
    palette: row.palette,
    subject_type: row.subject_type,
    accentColor: row.accent_color,
    contains_nudity: row.contains_nudity,
    caption_basic: row.caption_basic,
    tea_voice_status: row.tea_voice_status,
    cast_tier: row.cast_tier,
    storyline_ids: row.storyline_ids,
    set_of_work_id: row.set_of_work_id,
    twist_category: row.twist_category,
    twist_hook: row.twist_hook,
    shuffle_key: row.shuffle_key,
  };
}

// The curated text the detail panel shows on open, kept off every page row so
// it is only reachable one item at a time, under its own visitor budget
// (?shape=detail).
function serializeCuratedText(row: ItemRow) {
  return {
    caption_tea: row.caption_tea,
    // Only grounded claims with a URL, trimmed to what the UI renders.
    tea_voice_sources: teaVoiceSources(row.tea_voice_claims),
    cast: castWithSafeLinks(row.cast),
    cast_context: parseJsonbField(row.cast_context),
    twist_story: row.twist_story,
    twist_source_url: safeHttpUrl(row.twist_source_url),
  };
}

// What the keyed tier adds to a full item row. Only fields that are stored
// and trustworthy today; more arrive additively as the data does.
function serializeKeyedExtras(row: ItemRow) {
  return {
    source_verified_at: row.source_verified_at,
    rules_version: row.rules_version,
  };
}

// Shapes that are not catalogue queries have no keyed form; they stay on the
// public path.
const PUBLIC_ONLY_SHAPES = new Set([
  "storylines",
  "storyline",
  "set_of_works",
  "set_of_work",
  "shelves",
  "music",
  "heroes",
  "vocabulary",
  "print_region",
]);

function authorizationHeader(req: VercelRequest): string | undefined {
  const header = req.headers?.authorization;
  return typeof header === "string" ? header : undefined;
}

function keyedShapeName(query: BuiltQuery): string {
  if (query.detail) return "detail";
  if (query.manifest) return "manifest";
  if (query.facets) return "facets";
  if (query.suggest) return "suggest";
  if (query.counting) return "count";
  if (query.correction) return "correction";
  if (query.vibeSearch) return "vibe";
  if (query.lookup) return "lookup";
  return "feed";
}

// The order manifest -- every live item, but only the fields needed
// before the client has decided what to show (declusterOrder()'s two
// constraints, the five facets, storyline/set-of-work chip flags, the
// nudity gate, the twist flag). Search stays server-side (?q=) rather
// than joining the manifest, since matchesQuery() needs most of the
// payload anyway. ~259KB raw / 20KB gzipped vs. the full 1.85MB/266KB.
//
// MANIFEST_COLUMNS must cover every field serializeManifestRow reads.
const MANIFEST_COLUMNS = [
  "id",
  "source",
  "native_id",
  "title",
  "artist",
  "category",
  "timeframe",
  "palette",
  "media_type",
  "region_primary",
  "region_alt",
  "subject_type",
  "storyline_ids",
  "set_of_work_id",
  "contains_nudity",
  "twist_category",
  "shuffle_key",
];

function serializeManifestRow(row: ItemRow) {
  return {
    id: row.native_id,
    // Without source, slugFor() falls back to "met" for every item
    // before its full row arrives, producing wrong share-URL slugs.
    source: row.source,
    title: row.title,
    artist: row.artist,
    category: row.category,
    timeframe: row.timeframe,
    palette: row.palette,
    media_type: row.media_type,
    region_primary: row.region_primary,
    region_alt: row.region_alt,
    subject_type: row.subject_type,
    storyline_ids: row.storyline_ids,
    set_of_work_id: row.set_of_work_id,
    contains_nudity: row.contains_nudity,
    twist_category: row.twist_category,
    // Feed position, used to honour a deep link by starting the page
    // there (?start=) instead of scrolling to it.
    shuffle_key: row.shuffle_key,
  };
}

// ---------------------------------------------------------------------------
// Filtering, search and cursor paging, all optional and additive.
// ---------------------------------------------------------------------------

const MAX_LIMIT = 200;
// Shared with app.ts's FEED_PAGE_SIZE via config.toml, not hand-synced.
const DEFAULT_LIMIT = TRANQUILO_CONFIG.feed.page_size;

const MAX_IDS = TRANQUILO_CONFIG.feed.max_ids_per_lookup;

// ---------------------------------------------------------------------------
// The shuffle cursor -- a separate codec since it carries a different
// payload and rides a different index.
// ---------------------------------------------------------------------------
//
// shuffleKey: the float8 to seek past; -1 is the wrap sentinel (outside
// random()'s [0,1) range). nativeId: tiebreak, empty only at the wrap
// sentinel. start: where the session began, so the wrapped phase knows
// where to stop. wrapped: which phase the session is in.
//
// The float is carried as String(key), whose shortest round-tripping
// form satisfies parseFloat(String(x)) === x for every double -- a key
// off by one ULP would make `> cursor` true for the row it points at
// and repeat the page forever (this shipped once).
function encodeShuffleCursor(
  shuffleKey: number | undefined,
  nativeId: string,
  start: number | null | undefined,
  wrapped: boolean | undefined,
): string {
  const payload = Buffer.from(
    [
      String(shuffleKey),
      String(nativeId),
      String(start),
      wrapped ? "1" : "0",
    ].join("\u0000"),
    "utf8",
  ).toString("base64url");
  return signCursor(payload, process.env.ITEMS_CURSOR_SECRET);
}

function decodeShuffleCursor(cursor: string) {
  const bad = Object.assign(new Error("malformed cursor"), { status: 400 });
  const payload = verifyCursor(String(cursor), process.env.ITEMS_CURSOR_SECRET);
  if (payload === null) throw bad;
  const parts = Buffer.from(payload, "base64url")
    .toString("utf8")
    .split("\u0000");
  if (parts.length !== 4) throw bad;
  const key = parseFloat(parts[0]);
  const start = parseFloat(parts[2]);
  if (!Number.isFinite(key) || !Number.isFinite(start)) throw bad;
  if (start < 0 || start >= 1) throw bad;
  if (parts[3] !== "0" && parts[3] !== "1") throw bad;
  // '' (empty nativeId) is the wrap sentinel's shape -- sorts before
  // every real native_id.
  return {
    shuffleKey: key,
    nativeId: parts[1],
    start: start,
    wrapped: parts[3] === "1",
  };
}

function parseStart(value: string | undefined): number {
  const start = parseFloat(String(value));
  if (!Number.isFinite(start) || start < 0 || start >= 1) {
    throw Object.assign(
      new Error(`start must be a number in [0,1), got: ${value}`),
      { status: 400 },
    );
  }
  return start;
}

// ---------------------------------------------------------------------------
// Aggregate shapes -- answer questions about the catalogue without
// shipping it. Safe to return whole because they're bounded by the
// number of DISTINCT VALUES, not by item count.
// ---------------------------------------------------------------------------

// Capped at 50 for buildBrowseHint()'s artist pool, the only one that
// grows with the catalogue.
const BROWSE_ARTIST_POOL = 50;

function facetsQuery(): BuiltQuery {
  const live = LIVE_ITEMS_PREDICATE;
  const group = (label: string, col: string, having?: number, limit?: number) =>
    `(SELECT '${label}' AS facet, ${col}::text AS value, count(*)::int AS n` +
    `   FROM items WHERE ${live} AND ${col} IS NOT NULL` +
    `  GROUP BY ${col}${
      having ? ` HAVING count(*) >= ${having}` : ""
    }  ORDER BY n DESC, value ASC${limit ? ` LIMIT ${limit}` : ""})`;
  // Same shape as group(), for a TEXT[] column: unnest first, so an item
  // carrying several values (palette_buckets) counts once per value
  // rather than being invisible to a straight GROUP BY on the array itself.
  const groupArray = (
    label: string,
    col: string,
    having?: number,
    limit?: number,
  ) =>
    `(SELECT '${label}' AS facet, val AS value, count(*)::int AS n` +
    `   FROM items, unnest(${col}) AS val WHERE ${live} AND ${col} IS NOT NULL` +
    `  GROUP BY val${
      having ? ` HAVING count(*) >= ${having}` : ""
    }  ORDER BY n DESC, val ASC${limit ? ` LIMIT ${limit}` : ""})`;
  return {
    text: [
      group("category", "category"),
      group("source", "source"),
      group("artist", "artist", 2, BROWSE_ARTIST_POOL),
      // Regions are a closed vocabulary (shared/vocabulary.json): every
      // region must reach the facet, so no count threshold and no cap --
      // either would silently drop the smallest region from the list.
      group("region", "region_primary"),
      group("era", "timeframe", 10),
      group("type", "media_type", 10),
      group("color", "palette", 10),
      groupArray("palette_bucket", "palette_buckets", 10),
    ].join(" UNION ALL "),
    params: [],
    facets: true,
  };
}

// Autocomplete as a query rather than a downloaded index: the client-
// built version measured 657KB raw at 4,502 items (titles/mediums are
// effectively unique per item, so it scales with catalogue size, not
// distinct values -- ~29MB at 200k). This stays capped at SUGGEST_LIMIT
// regardless of catalogue size. Semantics match app.ts's
// getSearchSuggestions(); the rank order/field list live in
// lib/items-vocab.ts, not duplicated here.
const SUGGEST_LIMIT = 8;
const SUGGEST_MIN_CHARS = 2;

function suggestQuery(params: QueryParams): BuiltQuery {
  const q = (scalar(params.q) ?? "").trim();
  if (q.length < SUGGEST_MIN_CHARS) {
    return { suggest: true, empty: true, text: null, params: [] };
  }
  // Reads items_vocab (rebuilt nightly by lib/cron/db-backup.ts); a
  // direct `items` query measured ~300ms per keystroke and was rejected.
  const locale = vocabLocale(params);
  if (locale) {
    // A source medium or tag with a reviewed translation is offered only in
    // translation; artists, titles and the rest stay as they are.
    return {
      text:
        `SELECT value, type, item_count FROM (` +
        ` SELECT value, type, rank, item_count FROM items_vocab v` +
        `  WHERE key LIKE '%' || immutable_unaccent(lower($1)) || '%'` +
        `    AND NOT (type IN ('Medium', 'Tag') AND EXISTS (` +
        `      SELECT 1 FROM term_translations t` +
        `       WHERE t.locale = $2 AND t.field IN ('medium', 'tags')` +
        `         AND immutable_unaccent(t.source_key) = v.key))` +
        ` UNION ALL` +
        ` SELECT value, type, rank, item_count FROM items_vocab_locale` +
        `  WHERE locale = $2 AND key LIKE '%' || immutable_unaccent(lower($1)) || '%'` +
        `) s ORDER BY rank ASC, item_count DESC, value ASC LIMIT ${SUGGEST_LIMIT}`,
      params: [q, locale],
      suggest: true,
    };
  }
  return {
    text:
      `SELECT value, type, item_count FROM items_vocab ` +
      ` WHERE key LIKE '%' || immutable_unaccent(lower($1)) || '%' ` +
      ` ORDER BY rank ASC, item_count DESC, value ASC LIMIT ${SUGGEST_LIMIT}`,
    params: [q],
    suggest: true,
  };
}

// The locale a suggest or correction query should also read, or null for
// the source-language vocabulary alone.
function vocabLocale(params: QueryParams): string | null {
  const locale = parseLocaleParam(params.locale);
  return locale === null || locale === "en" ? null : locale;
}

// Only asked for on a submitted query that returned nothing -- never
// per keystroke, unlike suggestQuery(). Uses pg_trgm's similarity()
// (fuzzystrmatch's levenshtein() isn't installed on this database);
// the client still scores candidates with its own findDidYouMean().
function correctionQuery(params: QueryParams): BuiltQuery {
  const q = (scalar(params.q) || "").trim();
  const locale = vocabLocale(params);
  const words = locale
    ? "(SELECT word FROM items_vocab_words" +
      " UNION ALL SELECT word FROM items_vocab_locale_words WHERE locale = $2) w"
    : "items_vocab_words";
  return {
    text:
      "SELECT word, similarity(word, immutable_unaccent(lower($1))) AS score " +
      `  FROM ${words} ` +
      " WHERE similarity(word, immutable_unaccent(lower($1))) > 0.3 " +
      " ORDER BY score DESC LIMIT 25",
    params: locale ? [q, locale] : [q],
    correction: true,
  };
}

// A "moody paintings" style query is a bounded, RANKED
// result set, not the infinite shuffle-cursor feed every other filter
// (including palette_bucket) rides -- see vibeSearchQuery() below for why
// this is its own shape rather than another FACETS entry.
const VIBE_SEARCH_DEFAULT_LIMIT = 60;
const VIBE_SEARCH_MAX_LIMIT = 100;

// Filters to items carrying ANY of the given vibe_tags (array overlap,
// `&&` -- a "moody" search expands to several tags client-side; matching
// ANY of them is the whole point, not requiring all of them) and ranks
// the matches: curator_boost dominates (a human-promoted item always
// sorts first), then harmony and contrast break ties, equally weighted.
// Harmony is a cheap inline expression over the already-stored
// palette_buckets array (fewer distinct hue buckets scores higher --
// see classify_palette_buckets()'s own doc in the ingestion repo) rather
// than a second precomputed column; contrast is precomputed at ingestion
// (palette_contrast_score) since it needs real per-pixel image data SQL
// doesn't have. A bounded LIMIT over an already-filtered set, never the
// whole catalogue, so this ORDER BY is not the kind of per-query dynamic
// sort this repo's shuffle_key architecture exists to avoid -- it's
// sorting dozens of rows, not the catalogue.
function vibeSearchQuery(params: QueryParams): BuiltQuery {
  const raw = (scalar(params.vibe_tags_any) || "").trim();
  const tags = raw
    ? raw
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean)
    : [];
  if (!tags.length) {
    throw Object.assign(
      new Error("vibe_tags_any is required for shape=vibe_search"),
      { status: 400 },
    );
  }
  const limit = Math.min(
    VIBE_SEARCH_MAX_LIMIT,
    Math.max(
      1,
      parseInt(scalar(params.limit) ?? "", 10) || VIBE_SEARCH_DEFAULT_LIMIT,
    ),
  );
  return {
    text:
      `SELECT * FROM items ` +
      ` WHERE ${LIVE_ITEMS_PREDICATE} AND vibe_tags && $1::text[] ` +
      ` ORDER BY COALESCE(curator_boost, 0) DESC, ` +
      `   (COALESCE(palette_contrast_score, 0) ` +
      `    + 1.0 / COALESCE(array_length(palette_buckets, 1), 1)) DESC ` +
      ` LIMIT ${limit}`,
    params: [tags],
    vibeSearch: true,
  };
}

function detailQuery(params: QueryParams): BuiltQuery {
  const key = (scalar(params.key) ?? "").trim();
  const cut = key.indexOf(":");
  if (cut <= 0 || cut === key.length - 1) {
    throw Object.assign(new Error("key must be source:native_id"), {
      status: 400,
    });
  }
  return {
    text: `SELECT * FROM items WHERE ${
      LIVE_ITEMS_PREDICATE
    } AND source = $1 AND native_id = $2`,
    params: [key.slice(0, cut), key.slice(cut + 1)],
    detail: true,
    requestedIds: [key],
  };
}

function buildQuery(params: QueryParams): BuiltQuery {
  const shape = scalar(params.shape);
  const counting = shape === "count";

  if (shape === "facets") return facetsQuery();
  if (shape === "suggest") return suggestQuery(params);
  if (shape === "correction") return correctionQuery(params);
  if (shape === "vibe_search") return vibeSearchQuery(params);

  if (shape === "detail") return detailQuery(params);

  const where = [LIVE_ITEMS_PREDICATE];
  const values: unknown[] = [];

  if (params.keys !== undefined) {
    if (params.ids !== undefined) {
      throw Object.assign(new Error("use either keys or ids, not both"), {
        status: 400,
      });
    }
    // source:native_id, split on the first colon: sources never contain
    // one, native ids sometimes do (npm's "U:15646").
    const keys = (Array.isArray(params.keys) ? params.keys : [params.keys])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (!keys.length) {
      throw Object.assign(new Error("keys was empty"), { status: 400 });
    }
    if (keys.length > MAX_IDS) {
      throw Object.assign(
        new Error(`too many keys: ${keys.length} (max ${MAX_IDS})`),
        { status: 400 },
      );
    }
    const sources: string[] = [];
    const nativeIds: string[] = [];
    for (const key of keys) {
      const cut = key.indexOf(":");
      if (cut <= 0 || cut === key.length - 1) {
        throw Object.assign(
          new Error(`key must be source:native_id, got "${key}"`),
          { status: 400 },
        );
      }
      sources.push(key.slice(0, cut));
      nativeIds.push(key.slice(cut + 1));
    }
    return {
      text: `SELECT * FROM items WHERE ${
        LIVE_ITEMS_PREDICATE
      } AND (source, native_id) IN (SELECT * FROM unnest($1::text[], $2::text[])) ORDER BY created_at ASC, native_id ASC`,
      params: [sources, nativeIds],
      lookup: true,
      byKey: true,
      requestedIds: keys,
    };
  }

  if (params.ids !== undefined) {
    // Repeated params (?ids=a&ids=b), NOT comma-joined -- 41 live
    // Commons items have a comma in their native_id, and splitting on
    // it silently produced blank slides for those items.
    const ids = (Array.isArray(params.ids) ? params.ids : [params.ids])
      .map((s) => String(s).trim())
      .filter(Boolean);
    if (!ids.length) {
      throw Object.assign(new Error("ids was empty"), { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      throw Object.assign(
        new Error(`too many ids: ${ids.length} (max ${MAX_IDS})`),
        { status: 400 },
      );
    }
    return {
      text: `SELECT * FROM items WHERE ${
        LIVE_ITEMS_PREDICATE
      } AND native_id = ANY($1) ORDER BY created_at ASC, native_id ASC`,
      params: [ids],
      lookup: true,
      requestedIds: ids,
    };
  }

  function bind(value: unknown): string {
    values.push(value);
    return `$${values.length}`;
  }

  // Must match app.ts's matchesQuery() exactly: a diacritic-folded,
  // lowercased substring test across search_text, OR'd with the
  // century rule from matchesTimeframe(). Checked live by
  // scripts/verify_feed_fixtures.mts.
  const q = (scalar(params.q) || "").trim();
  if (q) {
    const needle = `immutable_unaccent(lower(${bind(q)}))`;
    const locale = parseLocaleParam(params.locale);
    const clauses = [
      locale === null || locale === "en"
        ? `search_text LIKE '%' || ${needle} || '%'`
        : `id IN (SELECT id FROM items WHERE search_text LIKE '%' || ${needle} || '%'` +
          ` UNION ALL SELECT item_id FROM item_search_locale` +
          ` WHERE locale = ${bind(locale)} AND extra_text LIKE '%' || ${needle} || '%')`,
    ];
    const lowered = q.toLowerCase();
    if (lowered.indexOf("ancient") !== -1) {
      clauses.push("(century IS NOT NULL AND century <= 10)");
    }
    const era = lowered.match(/(\d{1,2})(?:st|nd|rd|th)\s*century/);
    if (era) {
      clauses.push(`century = ${bind(parseInt(era[1], 10))}`);
    }
    where.push(`(${clauses.join(" OR ")})`);
  }

  where.push(
    ...facetClauses(
      Object.fromEntries(FACETS.map((f) => [f, scalar(params[f])])),
      bind,
    ),
  );

  const artist = scalar(params.artist);
  if (artist) {
    where.push(`artist = ${bind(artist)}`);
  }

  if (scalar(params.has_storyline) === "1") {
    where.push(
      "storyline_ids IS NOT NULL AND array_length(storyline_ids, 1) > 0",
    );
  }

  const limit = Math.min(
    parseInt(scalar(params.limit) ?? "", 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const cursor = scalar(params.cursor);
  const manifest = shape === "manifest";
  const shuffled = scalar(params.order) === "shuffle";

  // Rejected before querying: the unbounded SELECT exceeds Neon's 64MB response cap.
  if (manifest && !shuffled) {
    throw Object.assign(
      new Error(
        "shape=manifest is paged: add order=shuffle&start=0&limit=N and follow next_cursor.",
      ),
      { status: 400 },
    );
  }
  if (!manifest && !counting) {
    throw Object.assign(
      new Error(
        `Full item rows are served only by ?keys= or ?ids= lookups (at most ${MAX_IDS} per request). ` +
          "Use ?shape=manifest&order=shuffle&start=0 and follow next_cursor to list items.",
      ),
      { status: 400 },
    );
  }

  let start: number | null = null;
  let wrapped = false;

  if (shuffled) {
    // Phase 1 runs from the session's start offset to the top of the
    // key space; phase 2 wraps to the bottom and stops at that same
    // offset, so each live item is seen exactly once.
    if (cursor) {
      const s = decodeShuffleCursor(cursor);
      start = s.start;
      wrapped = s.wrapped;
      where.push(
        `(shuffle_key, native_id) > (${bind(s.shuffleKey)}::float8, ${bind(
          s.nativeId,
        )})`,
      );
    } else {
      start = parseStart(scalar(params.start));
      where.push(
        `(shuffle_key, native_id) > (${bind(start)}::float8, ${bind("")})`,
      );
    }
    if (wrapped) {
      where.push(`shuffle_key < ${bind(start)}::float8`);
    }
  }

  if (counting) {
    return {
      text: `SELECT count(*)::int AS n FROM items WHERE ${where.join(" AND ")}`,
      params: values,
      counting: true,
    };
  }

  // ORDER BY must match the index column-for-column or the planner
  // sorts anyway -- see sql/017_items_shuffle_key.sql.
  const text =
    `SELECT ${MANIFEST_COLUMNS.join(", ")} FROM items WHERE ${where.join(" AND ")}` +
    ` ORDER BY shuffle_key ASC, native_id ASC LIMIT ${bind(limit)}`;
  return {
    text: text,
    params: values,
    limit: limit,
    manifest: manifest,
    shuffled: shuffled,
    start: start,
    wrapped: wrapped,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.json({ error: "Method not allowed" });
    return;
  }

  const keyedAudience = req.query?.audience === "keyed";
  if (keyedAudience) {
    // Anything on the keyed URL is per-caller: never cached, even an error.
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (
      name: string,
      value: string | number | readonly string[],
    ) =>
      setHeader(
        name,
        name.toLowerCase() === "cache-control" ? "private, no-store" : value,
      );
    res.setHeader("Cache-Control", "private, no-store");
    if (PUBLIC_ONLY_SHAPES.has(scalar(req.query?.shape) ?? "")) {
      res.statusCode = 400;
      res.json({ error: "This shape is not available on the keyed endpoint" });
      return;
    }
  }

  // Varies per visitor, so never shared at the edge.
  if (req.query?.shape === "print_region") {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(printRegionFromHeaders(req.headers || {}));
    return;
  }

  if (req.query?.shape === "print_quote") {
    const apiKey = process.env.GELATO_KEY;
    await handlePrintQuote(req, res, {
      sql: getSql(),
      apiKey,
      quote: (args) => quotePrint({ ...args, apiKey: apiKey ?? "" }),
    });
    return;
  }

  // Static, so it answers without the database.
  if (req.query?.shape === "vocabulary") {
    try {
      const locale = parseLocaleParam(req.query.locale);
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.json(vocabularyLabels(locale));
    } catch (err) {
      res.statusCode = (err as { status?: number }).status ?? 500;
      res.json({ error: (err as Error).message });
    }
    return;
  }

  const client = getSql();
  if (!client) {
    console.error("items: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Catalogue isn't configured yet" });
    return;
  }

  const params: QueryParams = req.query || {};
  const shape = scalar(params.shape);

  let keyAuth: KeyAuth | null = null;
  if (keyedAudience) {
    try {
      keyAuth = await authenticateKey(client, authorizationHeader(req));
    } catch (err) {
      await reportError(err);
      res.statusCode = 503;
      res.json({ error: "Key service unavailable" });
      return;
    }
    if (!keyAuth) {
      res.statusCode = 401;
      res.setHeader("WWW-Authenticate", 'Bearer realm="tranquilo"');
      res.json({ error: "A valid API key is required" });
      return;
    }
  }

  // ?locale= asks for translated content; absent means source text only.
  let locale: string | null;
  try {
    locale = parseLocaleParam(params.locale);
  } catch (err) {
    res.statusCode = 400;
    res.json({ error: (err as Error).message });
    return;
  }

  const wantsCoverage = shape === "facets" && scalar(params.coverage) === "1";
  if (wantsCoverage && !locale) {
    res.statusCode = 400;
    res.json({ error: "coverage needs a locale" });
    return;
  }

  // Storylines/set-of-works: different tables, dispatched before
  // buildQuery(). Each has an eager index shape (small, always fetched)
  // and a lazy detail shape (fetched only when opened).
  if (shape === "storylines") {
    try {
      const index = await getStorylineIndex(client);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(index);
    } catch (err) {
      console.error("items: storyline index query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load storylines" });
    }
    return;
  }
  if (shape === "storyline") {
    try {
      const storyline = await getStoryline(client, scalar(params.id));
      if (!storyline) {
        res.statusCode = 404;
        res.json({ error: "No such storyline" });
        return;
      }
      if (locale) await translateStoryline(client, storyline, locale);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(storyline);
    } catch (err) {
      console.error("items: storyline query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load storyline" });
    }
    return;
  }

  if (shape === "set_of_works") {
    try {
      const setOfWorksIndex = await getSetOfWorksIndex(client);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(setOfWorksIndex);
    } catch (err) {
      console.error("items: set_of_works index query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load sets of works" });
    }
    return;
  }
  if (shape === "set_of_work") {
    try {
      const setOfWork = await getSetOfWork(client, scalar(params.id));
      if (!setOfWork) {
        res.statusCode = 404;
        res.json({ error: "No such set of works" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(setOfWork);
    } catch (err) {
      console.error("items: set_of_work query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load set of works" });
    }
    return;
  }

  // Shelves/music/heroes: small, fixed-size collections fetched once
  // at feed-init time (see app.ts's init Promise.all()).
  if (shape === "shelves") {
    try {
      const shelves = await getShelves(client);
      if (locale) await translateShelves(client, shelves, locale);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(shelves);
    } catch (err) {
      console.error("items: shelves query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load shelves" });
    }
    return;
  }
  if (shape === "music") {
    try {
      const buckets = await getMusicBuckets(client);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(buckets);
    } catch (err) {
      console.error("items: music buckets query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load music buckets" });
    }
    return;
  }
  if (shape === "heroes") {
    try {
      const heroes = await getHeroPool(client);
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json(heroes);
    } catch (err) {
      console.error("items: hero pool query failed", err);
      await reportError(err);
      res.statusCode = 500;
      res.json({ error: "Failed to load hero pool" });
    }
    return;
  }

  try {
    const query = buildQuery(params);

    if (query.empty || query.text === null) {
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json({ suggestions: [] });
      return;
    }

    let limited: boolean;
    if (keyAuth) {
      const cost = query.detail ? 1 : itemsCost(query);
      limited = await keyBudgetOrRespond(
        client,
        keyAuth.keyId,
        res,
        cost,
        tierLimits(keyAuth.tier),
      );
      await recordKeyUsage(
        client,
        keyAuth.keyId,
        keyedShapeName(query),
        cost,
        limited,
      );
    } else {
      limited = query.detail
        ? await detailRateLimitOrRespond(client, req, res)
        : await itemsRateLimitOrRespond(client, req, res, itemsCost(query));
    }
    if (limited) return;

    const rows = await client.query(query.text, query.params);

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.statusCode = 200;

    if (query.counting) {
      res.json({ total: rows[0]?.n || 0 });
      return;
    }

    if (query.facets) {
      const POOL_NAMES: Record<string, string> = {
        category: "categories",
        source: "sources",
      };
      const pools: Record<string, { value: string; count: number }[]> = {
        categories: [],
        sources: [],
      };
      (rows as FacetRow[]).forEach((row) => {
        const key = POOL_NAMES[row.facet] || row.facet;
        if (!pools[key]) pools[key] = [];
        pools[key].push({ value: row.value, count: row.n });
      });
      // Summed over categories (partition the catalogue exactly once);
      // summing anything with alternates (e.g. region) would over-count.
      const total = pools.categories.reduce((a, c) => a + c.count, 0);
      const translation = wantsCoverage
        ? await loadCoverage(client, locale as string)
        : undefined;
      res.json({ ...pools, total, ...(translation && { translation }) });
      return;
    }

    if (query.suggest) {
      res.json({
        suggestions: (rows as SuggestRow[]).map((row) => ({
          value: row.value,
          type: row.type,
          itemCount: row.item_count,
        })),
      });
      return;
    }

    if (query.correction) {
      res.json({ candidates: rows.map((row) => row.word as string) });
      return;
    }

    const itemRows = rows as ItemRow[];

    if (query.manifest) {
      const lastRow = itemRows[itemRows.length - 1];
      let nextCursor: string | null;
      if (itemRows.length === query.limit && lastRow) {
        nextCursor = encodeShuffleCursor(
          lastRow.shuffle_key,
          lastRow.native_id,
          query.start,
          query.wrapped,
        );
      } else if (!query.wrapped) {
        nextCursor = encodeShuffleCursor(-1, "", query.start, true);
      } else {
        nextCursor = null;
      }
      const items = itemRows.map(serializeManifestRow);
      if (locale) await translateItems(client, itemRows, items, locale);
      res.json({
        items: items,
        next_cursor: nextCursor,
      });
      return;
    }

    if (query.detail) {
      if (!itemRows.length) {
        res.statusCode = 404;
        res.json({ error: "No such item" });
        return;
      }
      const curated = itemRows.map(serializeCuratedText);
      if (locale) await translateItems(client, itemRows, curated, locale);
      res.json({ item: curated[0] });
      return;
    }

    let items: Record<string, unknown>[] = itemRows.map(serializeRow);
    if (locale) await translateItems(client, itemRows, items, locale);
    if (keyAuth) {
      items = items.map((item, i) => ({
        ...item,
        keyed: serializeKeyedExtras(itemRows[i]),
      }));
    }

    // Bounded and ranked, not paginated -- no cursor, same shape as the
    // My Collection / storyline-chapter / set-of-works lookups, which are
    // all "a small, complete result in one response" rather than an
    // infinite scroll.
    if (query.vibeSearch) {
      res.json({ items });
      return;
    }

    // `missing` is always present (empty when everything resolved), so
    // a caller can fail loudly instead of silently degrading (a short
    // CSV export, a blank storyline chapter slide).
    if (query.lookup) {
      const found: Record<string, boolean> = {};
      itemRows.forEach((row) => {
        found[query.byKey ? `${row.source}:${row.native_id}` : row.native_id] =
          true;
      });
      res.json({
        items: items,
        missing: (query.requestedIds ?? []).filter((id) => !found[id]),
      });
      return;
    }

    throw new Error("buildQuery returned an unhandled query shape");
  } catch (err) {
    // 400s are the caller's mistake -- reported to the client, not Sentry.
    if (err && (err as { status?: number }).status === 400) {
      res.statusCode = 400;
      res.json({ error: (err as Error).message });
      return;
    }
    console.error("items: query failed", err);
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "Failed to load catalogue" });
  }
}

// Exported for tests only. buildQuery's SQL text is testable without
// a live database; EXPLAIN against Neon is the real acceptance test.
export {
  buildQuery,
  decodeShuffleCursor,
  encodeShuffleCursor,
  teaVoiceSources,
};
