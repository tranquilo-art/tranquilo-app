import path from "node:path";
import type { Plugin } from "vite";

const SITE_ORIGIN = "https://tranquilo.art";
const OG_IMAGE = `${SITE_ORIGIN}/og/met-436528.png`;
export const HEAD_PARTIAL_MARKER = "<!-- HEAD:SHARED -->";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// `root` and `filename` are absolute filesystem paths -- filename's position
// relative to root (bare "index.html" vs. nested under "pages/") is what
// decides the asset-path prefix and the canonical URL.
export function expandHeadPartial(root: string, filename: string, html: string): string {
  if (!html.includes(HEAD_PARTIAL_MARKER)) return html;

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const descMatch = html.match(/<meta\s+name="description"\s+content="([\s\S]*?)"\s*\/?>/);
  if (!titleMatch || !descMatch) {
    throw new Error(
      `${filename}: HEAD:SHARED requires a <title> and a <meta name="description"> already present in the page -- those stay page-authored; only the derived/shared tags are injected.`
    );
  }
  const title = titleMatch[1];
  const description = descMatch[1];

  const relPath = path.relative(root, filename).split(path.sep).join("/");
  const isNested = relPath.startsWith("pages/");
  const assetPrefix = isNested ? "../" : "";
  const canonicalPath = relPath === "index.html" ? "/" : `/${relPath}`;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;

  const shared = `<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" type="image/svg+xml" href="${assetPrefix}assets/favicon.svg">
<link rel="stylesheet" href="${assetPrefix}css/tokens.css">
<link rel="stylesheet" href="${assetPrefix}css/style.css">
<link rel="canonical" href="${canonicalUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tranquilo">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:title" content="${escapeAttr(title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeAttr(title)}">
<meta name="twitter:description" content="${escapeAttr(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">`;

  return html.replace(HEAD_PARTIAL_MARKER, shared);
}

export default function headPartial(root: string): Plugin {
  return {
    name: "tranquilo-head-partial",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        return expandHeadPartial(root, ctx.filename, html);
      },
    },
  };
}
