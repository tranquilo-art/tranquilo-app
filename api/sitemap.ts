// /sitemap.xml (rewritten here from vercel.json).
//
// Every live artwork now has a real, crawlable URL at /v/{slug} that serves
// the app with its own title, description and og:image. Without a sitemap none
// of them are discoverable: nothing on the site links to an individual piece
// -- the feed is a scroll container built by JavaScript, so a crawler that
// does not execute JS sees exactly one page. A sitemap is the only way these
// URLs get found.
//
// Generated rather than checked in, because the catalogue changes without a
// deploy. The ingestion pipeline writes straight to Postgres, so a static
// file would be stale the moment a batch lands or an item is rejected --
// the same reasoning behind api/items.ts's own short cache duration.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../lib/db.ts";
import { LIVE_ITEMS_WHERE } from "../lib/items-sql.ts";
import { getOrigin } from "../lib/request-origin.ts";
import { reportError } from "../lib/sentry.ts";

// XML has five predefined entities and a URL can legitimately contain three of
// them -- Commons filenames are the realistic source, since they are arbitrary
// user-chosen text. An unescaped & alone makes the whole document malformed,
// and a malformed sitemap is rejected wholesale rather than partially.
function escapeXml(value: any): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const STATIC_PAGES = [
  { path: "/pages/about.html", priority: "0.8" },
  { path: "/pages/submit.html", priority: "0.6" },
  { path: "/pages/pro.html", priority: "0.5" },
  { path: "/pages/privacy.html", priority: "0.3" },
  { path: "/pages/terms.html", priority: "0.3" },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method not allowed");
    return;
  }

  const client = getSql();
  if (!client) {
    console.error("sitemap: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.end("Sitemap isn't configured yet");
    return;
  }

  let rows: any, origin: any, urls: any, xml: any;
  try {
    // Quarantined and rejected rows must not appear. Listing a URL that serves
    // a 404 is worse than omitting it: it spends crawl budget and it is
    // exactly the item we decided the public should not see.
    rows = await client.query(
      `SELECT source, native_id, harmonized_at, created_at FROM items ${
        LIVE_ITEMS_WHERE
      } ORDER BY created_at DESC, native_id`,
    );

    origin = getOrigin(req);
    urls = rows.map((row: any) => {
      // same transform as encodeSlugId() in src/app.ts (see that
      // file's comment, notably on why this is NOT encodeURI() -- it
      // percent-encodes non-ASCII bytes exactly like encodeURIComponent()
      // does in real JavaScript). A sitemap built from the old, blanket
      // encodeURIComponent(slug) scheme carried the same CJK "URL too long"
      // risk as a share link, and there is no reason its URLs should look
      // different from the ones the app itself hands out.
      let idPart = row.native_id;
      let m: any;
      if (row.source === "commons" && idPart.slice(0, 5) === "File:") {
        idPart = idPart.slice(5);
      } else if (row.source === "europeana") {
        m = /^\/([0-9]+)\/(.+)$/.exec(idPart);
        if (m) idPart = `${m[1]}-${m[2]}`;
      }
      const slug = `${row.source}-${idPart.replace(/[%/#?\s]/g, encodeURIComponent)}`;
      // lastmod is the last time this item's DATA changed, which is what a
      // crawler is being told about -- not the last deploy.
      const touched = row.harmonized_at || row.created_at;
      return (
        `  <url>\n` +
        `    <loc>${escapeXml(`${origin}/v/${slug}`)}</loc>\n${
          touched
            ? `    <lastmod>${new Date(touched).toISOString().slice(0, 10)}</lastmod>\n`
            : ""
        }    <changefreq>monthly</changefreq>\n` +
        `  </url>\n`
      );
    });

    xml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>${escapeXml(origin)}/</loc>
          <changefreq>daily</changefreq>
          <priority>1.0</priority>
        </url>
        ${STATIC_PAGES.map(
          (page: { path: string; priority: string }) => `
          <url>
            <loc>${escapeXml(origin + page.path)}</loc>
            <changefreq>yearly</changefreq>
            <priority>${page.priority}</priority>
          </url>`,
        ).join("")}
        ${urls.join("")}
      </urlset>`;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    // An hour at the edge. The catalogue is deliberately static by design --
    // there is no scheduled re-ingestion -- so this changes rarely, and a
    // crawler re-fetching it is not urgent.
    res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600");
    res.end(xml);
  } catch (err) {
    console.error("sitemap: query failed", err);
    await reportError(err);
    res.statusCode = 500;
    res.end("Failed to build sitemap");
  }
}
