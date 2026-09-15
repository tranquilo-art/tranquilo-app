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
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { getSql } from "../lib/db.ts";
import { getHeroPool } from "../lib/hero-items.ts";
import { LIVE_ITEMS_PREDICATE } from "../lib/items-sql.ts";
import { getMusicBuckets } from "../lib/music.ts";
import { reportError } from "../lib/sentry.ts";
import { getSetOfWork, getSetOfWorksIndex } from "../lib/setOfWorks.ts";
import { getShelves } from "../lib/shelves.ts";
// ?shape=storylines/storyline and ?shape=set_of_works/set_of_work reuse
// this handler instead of dedicated endpoints -- Vercel Hobby's
// 12-function cap.
import { getStoryline, getStorylineIndex } from "../lib/storylines.ts";

// A raw JSON string is handled defensively even though the driver
// normally parses JSONB already -- fails soft instead of shipping a
// stringified blob to the client.
function parseJsonbField(value: any): any {
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

// Builds a /img proxy URL carrying the real origin URL as a query
// param; "" (not a broken URL) when the row has no source image.
function imgProxyUrl(
  source: string,
  nativeId: string,
  tier: string,
  originUrl?: string | null,
): string {
  if (!originUrl) return "";
  return `/img/${encodeURIComponent(source)}/${encodeURIComponent(nativeId)}/${tier}?origin=${encodeURIComponent(originUrl)}`;
}

function teaVoiceSources(claims: any): any[] | null {
  const parsed = parseJsonbField(claims);
  if (!Array.isArray(parsed)) return null;
  const out = parsed
    .filter((c: any) => c && c.status === "grounded" && c.source_url)
    .map((c: any) => ({ text: c.text || "", url: c.source_url }));
  return out.length ? out : null;
}

function serializeRow(row: any): any {
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
    palette_hex: row.palette_hex,
    palette_buckets: row.palette_buckets,
    // curator_boost/palette_contrast_score deliberately absent -- pure
    // server-side ranking inputs (see vibeSearchQuery() above), not
    // something the client renders.
    vibe_tags: row.vibe_tags,
    url: row.url,
    license: row.license,
    category: row.category,
    region_primary: row.region_primary,
    region_alt: row.region_alt,
    timeframe: row.timeframe,
    media_type: row.media_type,
    palette: row.palette,
    subject_type: row.subject_type,
    accentColor: row.accent_color,
    contains_nudity: row.contains_nudity,
    caption_tea: row.caption_tea,
    caption_basic: row.caption_basic,
    tea_voice_status: row.tea_voice_status,
    tea_voice_eligible: row.tea_voice_eligible,
    // Only grounded claims with a URL, trimmed to what the UI renders.
    tea_voice_sources: teaVoiceSources(row.tea_voice_claims),
    cast: parseJsonbField(row.cast),
    cast_context: parseJsonbField(row.cast_context),
    cast_tier: row.cast_tier,
    storyline_ids: row.storyline_ids,
    set_of_work_id: row.set_of_work_id,
    twist_category: row.twist_category,
    twist_hook: row.twist_hook,
    twist_story: row.twist_story,
    twist_confidence: row.twist_confidence,
    twist_source_url: row.twist_source_url,
    music_mood: row.music_mood,
    shuffle_key: row.shuffle_key,
  };
}

// The order manifest -- every live item, but only the fields needed
// before the client has decided what to show (declusterOrder()'s two
// constraints, the five facets, storyline/set-of-work chip flags, the
// nudity gate, the twist flag). Search stays server-side (?q=) rather
// than joining the manifest, since matchesQuery() needs most of the
// payload anyway. ~259KB raw / 20KB gzipped vs. the full 1.85MB/266KB.
function serializeManifestRow(row: any): any {
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

// Bounds the collection view / CSV export / hero shelves / storyline
// chapter lookups.
const MAX_IDS = 500;

// A cursor is (created_at, native_id) base64'd, matching the ORDER BY
// and items_live_idx exactly. Cursor rather than OFFSET: an item
// ingested mid-scroll would shift every offset. The timestamp is
// carried as Postgres TEXT, never a JS Date -- Date.toISOString()
// truncates to milliseconds while Postgres stores microseconds, which
// once made every page return the same rows (a cursor compared as
// "not greater than itself").
function encodeCursor(createdAtText: any, nativeId: any): string {
  return Buffer.from(
    `${String(createdAtText)}\u0000${nativeId}`,
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: any) {
  const parts = Buffer.from(String(cursor), "base64url")
    .toString("utf8")
    .split("\u0000");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw Object.assign(new Error("malformed cursor"), { status: 400 });
  }
  return { createdAt: parts[0], nativeId: parts[1] };
}

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
  shuffleKey: any,
  nativeId: any,
  start: any,
  wrapped: any,
): string {
  return Buffer.from(
    [
      String(shuffleKey),
      String(nativeId),
      String(start),
      wrapped ? "1" : "0",
    ].join("\u0000"),
    "utf8",
  ).toString("base64url");
}

function decodeShuffleCursor(cursor: any) {
  const parts = Buffer.from(String(cursor), "base64url")
    .toString("utf8")
    .split("\u0000");
  const bad = Object.assign(new Error("malformed cursor"), { status: 400 });
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

function parseStart(value: any): number {
  const start = parseFloat(value);
  if (!Number.isFinite(start) || start < 0 || start >= 1) {
    throw Object.assign(
      new Error(`start must be a number in [0,1), got: ${value}`),
      { status: 400 },
    );
  }
  return start;
}

// Whitelisted so a typo is a 400, not a silently empty result.
const FACETS = [
  "category",
  "timeframe",
  "palette",
  "media_type",
  "region_primary",
  "source",
  "subject_type",
  // TRA-274 real color filter -- array-contains against palette_buckets,
  // not equality; see the special case in the FACETS.forEach loop below,
  // same shape as region_primary's own alternates special case.
  "palette_bucket",
];

// ---------------------------------------------------------------------------
// Aggregate shapes -- answer questions about the catalogue without
// shipping it. Safe to return whole because they're bounded by the
// number of DISTINCT VALUES, not by item count.
// ---------------------------------------------------------------------------

// Capped at 50 for buildBrowseHint()'s artist pool, the only one that
// grows with the catalogue.
const BROWSE_ARTIST_POOL = 50;

function facetsQuery(): any {
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
      group("region", "region_primary", 10),
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

function suggestQuery(params: any): any {
  const q = String(params.q == null ? "" : params.q).trim();
  if (q.length < SUGGEST_MIN_CHARS) {
    return { suggest: true, empty: true, text: null, params: [] };
  }
  // Reads items_vocab (rebuilt nightly by lib/cron/db-backup.ts); a
  // direct `items` query measured ~300ms per keystroke and was rejected.
  return {
    text:
      `SELECT value, type, item_count FROM items_vocab ` +
      ` WHERE key LIKE '%' || immutable_unaccent(lower($1)) || '%' ` +
      ` ORDER BY rank ASC, item_count DESC, value ASC LIMIT ${SUGGEST_LIMIT}`,
    params: [q],
    suggest: true,
  };
}

// Only asked for on a submitted query that returned nothing -- never
// per keystroke, unlike suggestQuery(). Uses pg_trgm's similarity()
// (fuzzystrmatch's levenshtein() isn't installed on this database);
// the client still scores candidates with its own findDidYouMean().
function correctionQuery(params: any): any {
  return {
    text:
      "SELECT word, similarity(word, immutable_unaccent(lower($1))) AS score " +
      "  FROM items_vocab_words " +
      " WHERE similarity(word, immutable_unaccent(lower($1))) > 0.3 " +
      " ORDER BY score DESC LIMIT 25",
    params: [String(params.q || "").trim()],
    correction: true,
  };
}

// TRA-274 Phase 3: a "moody paintings" style query is a bounded, RANKED
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
function vibeSearchQuery(params: any): any {
  const raw = String(params.vibe_tags_any || "").trim();
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
    Math.max(1, parseInt(params.limit, 10) || VIBE_SEARCH_DEFAULT_LIMIT),
  );
  return {
    // No cursor_ts alias -- unlike the paginated shapes below, this never
    // pages, so there's nothing to encode a cursor from.
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

function buildQuery(params: any): any {
  let ids: any, clauses: any, lowered: any, era: any, s: any, c: any;
  const counting = params.shape === "count";

  if (params.shape === "facets") return facetsQuery();
  if (params.shape === "suggest") return suggestQuery(params);
  if (params.shape === "correction") return correctionQuery(params);
  if (params.shape === "vibe_search") return vibeSearchQuery(params);

  const where = [LIVE_ITEMS_PREDICATE];
  const values: any[] = [];

  if (params.ids !== undefined) {
    // Repeated params (?ids=a&ids=b), NOT comma-joined -- 41 live
    // Commons items have a comma in their native_id, and splitting on
    // it silently produced blank slides for those items.
    ids = (Array.isArray(params.ids) ? params.ids : [params.ids])
      .map((s: any) => String(s).trim())
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
      text: `SELECT *, created_at::text AS cursor_ts FROM items WHERE ${
        LIVE_ITEMS_PREDICATE
      } AND native_id = ANY($1) ORDER BY created_at ASC, native_id ASC`,
      params: [ids],
      lookup: true,
      requestedIds: ids,
    };
  }

  function bind(value: any): string {
    values.push(value);
    return `$${values.length}`;
  }

  // Must match app.ts's matchesQuery() exactly: a diacritic-folded,
  // lowercased substring test across search_text, OR'd with the
  // century rule from matchesTimeframe(). Verified against
  // tests/fixtures/feed-modes.json's 18 pinned terms.
  const q = (params.q || "").trim();
  if (q) {
    clauses = [
      `search_text LIKE '%' || immutable_unaccent(lower(${bind(q)})) || '%'`,
    ];
    lowered = q.toLowerCase();
    if (lowered.indexOf("ancient") !== -1) {
      clauses.push("(century IS NOT NULL AND century <= 10)");
    }
    era = lowered.match(/(\d{1,2})(?:st|nd|rd|th)\s*century/);
    if (era) {
      clauses.push(`century = ${bind(parseInt(era[1], 10))}`);
    }
    where.push(`(${clauses.join(" OR ")})`);
  }

  FACETS.forEach((facet: string) => {
    const value = params[facet];
    let bound: any;
    if (value === undefined || value === "") return;
    if (facet === "region_primary") {
      // Matches alternates too (GIN index, sql/006_items_region_alt.sql)
      // -- a Cypriot item can legitimately count under both Europe and
      // West Asia, so filtered counts can sum to more than the catalogue.
      bound = bind(value);
      where.push(
        `(region_primary = ${bound} OR region_alt @> ARRAY[${bound}]::text[])`,
      );
      return;
    }
    if (facet === "palette_bucket") {
      // A real color filter: palette_buckets is multi-valued (GIN index,
      // sql/038_items_palette_buckets.sql), so this is containment, not
      // equality -- an item with both blue sky and green grass matches a
      // "Blue" filter and a "Green" one, which is the whole point.
      bound = bind(value);
      where.push(`palette_buckets @> ARRAY[${bound}]::text[]`);
      return;
    }
    where.push(`${facet} = ${bind(value)}`);
  });

  if (params.artist) {
    where.push(`artist = ${bind(params.artist)}`);
  }

  if (params.has_storyline === "1") {
    where.push(
      "storyline_ids IS NOT NULL AND array_length(storyline_ids, 1) > 0",
    );
  }

  let paginated = params.limit !== undefined || params.cursor !== undefined;
  const limit = Math.min(
    parseInt(params.limit, 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  // Ignores cursor/limit: the manifest must be the complete live set
  // for declusterOrder()'s global ordering to be meaningful.
  const manifest = params.shape === "manifest";

  // Unless the order itself is global via the precomputed shuffle_key,
  // in which case a page of it is still meaningful.
  const shuffled = params.order === "shuffle";
  if (shuffled) {
    paginated = true;
  } else if (manifest) {
    paginated = false;
    if (params.cursor) {
      throw Object.assign(
        new Error("cursor is not valid with shape=manifest"),
        { status: 400 },
      );
    }
  }

  let start = null;
  let wrapped = false;

  if (shuffled) {
    // Phase 1 runs from the session's start offset to the top of the
    // key space; phase 2 wraps to the bottom and stops at that same
    // offset, so each live item is seen exactly once.
    if (params.cursor) {
      s = decodeShuffleCursor(params.cursor);
      start = s.start;
      wrapped = s.wrapped;
      where.push(
        `(shuffle_key, native_id) > (${bind(s.shuffleKey)}::float8, ${bind(
          s.nativeId,
        )})`,
      );
    } else {
      start = parseStart(params.start);
      where.push(
        `(shuffle_key, native_id) > (${bind(start)}::float8, ${bind("")})`,
      );
    }
    if (wrapped) {
      where.push(`shuffle_key < ${bind(start)}::float8`);
    }
  } else if (!manifest && params.cursor) {
    c = decodeCursor(params.cursor);
    where.push(
      `(created_at, native_id) > (${bind(c.createdAt)}::timestamptz, ${bind(
        c.nativeId,
      )})`,
    );
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
  let text = `SELECT *, created_at::text AS cursor_ts FROM items WHERE ${where.join(
    " AND ",
  )}${
    shuffled
      ? " ORDER BY shuffle_key ASC, native_id ASC"
      : " ORDER BY created_at ASC, native_id ASC"
  }`;
  if (paginated) {
    text += ` LIMIT ${bind(limit)}`;
  }
  return {
    text: text,
    params: values,
    paginated: paginated,
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

  const client = getSql();
  let index: any,
    storyline: any,
    setOfWorksIndex: any,
    setOfWork: any,
    shelves: any,
    buckets: any,
    heroes: any,
    query: any,
    rows: any,
    POOL_NAMES: Record<string, string>,
    out: { categories: any[]; sources: any[]; [key: string]: any },
    lastRow: any,
    nextCursor: any,
    items: any,
    found: Record<string, boolean>,
    last: any;
  if (!client) {
    console.error("items: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Catalogue isn't configured yet" });
    return;
  }

  const params = req.query || {};

  // Storylines/set-of-works: different tables, dispatched before
  // buildQuery(). Each has an eager index shape (small, always fetched)
  // and a lazy detail shape (fetched only when opened).
  if (params.shape === "storylines") {
    try {
      index = await getStorylineIndex(client);
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
  if (params.shape === "storyline") {
    try {
      storyline = await getStoryline(
        client,
        params.id == null ? params.id : String(params.id),
      );
      if (!storyline) {
        res.statusCode = 404;
        res.json({ error: "No such storyline" });
        return;
      }
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

  if (params.shape === "set_of_works") {
    try {
      setOfWorksIndex = await getSetOfWorksIndex(client);
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
  if (params.shape === "set_of_work") {
    try {
      setOfWork = await getSetOfWork(
        client,
        params.id == null ? params.id : String(params.id),
      );
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
  if (params.shape === "shelves") {
    try {
      shelves = await getShelves(client);
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
  if (params.shape === "music") {
    try {
      buckets = await getMusicBuckets(client);
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
  if (params.shape === "heroes") {
    try {
      heroes = await getHeroPool(client);
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
    query = buildQuery(params);

    if (query.empty) {
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
      res.json({ suggestions: [] });
      return;
    }

    rows = await client.query(query.text, query.params);

    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
    res.statusCode = 200;

    if (query.counting) {
      res.json({ total: rows[0]?.n || 0 });
      return;
    }

    if (query.facets) {
      POOL_NAMES = { category: "categories", source: "sources" };
      out = { categories: [], sources: [] };
      rows.forEach((row: any) => {
        const key = POOL_NAMES[row.facet] || row.facet;
        if (!out[key]) out[key] = [];
        out[key].push({ value: row.value, count: row.n });
      });
      // Summed over categories (partition the catalogue exactly once);
      // summing anything with alternates (e.g. region) would over-count.
      out.total = out.categories.reduce((a: number, c: any) => a + c.count, 0);
      res.json(out);
      return;
    }

    if (query.suggest) {
      res.json({
        suggestions: rows.map((row: any) => ({
          value: row.value,
          type: row.type,
          itemCount: row.item_count,
        })),
      });
      return;
    }

    if (query.correction) {
      res.json({ candidates: rows.map((row: any) => row.word) });
      return;
    }

    // A shuffle-ordered manifest is a page, so it gets the paged
    // envelope rather than a bare array.
    if (query.manifest && query.shuffled) {
      lastRow = rows[rows.length - 1];
      if (rows.length === query.limit && lastRow) {
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
      res.json({
        items: rows.map(serializeManifestRow),
        next_cursor: nextCursor,
      });
      return;
    }

    if (query.manifest) {
      res.json(rows.map(serializeManifestRow));
      return;
    }

    items = rows.map(serializeRow);

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
      found = {};
      rows.forEach((row: any) => {
        found[row.native_id] = true;
      });
      res.json({
        items: items,
        missing: query.requestedIds.filter((id: string) => !found[id]),
      });
      return;
    }

    // No unpaginated response any more -- this used to return the
    // whole catalogue as one bare array (~390MB at the 200k target).
    if (!query.paginated) {
      throw Object.assign(
        new Error(
          "This endpoint no longer returns the whole catalogue in one response. " +
            "Use ?shape=manifest for every item's identity and facets, ?ids=a,b,c " +
            "to look up specific items, or ?limit=N (with ?cursor= to continue) to " +
            "page through full rows.",
        ),
        { status: 400 },
      );
    }
    last = rows[rows.length - 1];
    res.json({
      items: items,
      next_cursor:
        rows.length === query.limit && last
          ? encodeCursor(last.cursor_ts, last.native_id)
          : null,
    });
  } catch (err) {
    // 400s are the caller's mistake -- reported to the client, not Sentry.
    if (err && (err as any).status === 400) {
      res.statusCode = 400;
      res.json({ error: (err as any).message });
      return;
    }
    console.error("items: query failed", err);
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "Failed to load catalogue" });
  }
}

// Exported for tests only. The cursor codec's contract -- a
// microsecond-precision Postgres timestamp survives the round trip --
// is worth testing directly. buildQuery's SQL text is testable without
// a live database; EXPLAIN against Neon is the real acceptance test.
export {
  buildQuery,
  decodeCursor,
  decodeShuffleCursor,
  encodeCursor,
  encodeShuffleCursor,
};
