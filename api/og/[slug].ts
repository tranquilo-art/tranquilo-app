// Composes the 1200x630 preview image referenced by og:image/twitter:image
// for /v/{slug}. @vercel/og is ESM-only, loaded via dynamic import().
//
// Satori (the renderer behind ImageResponse) only understands flexbox
// layout -- every node needs an explicit `display` -- and needs real
// font files, not font-family names.
//
// Queries Neon directly, same as api/v/[slug].ts, whose slug-parsing
// scheme this mirrors exactly.

import { getSql } from "../../lib/db.ts";
import { rateLimitOrRespond } from "../../lib/img-visitor-rate-limit.ts";
import { LIVE_ITEMS_AND } from "../../lib/items-sql.ts";
import { reportError } from "../../lib/sentry.ts";
import * as sourceHealth from "../../lib/source-health.ts";
import { imageFetchHeaders } from "../../lib/source-identity.ts";
// "s-{id}" slugs render a storyline card instead of an artwork card.
import { getStoryline, parseStorylineSlug } from "../../lib/storylines.ts";

// Mirrors decodeSlugId() in api/v/[slug].ts exactly.
function decodeSlugId(source: any, idPart: any) {
  if (source === "commons") {
    return idPart.slice(0, 5) === "File:" ? idPart : `File:${idPart}`;
  }
  let m: any;
  if (source === "europeana" && idPart.charAt(0) !== "/") {
    m = /^([0-9]+)-(.+)$/.exec(idPart);
    if (m) return `/${m[1]}/${m[2]}`;
  }
  return idPart;
}

function parseSlug(slug: any) {
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

function hexToRgb(hex: any) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Blends the item's accentColor faintly into the base background, so
// the card glows in that piece's palette rather than reading generic.
function tintedBackground(accentHex: any) {
  const rgb = hexToRgb(accentHex);
  const inkCss = `rgb(${INK.join(",")})`;
  if (!rgb) return inkCss;
  const mixed = INK.map((c, i) => Math.round(c + (rgb?.[i] - c) * 0.32));
  return `linear-gradient(135deg, ${inkCss} 0%, rgb(${mixed.join(",")}) 100%)`;
}

function h(type: any, props: any, children?: any): any {
  return {
    type: type,
    props: Object.assign({}, props, { children: children }),
  };
}

// Spoofs an old UA so Google Fonts serves plain .ttf instead of woff2,
// which Satori can't parse ("Unsupported OpenType signature wOF2").
const FONT_FETCH_UA =
  "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko) PhantomJS/1.9.7 Safari/534.34";

let fontsPromise: any = null;
function loadFonts() {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    async function fetchFontBuffer(cssUrl: any) {
      const cssRes = await fetch(cssUrl, {
        headers: { "User-Agent": FONT_FETCH_UA },
      });
      const css = await cssRes.text();
      const m = /src: url\(([^)]+)\)/.exec(css);
      if (!m) throw new Error("no font src found in Google Fonts response");
      const fontRes = await fetch(m[1]);
      return await fontRes.arrayBuffer();
    }
    let results: any;
    try {
      results = await Promise.all([
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
      // Satori falls back to its built-in default font -- not pretty, but
      // the card still renders rather than the whole request failing.
      return [];
    }
  })();
  return fontsPromise;
}

async function fetchImageDataUri(url: any, source: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);
  let r: any, buf: any, contentType: any;
  try {
    // Unheaded requests get a 403 from Cloudflare on real Europeana
    // thumbnail URLs; imageFetchHeaders() fixes that.
    r = await fetch(url, {
      signal: controller.signal,
      headers: imageFetchHeaders(source),
    });
    if (!r.ok) throw new Error(`image fetch failed with status ${r.status}`);
    buf = await r.arrayBuffer();
    contentType = r.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${Buffer.from(buf).toString("base64")}`;
  } finally {
    clearTimeout(timeout);
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
  accentColor: any;
}): any {
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

  const children = [textBlock];
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

function buildCard(item: any, imageDataUri: any): any {
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
  storyline: any,
  imageDataUri: any,
  accentColor: any,
): any {
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

function buildFallbackCard(message: any) {
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

export { fetchImageDataUri };

export default async function handler(req: any, res: any) {
  let ImageResponse: any,
    slug: any,
    parsed: any,
    item: any,
    client: any,
    storylineId: any,
    storyline: any,
    fonts0: any,
    tree0: any,
    cover: any,
    coverRows: any,
    coverDataUri: any,
    held: any,
    storylineImage: any,
    storylineBuffer: any,
    rows: any,
    fonts: any,
    imageOptions: any,
    tree: any,
    imageDataUri: any,
    heldSources: any,
    imageResponse: any,
    buffer: any;
  try {
    client = getSql();
    // Same per-IP budget as the image proxy, checked before the Satori
    // render (the most CPU this route ever spends).
    if (await rateLimitOrRespond(client, req, res)) return;

    ImageResponse = (await import("@vercel/og")).ImageResponse;

    slug = req.query.slug || "";
    parsed = parseSlug(slug);
    item = null;

    // "s-{id}" addresses a storyline, not an artwork -- a separate
    // Postgres row from its cover item, so this is two queries.
    storylineId = parseStorylineSlug(slug);
    if (storylineId) {
      storyline = null;
      if (client) {
        try {
          storyline = await getStoryline(client, storylineId);
        } catch (err) {
          console.error("og/[slug]: storyline query failed", err);
          await reportError(err);
          storyline = null;
        }
      }
      fonts0 = await loadFonts();
      if (!storyline) {
        tree0 = buildFallbackCard("Tranquilo");
      } else {
        cover = null;
        if (client) {
          try {
            coverRows = await client.query(
              `SELECT * FROM items WHERE native_id = $1 ${LIVE_ITEMS_AND} LIMIT 1`,
              [String(storyline.cover_item_id)],
            );
            cover = coverRows[0] || null;
          } catch (err) {
            console.error("og/[slug]: storyline cover query failed", err);
            await reportError(err);
            cover = null;
          }
        }
        coverDataUri = null;
        if (cover?.img) {
          // A held source falls back to the text-only layout rather
          // than being fetched from our servers on every unfurl.
          held = await sourceHealth.heldSourceSet(client, [cover.source]);
          if (!held[cover.source]) {
            try {
              coverDataUri = await fetchImageDataUri(cover.img, cover.source);
            } catch (_e) {
              coverDataUri = null;
            }
          }
        }
        tree0 = buildStorylineCard(
          storyline,
          coverDataUri,
          cover?.accent_color,
        );
      }
      storylineImage = new ImageResponse(tree0, {
        width: 1200,
        height: 630,
        fonts: fonts0,
      });
      storylineBuffer = Buffer.from(await storylineImage.arrayBuffer());
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
      res.end(storylineBuffer);
      return;
    }

    if (parsed && client) {
      try {
        rows = await client.query(
          // A quarantined item must not render a preview image either --
          // an OG card is as public as the page it represents.
          `SELECT * FROM items WHERE source = $1 AND native_id = $2 ${LIVE_ITEMS_AND} LIMIT 1`,
          [parsed.source, parsed.nativeId],
        );
        item = rows[0] || null;
      } catch (err) {
        console.error("og/[slug]: query failed", err);
        await reportError(err);
        item = null;
      }
    }

    fonts = await loadFonts();
    imageOptions = { width: 1200, height: 630, fonts: fonts };

    if (!item) {
      tree = buildFallbackCard("Tranquilo");
    } else {
      imageDataUri = null;
      // item.img is the raw origin URL, not the /img proxy URL --
      // fetched directly from the source institution on every unfurl,
      // so a held source is skipped for a text-only card instead.
      heldSources = await sourceHealth.heldSourceSet(client, [item.source]);
      if (item.img && !heldSources[item.source]) {
        try {
          imageDataUri = await fetchImageDataUri(item.img, item.source);
        } catch (_e) {
          imageDataUri = null; // fall back to the text-only layout below
        }
      }
      tree = buildCard(item, imageDataUri);
    }

    imageResponse = new ImageResponse(tree, imageOptions);
    buffer = Buffer.from(await imageResponse.arrayBuffer());

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
