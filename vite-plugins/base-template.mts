// Layout inheritance for pages/*.html, replacing page-chrome-partial.mts's
// marker-comment approach (<!-- NAV:SHARED -->/<!-- FOOTER:SHARED -->) with
// real templating: a page extends pages/_base.html and overrides only the
// blocks it needs to, via posthtml-extend (Jade-style <extends>/<block>,
// chosen over hand-rolling this with regex -- HTML nesting/self-closing
// tags/attributes containing ">" are exactly the class of bug regex-on-HTML
// invites, and this is a maintained, tested implementation of the same
// "layout + overridable blocks" idea).
//
// No TypeScript types ship for either package (checked: no @types/posthtml,
// no @types/posthtml-extend on npm) -- required via createRequire and typed
// loosely, same interop convention this repo already uses throughout
// api/**/lib/** for untyped CJS dependencies.
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const nodeRequire = createRequire(import.meta.url);
const posthtml = nodeRequire("posthtml");
const extendPlugin = nodeRequire("posthtml-extend");

export const EXTENDS_MARKER = "<extends";

// Same nav-links data page-chrome-partial.mts had. Moved here rather than
// shared between the two files: this plugin fully replaces that one once
// every page under pages/*.html has migrated (see that file's own
// deprecation note), so a temporary duplication beats a shared import that
// only exists for the migration window.
const NAV_LINKS: Array<{ href: string; label: string; donationGated?: boolean }> = [
  { href: "about.html", label: "About" },
  { href: "submit.html", label: "Submit" },
  { href: "support.html", label: "Support us", donationGated: true },
];

// A page's <nav> can't be static content living in _base.html -- which
// link (if any) is "current" depends on which page is being built, and a
// static file can't know that. So every page effectively gets a computed
// <block name="nav"> injected here, rather than any page authoring its own.
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

// Splices a computed <block name="nav"> in as the first child of <extends>,
// right after its opening tag -- posthtml-extend collects every <block>
// inside <extends>...</extends> regardless of position, so this only needs
// to land somewhere inside that wrapper, not any particular slot.
function injectComputedNav(html: string, currentFile: string): string {
  const navBlock = `<block name="nav">${buildNav(currentFile)}</block>`;
  return html.replace(/(<extends[^>]*>)/, `$1\n${navBlock}`);
}

export async function expandBaseTemplate(root: string, filename: string, html: string): Promise<string> {
  if (!html.includes(EXTENDS_MARKER)) return html; // not migrated yet -- untouched

  const relPath = path.relative(root, filename).split(path.sep).join("/");
  const currentFile = relPath.startsWith("pages/") ? relPath.slice("pages/".length) : relPath;
  const pagesDir = path.join(root, "pages");

  const withNav = injectComputedNav(html, currentFile);
  const result = await posthtml([extendPlugin({ root: pagesDir })]).process(withNav);
  return result.html;
}

export default function baseTemplate(root: string): Plugin {
  return {
    name: "tranquilo-base-template",
    transformIndexHtml: {
      // Must run before head-partial.mts: that plugin extracts <title>/
      // <meta name="description"> from the assembled HTML to derive
      // og:/twitter: tags, which only exist once this plugin has resolved
      // the page's <block name="head" type="append"> into the document.
      order: "pre",
      handler(html, ctx) {
        return expandBaseTemplate(root, ctx.filename, html);
      },
    },
  };
}
