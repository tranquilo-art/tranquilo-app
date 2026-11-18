// Serves a per-artwork share page at /v/{source}-{native_id}. Crawlers
// (iMessage, Slack, Twitter/X, Facebook) don't execute JS, so they only
// see the <meta> tags below; a real visitor gets the same tags injected
// into the real app and served in place, so this is the page for
// crawlers and humans alike, with no redirect for either.
//
// Queries Neon directly, same driver as api/items.ts/api/track.ts/
// api/subscribe.ts.
//
// Slug parsing splits on the FIRST hyphen only: a source's own
// native_id can contain one (Smithsonian's do, e.g.
// "ld1-1643399887910-1643399894916-0").
import fs from "node:fs";
import path from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Sql } from "../../lib/db.ts";
import { getSql } from "../../lib/db.ts";
import { escapeHtml } from "../../lib/html-escape.ts";
import { institutionName } from "../../lib/institution-names.ts";
import { LIVE_ITEMS_AND } from "../../lib/items-sql.ts";
import { getOrigin } from "../../lib/request-origin.ts";
import { safeHttpUrl } from "../../lib/safe-url.ts";
import { reportError } from "../../lib/sentry.ts";
// Also serves /shelf/{id}, rewritten as slug "shelf-{id}", the same way.
import {
  getShelf,
  getShelfPreview,
  isShareableShelf,
  parseShelfSlug,
  shelfSlug,
} from "../../lib/shelves.ts";
// Also serves /s/{id}, rewritten as slug "s-{id}" -- a storyline
// borrows this route rather than getting its own (Vercel Hobby's
// function cap).
import {
  getStoryline,
  parseStorylineSlug,
  storylineSlug,
} from "../../lib/storylines.ts";

interface ItemRow {
  title?: string | null;
  artist?: string | null;
  medium?: string | null;
  date?: string | null;
  source?: string;
  url?: unknown;
}

interface PageMeta {
  title: string;
  description: string;
  ogTitle: string;
  ogImage: string | null;
  canonicalUrl: string;
  redirectUrl: string;
  redirectLabel?: string;
  statusNote: string;
}

// Reverses encodeSlugId()'s source-specific transform back into the raw
// native_id this file queries with. No decodeURIComponent -- Vercel's
// router already fully decodes req.query.slug, and decoding twice
// throws on a lone "%". Guarded so an old-style slug (built with the
// previous encodeURIComponent(slugFor(item)) scheme) still resolves.
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

function parseSlug(slug: string) {
  const parts = slug.split(/-(.+)/);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { source: parts[0], nativeId: decodeSlugId(parts[0], parts[1]) };
}

// Serves the real app in place rather than a redirect stub, so a
// visitor's address bar, bookmarks and back button point at the real
// URL instead of a hash form within a beat of arriving.
//
// Read once per cold start at first request, not at module load, so a
// missing file can't take down the whole function on import.
//
// dist/index.html, not the repo-root source -- `vite build`'s output,
// the same bytes vercel.json's outputDirectory serves as the site root.
let APP_HTML: string | null | undefined;
function getAppHtml(): string | null {
  if (APP_HTML !== undefined) return APP_HTML;
  try {
    APP_HTML = fs.readFileSync(
      path.join(process.cwd(), "dist", "index.html"),
      "utf8",
    );
  } catch (e) {
    // Falls back to the old redirect stub if dist/index.html is missing
    // from the bundle -- degraded but working, rather than a 500.
    console.error(
      "v/[slug]: dist/index.html unavailable, falling back to redirect",
      e,
    );
    APP_HTML = null;
  }
  return APP_HTML;
}

// <base href="/"> is required: index.html references css/js relatively,
// which would 404 at /v/met-436528 without it.
function renderAppPage(appHtml: string, opts: PageMeta) {
  const head = `
    <link rel="canonical" href="${escapeHtml(opts.canonicalUrl)}">
    ${metaTags(opts)}`;

  return (
    appHtml
      // Strips index.html's own site-level canonical/social tags first,
      // or a /v/{slug} page would carry two of each -- one for the
      // artwork, one for the homepage -- and a crawler could index
      // every artwork as the front door.
      .replace(/<link rel="canonical"[^>]*>\s*/g, "")
      .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\s*/g, "")
      // <base> must be the first thing in <head> -- it only affects
      // URLs after it in document order, and index.html links
      // css/style.css inside <head>.
      .replace("<head>", '<head>\n<base href="/">')
      .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${opts.title}</title>`)
      .replace(
        /<meta name="description" content="[^"]*">/,
        () => `<meta name="description" content="${opts.description}">`,
      )
      .replace("</head>", () => `${head}</head>`)
  );
}

function metaTags(opts: PageMeta) {
  return `
    <meta property="og:type" content="website">
    <meta property="og:url" content="${escapeHtml(opts.canonicalUrl)}">
    <meta property="og:title" content="${opts.ogTitle}">
    <meta property="og:description" content="${opts.description}">
    ${
      opts.ogImage
        ? `
          <meta property="og:image" content="${escapeHtml(opts.ogImage)}">
          <meta property="og:image:width" content="1200">
          <meta property="og:image:height" content="630">`
        : ""
    }
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${opts.ogTitle}">
    <meta name="twitter:description" content="${opts.description}">
    ${
      opts.ogImage
        ? `<meta name="twitter:image" content="${escapeHtml(opts.ogImage)}">`
        : ""
    }`;
}

function scriptSafeJson(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderPage(opts: PageMeta) {
  // redirectUrl can be an external museum page (a withdrawn item's own
  // url) rather than always /index.html, so a stale bookmark lands
  // somewhere real. Escaped for the href since it's source-controlled
  // text from an external institution.
  const redirectLabel = opts.redirectLabel || "Open Tranquilo";
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${opts.title}</title>
    ${metaTags(opts)}
    </head>
    <body>
    <p>${opts.statusNote} <a href="${escapeHtml(opts.redirectUrl)}">${redirectLabel}</a>.</p>
    ${
      opts.redirectUrl
        ? // JSON.stringify leaves "<" alone, so a "</script>" inside the
          // URL would close this tag early -- \u003c keeps it inert.
          `<script>location.replace(${scriptSafeJson(opts.redirectUrl)});</script>`
        : ""
    }
    </body>
    </html>`;
}

// Cuts og:description on a word boundary, since every platform
// truncates it at a different length.
function clampDescription(text: unknown, max: number) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

async function sendStorylinePage(
  client: Sql | null,
  res: VercelResponse,
  origin: string,
  _slug: string,
  storylineId: string,
) {
  let storyline = null;
  if (client) {
    try {
      storyline = await getStoryline(client, storylineId);
    } catch (err) {
      console.error("v/[slug]: storyline query failed", err);
      await reportError(err);
      storyline = null;
    }
  }
  const canonicalUrl = `${origin}/s/${encodeURIComponent(storylineId)}`;

  if (!storyline) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(
      renderPage({
        title: "Tranquilo",
        description:
          "A calm, ad-free digital museum and open-source art platform.",
        ogTitle: "Tranquilo",
        ogImage: null,
        canonicalUrl: canonicalUrl,
        redirectUrl: `${origin}/index.html`,
        statusNote: "That storyline couldn't be found.",
      }),
    );
    return;
  }

  const partLabel = `${storyline.items.length}-part storyline`;
  const meta: PageMeta = {
    title: `${escapeHtml(storyline.title)} · Tranquilo`,
    // The intro caption is the same sentence the intro page opens
    // with, so the preview and the page agree.
    description: escapeHtml(clampDescription(storyline.intro_caption, 200)),
    ogTitle: escapeHtml(`${storyline.title} — ${partLabel}`),
    ogImage: `${origin}/og/${encodeURIComponent(storylineSlug(storylineId))}.png`,
    canonicalUrl: canonicalUrl,
    // Not back to /s/{id}: renderPage's fallback does location.replace(),
    // which would infinite-reload against the same URL.
    redirectUrl: `${origin}/index.html`,
    statusNote: "Opening Tranquilo…",
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

  const appHtml = getAppHtml();
  res.end(appHtml ? renderAppPage(appHtml, meta) : renderPage(meta));
}

async function sendShelfPage(
  client: Sql | null,
  res: VercelResponse,
  origin: string,
  shelfKey: string,
) {
  let shelf = null;
  let count = 0;
  if (client) {
    try {
      shelf = await getShelf(client, shelfKey);
      if (!isShareableShelf(shelf)) shelf = null;
      if (shelf) count = (await getShelfPreview(client, shelf)).count;
    } catch (err) {
      console.error("v/[slug]: shelf query failed", err);
      await reportError(err);
      shelf = null;
    }
  }
  const canonicalUrl = `${origin}/shelf/${encodeURIComponent(shelf?.slug || shelfKey)}`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!shelf) {
    res.statusCode = 404;
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
    res.end(
      renderPage({
        title: "Tranquilo",
        description:
          "A calm, ad-free digital museum and open-source art platform.",
        ogTitle: "Tranquilo",
        ogImage: null,
        canonicalUrl: canonicalUrl,
        redirectUrl: `${origin}/index.html`,
        statusNote: "That shelf couldn't be found.",
      }),
    );
    return;
  }

  const countLabel = `${count} ${count === 1 ? "work" : "works"}`;
  const meta: PageMeta = {
    title: `${escapeHtml(shelf.title)} · Tranquilo`,
    description: escapeHtml(
      `A shelf of ${countLabel} on Tranquilo, a calm scroll of public-domain art.`,
    ),
    ogTitle: escapeHtml(`${shelf.title} — ${countLabel}`),
    ogImage: `${origin}/og/${encodeURIComponent(shelfSlug(shelf.slug))}.png`,
    canonicalUrl: canonicalUrl,
    // Not back to /shelf/{id}: renderPage's fallback does location.replace().
    redirectUrl: `${origin}/index.html`,
    statusNote: "Opening Tranquilo…",
  };

  res.statusCode = 200;
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  const appHtml = getAppHtml();
  res.end(appHtml ? renderAppPage(appHtml, meta) : renderPage(meta));
}

function sendDiscoverPage(res: VercelResponse, origin: string) {
  const meta: PageMeta = {
    title: "Discover · Tranquilo",
    description: escapeHtml(
      "Discover curious collections & stories behind the art",
    ),
    ogTitle: "Discover · Tranquilo",
    ogImage: `${origin}/og/discover.png`,
    canonicalUrl: `${origin}/discover`,
    redirectUrl: `${origin}/index.html`,
    statusNote: "Opening Tranquilo…",
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  const appHtml = getAppHtml();
  res.end(appHtml ? renderAppPage(appHtml, meta) : renderPage(meta));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.slug;
  const slug = (Array.isArray(raw) ? raw[0] : raw) || "";
  const origin = getOrigin(req);
  if (slug === "discover") return sendDiscoverPage(res, origin);
  const client = getSql();

  const storylineId = parseStorylineSlug(slug);
  if (storylineId)
    return sendStorylinePage(client, res, origin, slug, storylineId);

  const shelfKey = parseShelfSlug(slug);
  if (shelfKey) return sendShelfPage(client, res, origin, shelfKey);

  const parsed = parseSlug(slug);
  let item: ItemRow | null = null;
  let fallbackUrl: string | null;

  if (parsed && client) {
    try {
      const rows = (await client.query(
        // Excludes withdrawn/quarantined rows -- that's the whole point
        // of quarantining an item.
        `SELECT * FROM items WHERE source = $1 AND native_id = $2 ${LIVE_ITEMS_AND} LIMIT 1`,
        [parsed.source, parsed.nativeId],
      )) as ItemRow[];
      item = rows[0] || null;
    } catch (err) {
      console.error("v/[slug]: query failed", err);
      await reportError(err);
      item = null;
    }
  }

  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");

  if (!item) {
    // A row can exist but not be live -- someone bookmarked it while it
    // was. Only for review_status = 'delisted' (the source institution's
    // own record moved or disappeared), not 'rejected'/'quarantined'
    // (our own editorial decisions, not obligated to keep tracking).
    // items.url is already public, so surfacing it discloses nothing
    // new. Best-effort: a failed lookup here still falls through to the
    // ordinary not-found page. A non-http(s) url (e.g. javascript:) would
    // run on our origin via renderPage's location.replace(), so it's
    // treated as absent.
    fallbackUrl = null;
    if (parsed && client) {
      try {
        const hiddenRows = (await client.query(
          `SELECT url FROM items WHERE source = $1 AND native_id = $2 AND review_status = 'delisted' LIMIT 1`,
          [parsed.source, parsed.nativeId],
        )) as { url: unknown }[];
        fallbackUrl = safeHttpUrl(hiddenRows[0]?.url);
      } catch (err) {
        console.error("v/[slug]: fallback-url query failed", err);
        await reportError(err);
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      renderPage({
        title: "Tranquilo",
        description:
          "A calm, ad-free digital museum and open-source art platform.",
        ogTitle: "Tranquilo",
        ogImage: null,
        canonicalUrl: `${origin}/v/${encodeURIComponent(slug)}`,
        redirectUrl: fallbackUrl || `${origin}/index.html`,
        redirectLabel: fallbackUrl
          ? "View it on the museum's site"
          : "Open Tranquilo",
        statusNote: fallbackUrl
          ? "This piece is no longer part of Tranquilo's collection, but you can still see it at the source:"
          : "That piece couldn't be found.",
      }),
    );
    return;
  }

  const title = item.title || "Untitled";
  const artist =
    item.artist && item.artist !== "Unknown" ? item.artist : "Unknown Artist";
  // Falls back to the raw source string, never a specific institution.
  const institution = institutionName(item);
  const descriptionParts = [item.medium, item.date].filter(Boolean).join(", ");
  const description = `${descriptionParts ? `${descriptionParts} · ` : ""}via ${institution}`;
  const ogTitle = `${title} — ${artist}`;

  const meta: PageMeta = {
    title: `${escapeHtml(title)} — ${escapeHtml(artist)} · Tranquilo`,
    description: escapeHtml(description),
    ogTitle: escapeHtml(ogTitle),
    ogImage: `${origin}/og/${encodeURIComponent(slug)}.png`,
    canonicalUrl: `${origin}/v/${encodeURIComponent(slug)}`,
    redirectUrl: `${origin}/index.html#${encodeURIComponent(slug)}`,
    statusNote: "Opening Tranquilo…",
  };

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Shorter than the catalogue's own cache: embeds an item's title and
  // credit, and a harmonization fix shouldn't stay wrong in a share
  // preview for a day.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=600");

  const appHtml = getAppHtml();
  res.end(appHtml ? renderAppPage(appHtml, meta) : renderPage(meta));
}
