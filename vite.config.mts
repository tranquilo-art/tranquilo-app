import { resolve } from "node:path";
import { defineConfig } from "vite";
import baseTemplate from "./vite-plugins/base-template.mts";
import headPartial from "./vite-plugins/head-partial.mts";
import pageChromePartial from "./vite-plugins/page-chrome-partial.mts";

// Multi-page build: index.html + every static page under pages/. No
// framework plugins -- Vite here is a dev server + a `vite build` step, not
// an app framework.
export default defineConfig({
  root: ".",
  // Without this, Vite defaults to appType: "spa", whose dev/preview server
  // rewrites ANY unmatched GET request -- fetch() sends Accept: */* by
  // default, which qualifies -- to /index.html with a 200. That silently
  // swallows every /api/** 404 (there's no backend behind `vite preview`;
  // api/**/*.ts are Vercel functions, only live under `vercel dev` or a real
  // deploy) into `<!DOCTYPE html>...` where app.ts's fetchJson() expected
  // JSON, turning a clear "responded with 404" into a baffling
  // "Unexpected token '<'" in the browser console. This is genuinely a
  // multi-page app (9 separate HTML entries below), not a SPA, so "mpa" is
  // also just the correct setting on its own terms.
  appType: "mpa",
  plugins: [
    baseTemplate(import.meta.dirname),
    headPartial(import.meta.dirname),
    pageChromePartial(import.meta.dirname),
  ],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        // Built to the root (dist/404.html), not dist/pages/ -- Vercel's
        // static-output convention auto-serves a root-level 404.html for
        // any unmatched path with a real 404 status, no rewrite needed.
        notFound: resolve(import.meta.dirname, "404.html"),
        about: resolve(import.meta.dirname, "pages/about.html"),
        getInvolved: resolve(import.meta.dirname, "pages/get-involved.html"),
        feedback: resolve(import.meta.dirname, "pages/feedback.html"),
        privacy: resolve(import.meta.dirname, "pages/privacy.html"),
        pro: resolve(import.meta.dirname, "pages/pro.html"),
        submit: resolve(import.meta.dirname, "pages/submit.html"),
        support: resolve(import.meta.dirname, "pages/support.html"),
        terms: resolve(import.meta.dirname, "pages/terms.html"),
        thankYou: resolve(import.meta.dirname, "pages/thank-you.html"),
      },
    },
  },
});
