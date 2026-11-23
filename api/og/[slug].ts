// Composes the 1200x630 preview image referenced by og:image/twitter:image
// for /v/{slug}. @vercel/og is ESM-only, loaded via dynamic import().
//
// Satori (the renderer behind ImageResponse) only understands flexbox
// layout -- every node needs an explicit `display` -- and needs real
// font files, not font-family names.
//
// Queries Neon directly, same as api/v/[slug].ts, whose slug-parsing
// scheme this mirrors exactly.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ImageResponse as OgImageResponse } from "@vercel/og";
import {
  CATEGORY_COVERS,
  categoryFromPageSlug,
} from "../../lib/category-pages.ts";
import { getSql } from "../../lib/db.ts";
import { configFromEnv, resolveHit } from "../../lib/img-store.ts";
import { rateLimitOrRespond } from "../../lib/img-visitor-rate-limit.ts";
import { LIVE_ITEMS_AND } from "../../lib/items-sql.ts";
import { reportError } from "../../lib/sentry.ts";
// "shelf-{id}" slugs render a shelf card instead of an artwork card.
import {
  getShelf,
  getShelfPreview,
  isShareableShelf,
  parseShelfSlug,
} from "../../lib/shelves.ts";
import * as sourceHealth from "../../lib/source-health.ts";
import { imageFetchHeaders } from "../../lib/source-identity.ts";
// "s-{id}" slugs render a storyline card instead of an artwork card.
import { getStoryline, parseStorylineSlug } from "../../lib/storylines.ts";

type CardNode = ConstructorParameters<typeof OgImageResponse>[0];
type CardFonts = NonNullable<
  ConstructorParameters<typeof OgImageResponse>[1]
>["fonts"];

interface ItemRow {
  source: string;
  native_id?: string | null;
  img?: string | null;
  title?: string | null;
  artist?: string | null;
  date?: string | null;
  category?: string | null;
  accent_color?: string | null;
}

// Mirrors decodeSlugId() in api/v/[slug].ts exactly.
function decodeSlugId(source: string, idPart: string): string {
  if (source === "commons") {
    return idPart.slice(0, 5) === "File:" ? idPart : `File:${idPart}`;
  }
  let m: RegExpExecArray | null;
  if (source === "europeana" && idPart.charAt(0) !== "/") {
    m = /^([0-9]+)-(.+)$/.exec(idPart);
    if (m) return `/${m[1]}/${m[2]}`;
  }
  return idPart;
}

const DISCOVER_SLUG = "discover";
const DISCOVER_COVER = { source: "met", nativeId: "436528" };

function parseSlug(slug: string) {
  const parts = slug.split(/-(.+)/);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { source: parts[0], nativeId: decodeSlugId(parts[0], parts[1]) };
}

// Duplicated from style.css's :root tokens -- no stylesheet access
// server-side. Keep in sync if the palette changes.
const INK = [11, 11, 18]; // --ink: #0b0b12
const CREAM_TEXT = "#f2efe6"; // matches .art-title-btn / .caption text
const TEAL = "#5eead4"; // --gold-soft
const INK_SOFT = "#a5a2b3"; // --ink-soft

function hexToRgb(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Blends the item's accentColor faintly into the base background, so
// the card glows in that piece's palette rather than reading generic.
function tintedBackground(accentHex: string | null | undefined) {
  const rgb = hexToRgb(accentHex);
  const inkCss = `rgb(${INK.join(",")})`;
  if (!rgb) return inkCss;
  const mixed = INK.map((c, i) => Math.round(c + (rgb[i] - c) * 0.32));
  return `linear-gradient(135deg, ${inkCss} 0%, rgb(${mixed.join(",")}) 100%)`;
}

type CardChild = CardNode | string | null;

function h(
  type: string,
  props: Record<string, unknown>,
  children?: CardChild | CardChild[],
): CardNode {
  return {
    type: type,
    props: Object.assign({}, props, { children: children }),
    key: null,
  };
}

// Spoofs an old UA so Google Fonts serves plain .ttf instead of woff2,
// which Satori can't parse ("Unsupported OpenType signature wOF2").
const FONT_FETCH_UA =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.7 Safari/534.34";

let fontsPromise: Promise<CardFonts> | null = null;
function loadFonts(): Promise<CardFonts> {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    async function fetchFontBuffer(cssUrl: string) {
      const cssRes = await fetch(cssUrl, {
        headers: { "User-Agent": FONT_FETCH_UA },
      });
      const css = await cssRes.text();
      const m = /src: url\(([^)]+)\)/.exec(css);
      if (!m) throw new Error("no font src found in Google Fonts response");
      const fontRes = await fetch(m[1]);
      return await fontRes.arrayBuffer();
    }
    try {
      const results = await Promise.all([
        fetchFontBuffer(
          "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,600&display=swap",
        ),
        fetchFontBuffer(
          "https://fonts.googleapis.com/css2?family=Work+Sans:wght@400&display=swap",
        ),
        fetchFontBuffer(
          "https://fonts.googleapis.com/css2?family=Work+Sans:wght@500&display=swap",
        ),
      ]);
      return [
        {
          name: "Cormorant Garamond",
          data: results[0],
          weight: 600,
          style: "italic",
        },
        { name: "Work Sans", data: results[1], weight: 400, style: "normal" },
        { name: "Work Sans", data: results[2], weight: 500, style: "normal" },
      ];
    } catch (_e) {
      // Undefined lets @vercel/og use its bundled font; [] throws.
      fontsPromise = null;
      return undefined;
    }
  })();
  return fontsPromise;
}

// Satori throws "not iterable" on any other data-URI type (e.g. webp);
// those are re-encoded to JPEG at twice the card's image box.
const CARD_IMAGE_BOX = { width: 920, height: 1004 };
const MAX_CONVERT_PIXELS = 100_000_000;
const SATORI_IMAGE_TYPES = new Set([
  "image/png",
  "image/apng",
  "image/jpeg",
  "image/gif",
  "image/svg+xml",
]);

async function fetchImageDataUri(url: string, source: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);
  try {
    // Unheaded requests get a 403 from Cloudflare on real Europeana
    // thumbnail URLs; imageFetchHeaders() fixes that.
    const r = await fetch(url, {
      signal: controller.signal,
      headers: imageFetchHeaders(source),
    });
    if (!r.ok) throw new Error(`image fetch failed with status ${r.status}`);
    const buf = await r.arrayBuffer();
    const contentType = (r.headers.get("content-type") || "image/jpeg")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!SATORI_IMAGE_TYPES.has(contentType)) {
      const { default: sharp } = await import("sharp");
      const jpeg = await sharp(Buffer.from(buf), {
        limitInputPixels: MAX_CONVERT_PIXELS,
      })
        .rotate()
        .resize(CARD_IMAGE_BOX.width, CARD_IMAGE_BOX.height, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 85 })
        .toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }
    return `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
  } finally {
    clearTimeout(timeout);
  }
}

// Prefers our own stored copy of the display tier: it is already ours to
// serve, and institutions can bot-challenge a server-side fetch of the origin.
async function cardImageDataUri(
  client: ReturnType<typeof getSql>,
  row: ItemRow,
): Promise<string | null> {
  if (!row.img) return null;
  const cdnBaseUrl = configFromEnv().cdnBaseUrl;
  if (client && cdnBaseUrl && row.native_id) {
    try {
      const entries = (await client.query(
        "SELECT object_key FROM img_cache_entries WHERE cache_key = $1 AND object_key IS NOT NULL",
        [`${row.source}:${row.native_id}:display`],
      )) as { object_key: string }[];
      const hit = resolveHit(entries[0], { cdnBaseUrl });
      if (hit.from === "cdn") return await fetchImageDataUri(hit.url, "cdn");
    } catch (_e) {
      // fall through to the origin
    }
  }
  try {
    return await fetchImageDataUri(row.img, row.source);
  } catch (_e) {
    return null;
  }
}

function wordmark() {
  return h(
    "div",
    {
      style: {
        display: "flex",
        position: "absolute",
        bottom: 36,
        right: 48,
        fontFamily: "Work Sans",
        fontWeight: 500,
        fontSize: 22,
        letterSpacing: 1,
        color: INK_SOFT,
      },
    },
    "Tranquilo",
  );
}

// Shared 1200x630 card skeleton -- eyebrow/title/caption over an
// optional image, tinted by accentColor. buildCard/buildStorylineCard
// decide their own text content and caption styling.
function buildShareCard(opts: {
  eyebrow: string | null;
  title: string;
  caption: string | null;
  captionStyle: { fontWeight: number; fontSize: number; lineHeight?: number };
  captionMaxWidth?: { withImage: number; withoutImage: number };
  imageDataUri: string | null;
  accentColor: string | null | undefined;
}): CardNode {
  const imageDataUri = opts.imageDataUri;

  const captionNode = opts.caption
    ? h(
        "div",
        {
          style: Object.assign(
            {
              display: "flex",
              fontFamily: "Work Sans",
              color: INK_SOFT,
              marginTop: 22,
            },
            opts.captionStyle,
            opts.captionMaxWidth
              ? {
                  maxWidth: imageDataUri
                    ? opts.captionMaxWidth.withImage
                    : opts.captionMaxWidth.withoutImage,
                }
              : {},
          ),
        },
        opts.caption,
      )
    : null;

  const textBlock = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flex: 1,
        paddingLeft: imageDataUri ? 48 : 0,
        textAlign: imageDataUri ? "left" : "center",
        alignItems: imageDataUri ? "flex-start" : "center",
      },
    },
    [
      opts.eyebrow
        ? h(
            "div",
            {
              style: {
                display: "flex",
                fontFamily: "Work Sans",
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: 4,
                textTransform: "uppercase",
                color: TEAL,
                marginBottom: 18,
              },
            },
            opts.eyebrow,
          )
        : null,
      h(
        "div",
        {
          style: {
            display: "flex",
            fontFamily: "Cormorant Garamond",
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 58,
            lineHeight: 1.15,
            color: CREAM_TEXT,
            maxWidth: imageDataUri ? 560 : 900,
          },
        },
        opts.title,
      ),
      captionNode,
    ].filter(Boolean),
  );

  const children: CardNode[] = [textBlock];
  if (imageDataUri) {
    children.unshift(
      h(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 460,
            height: 502,
            flex: "none",
          },
        },
        h("img", {
          src: imageDataUri,
          style: {
            maxWidth: 460,
            maxHeight: 502,
            objectFit: "contain",
            boxShadow: "0 30px 70px -20px rgba(0,0,0,0.6)",
          },
        }),
      ),
    );
  }

  return h(
    "div",
    {
      style: {
        display: "flex",
        width: 1200,
        height: 630,
        padding: 64,
        alignItems: "center",
        justifyContent: imageDataUri ? "flex-start" : "center",
        background: tintedBackground(opts.accentColor),
        position: "relative",
      },
    },
    [
      h(
        "div",
        {
          style: {
            display: "flex",
            width: "100%",
            height: "100%",
            alignItems: "center",
          },
        },
        children,
      ),
      wordmark(),
    ],
  );
}

function buildCard(item: ItemRow, imageDataUri: string | null): CardNode {
  const artist =
    item.artist && item.artist !== "Unknown" ? item.artist : "Unknown Artist";
  const metaLine = [artist, item.date].filter(Boolean).join(" · ");
  return buildShareCard({
    eyebrow: item.category || null,
    title: item.title || "Untitled",
    caption: metaLine || null,
    captionStyle: { fontWeight: 400, fontSize: 28 },
    imageDataUri: imageDataUri,
    accentColor: item.accent_color,
  });
}

// A different composition from buildCard(), not the artwork card with
// the title swapped: the part-count eyebrow and opening line announce
// this is a storyline before the title is read.
function buildStorylineCard(
  storyline: { title: string; intro_caption?: string | null; items: unknown[] },
  imageDataUri: string | null,
  accentColor: string | null | undefined,
): CardNode {
  const partLabel = `${storyline.items.length}-part storyline`;
  let caption = String(storyline.intro_caption || "")
    .replace(/\s+/g, " ")
    .trim();
  // Satori has no text overflow handling; clamped by character count
  // since font metrics aren't available here.
  if (caption.length > 180) {
    caption = `${caption.slice(0, 180).replace(/\s+\S*$/, "")}…`;
  }
  return buildShareCard({
    eyebrow: partLabel,
    title: storyline.title,
    caption: caption || null,
    captionStyle: { fontWeight: 300, fontSize: 25, lineHeight: 1.4 },
    captionMaxWidth: { withImage: 560, withoutImage: 820 },
    imageDataUri: imageDataUri,
    accentColor: accentColor,
  });
}

function buildShelfCard(
  shelf: { title: string },
  count: number,
  imageDataUri: string | null,
  accentColor: string | null | undefined,
): CardNode {
  return buildShareCard({
    eyebrow: `Shelf · ${count} ${count === 1 ? "work" : "works"}`,
    title: shelf.title,
    caption: "A shelf on Tranquilo",
    captionStyle: { fontWeight: 300, fontSize: 25 },
    imageDataUri: imageDataUri,
    accentColor: accentColor,
  });
}

function buildCategoryCard(
  name: string,
  imageDataUri: string | null,
  accentColor: string | null | undefined,
): CardNode {
  return buildShareCard({
    eyebrow: "Tranquilo",
    title: name,
    caption: "A calm scroll of public-domain art",
    captionStyle: { fontWeight: 300, fontSize: 25 },
    imageDataUri: imageDataUri,
    accentColor: accentColor,
  });
}

function buildDiscoverCard(
  imageDataUri: string | null,
  accentColor: string | null | undefined,
): CardNode {
  return buildShareCard({
    eyebrow: "Tranquilo",
    title: "Discover",
    caption: "Curious collections & stories behind the art",
    captionStyle: { fontWeight: 300, fontSize: 25 },
    imageDataUri: imageDataUri,
    accentColor: accentColor,
  });
}

// Held sources get a text-only card; no origin fetch.
async function coverDataUriFor(
  client: ReturnType<typeof getSql>,
  cover: ItemRow | null,
): Promise<string | null> {
  if (!cover?.img) return null;
  const held = await sourceHealth.heldSourceSet(client, [cover.source]);
  if (held[cover.source]) return null;
  return cardImageDataUri(client, cover);
}

function buildFallbackCard(message: string) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        width: 1200,
        height: 630,
        alignItems: "center",
        justifyContent: "center",
        background: `rgb(${INK.join(",")})`,
        position: "relative",
      },
    },
    [
      h(
        "div",
        {
          style: {
            display: "flex",
            fontFamily: "Cormorant Garamond",
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 52,
            color: CREAM_TEXT,
          },
        },
        message,
      ),
      wordmark(),
    ],
  );
}

export { cardImageDataUri, fetchImageDataUri };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = getSql();
    // Same per-IP budget as the image proxy, checked before the Satori
    // render (the most CPU this route ever spends).
    if (await rateLimitOrRespond(client, req, res)) return;

    const { ImageResponse } = await import("@vercel/og");

    const raw = req.query.slug;
    const slug = (Array.isArray(raw) ? raw[0] : raw) || "";
    const parsed = parseSlug(slug);
    let item: ItemRow | null = null;

    // "s-{id}" addresses a storyline, not an artwork -- a separate
    // Postgres row from its cover item, so this is two queries.
    const storylineId = parseStorylineSlug(slug);
    if (storylineId) {
      let storyline = null;
      if (client) {
        try {
          storyline = await getStoryline(client, storylineId);
        } catch (err) {
          console.error("og/[slug]: storyline query failed", err);
          await reportError(err);
          storyline = null;
        }
      }
      const fonts0 = await loadFonts();
      let tree0: CardNode;
      if (!storyline) {
        tree0 = buildFallbackCard("Tranquilo");
      } else {
        let cover: ItemRow | null = null;
        if (client) {
          try {
            const coverRows = (await client.query(
              `SELECT * FROM items WHERE native_id = $1 AND ($2::text IS NULL OR source = $2) ${LIVE_ITEMS_AND} LIMIT 1`,
              [String(storyline.cover_item_id), storyline.cover_source ?? null],
            )) as ItemRow[];
            cover = coverRows[0] || null;
          } catch (err) {
            console.error("og/[slug]: storyline cover query failed", err);
            await reportError(err);
            cover = null;
          }
        }
        let coverDataUri: string | null = null;
        if (cover?.img) {
          // A held source falls back to the text-only layout rather
          // than being fetched from our servers on every unfurl.
          const held = await sourceHealth.heldSourceSet(client, [cover.source]);
          if (!held[cover.source]) {
            coverDataUri = await cardImageDataUri(client, cover);
          }
        }
        tree0 = buildStorylineCard(
          storyline,
          coverDataUri,
          cover?.accent_color,
        );
      }
      const storylineImage = new ImageResponse(tree0, {
        width: 1200,
        height: 630,
        fonts: fonts0,
      });
      const storylineBuffer = Buffer.from(await storylineImage.arrayBuffer());
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.end(storylineBuffer);
      return;
    }

    if (slug === DISCOVER_SLUG) {
      let discoverTree = buildDiscoverCard(null, null);
      if (client) {
        try {
          const rows = (await client.query(
            `SELECT * FROM items WHERE source = $1 AND native_id = $2 ${LIVE_ITEMS_AND} LIMIT 1`,
            [DISCOVER_COVER.source, DISCOVER_COVER.nativeId],
          )) as ItemRow[];
          const cover = rows[0] || null;
          discoverTree = buildDiscoverCard(
            await coverDataUriFor(client, cover),
            cover?.accent_color,
          );
        } catch (err) {
          console.error("og/[slug]: discover cover failed", err);
          await reportError(err);
        }
      }
      const discoverImage = new ImageResponse(discoverTree, {
        width: 1200,
        height: 630,
        fonts: await loadFonts(),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.end(Buffer.from(await discoverImage.arrayBuffer()));
      return;
    }

    if (slug.startsWith("category-")) {
      const name = categoryFromPageSlug(slug.slice("category-".length));
      let categoryTree = buildFallbackCard("Tranquilo");
      if (name) {
        categoryTree = buildCategoryCard(name, null, null);
        const coverRef = CATEGORY_COVERS[name];
        if (client && coverRef) {
          try {
            const rows = (await client.query(
              `SELECT * FROM items WHERE source = $1 AND native_id = $2 ${LIVE_ITEMS_AND} LIMIT 1`,
              [coverRef.source, coverRef.nativeId],
            )) as ItemRow[];
            const cover = rows[0] || null;
            categoryTree = buildCategoryCard(
              name,
              await coverDataUriFor(client, cover),
              cover?.accent_color,
            );
          } catch (err) {
            console.error("og/[slug]: category cover failed", err);
            await reportError(err);
          }
        }
      }
      const categoryImage = new ImageResponse(categoryTree, {
        width: 1200,
        height: 630,
        fonts: await loadFonts(),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.end(Buffer.from(await categoryImage.arrayBuffer()));
      return;
    }

    const shelfKey = parseShelfSlug(slug);
    if (shelfKey) {
      let shelfTree = buildFallbackCard("Tranquilo");
      try {
        const shelf = client ? await getShelf(client, shelfKey) : null;
        if (client && isShareableShelf(shelf)) {
          const preview = await getShelfPreview(client, shelf);
          shelfTree = buildShelfCard(
            shelf,
            preview.count,
            await coverDataUriFor(client, preview.cover),
            preview.cover?.accent_color,
          );
        }
      } catch (err) {
        console.error("og/[slug]: shelf query failed", err);
        await reportError(err);
      }
      const shelfImage = new ImageResponse(shelfTree, {
        width: 1200,
        height: 630,
        fonts: await loadFonts(),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.end(Buffer.from(await shelfImage.arrayBuffer()));
      return;
    }

    if (parsed && client) {
      try {
        const rows = (await client.query(
          // A quarantined item must not render a preview image either --
          // an OG card is as public as the page it represents.
          `SELECT * FROM items WHERE source = $1 AND native_id = $2 ${LIVE_ITEMS_AND} LIMIT 1`,
          [parsed.source, parsed.nativeId],
        )) as ItemRow[];
        item = rows[0] || null;
      } catch (err) {
        console.error("og/[slug]: query failed", err);
        await reportError(err);
        item = null;
      }
    }

    const fonts = await loadFonts();
    const imageOptions = { width: 1200, height: 630, fonts: fonts };

    let tree: CardNode;
    if (!item) {
      tree = buildFallbackCard("Tranquilo");
    } else {
      let imageDataUri: string | null = null;
      // A held source is skipped for a text-only card instead.
      const heldSources = await sourceHealth.heldSourceSet(client, [
        item.source,
      ]);
      if (item.img && !heldSources[item.source]) {
        imageDataUri = await cardImageDataUri(client, item);
      }
      tree = buildCard(item, imageDataUri);
    }

    const imageResponse = new ImageResponse(tree, imageOptions);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(buffer);
  } catch (err) {
    console.error("og/[slug]: card generation failed", err);
    await reportError(err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.json({ error: "Failed to generate share image" });
    }
  }
}
