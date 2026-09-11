// The 8 marketing pages under pages/*.html hand-duplicated the same
// <header class="mkt-nav">...</header> and <footer class="mkt-footer">...
// </footer> blocks verbatim -- the only thing that ever varied was which nav
// link (if any) carries class="current" for the page it points at. Only
// About, Submit and Support us have a matching nav entry at all; the other
// five pages (feedback, pro, privacy, terms, thank-you) correctly highlight
// nothing today, and this preserves that rather than inventing a highlight
// that never existed.

import path from "node:path";
import type { Plugin } from "vite";

export const NAV_MARKER = "<!-- NAV:SHARED -->";
export const FOOTER_MARKER = "<!-- FOOTER:SHARED -->";

const NAV_LINKS: Array<{ href: string; label: string; donationGated?: boolean }> = [
  { href: "about.html", label: "About" },
  { href: "submit.html", label: "Submit" },
  { href: "support.html", label: "Support us", donationGated: true },
];

const FOOTER = `<footer class="mkt-footer">
    <div class="mkt-footer-links">
      <a href="feedback.html">Feedback</a>
      <a href="terms.html">Terms &amp; Privacy</a>
      <a href="pro.html">Pro Waitlist</a>
    </div>
  </footer>`;

function buildNav(currentFile: string): string {
  const links = NAV_LINKS.map(({ href, label, donationGated }) => {
    const current = href === currentFile ? ' class="current"' : "";
    const prefix = donationGated ? "data-donations " : "";
    return `<a ${prefix}href="${href}"${current}>${label}</a>`;
  }).join("\n      ");

  return `<header class="mkt-nav">
    <a class="wordmark" href="../index.html"><img class="wordmark-mark" src="../assets/tranquilo-flower-violet.svg" alt="" width="30" height="41" aria-hidden="true"><span>Tranquilo</span></a>
    <nav class="mkt-nav-links">
      <a href="../index.html">Home</a>
      ${links}
    </nav>
  </header>`;
}

export function expandPageChrome(currentFile: string, html: string): string {
  let out = html;
  if (out.includes(NAV_MARKER)) out = out.replace(NAV_MARKER, buildNav(currentFile));
  if (out.includes(FOOTER_MARKER)) out = out.replace(FOOTER_MARKER, FOOTER);
  return out;
}

export default function pageChromePartial(root: string): Plugin {
  return {
    name: "tranquilo-page-chrome-partial",
    // Same ordering rationale as head-partial.mts: irrelevant here since
    // this plugin never introduces new <link>/<script> asset references,
    // only plain markup -- default order is fine.
    transformIndexHtml(html, ctx) {
      const relPath = path.relative(root, ctx.filename).split(path.sep).join("/");
      const currentFile = relPath.startsWith("pages/") ? relPath.slice("pages/".length) : relPath;
      return expandPageChrome(currentFile, html);
    },
  };
}
