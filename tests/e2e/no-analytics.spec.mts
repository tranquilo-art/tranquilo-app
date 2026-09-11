// The test suite must never report itself as real traffic. It did: the
// beacon opt-out is localStorage-based, and Playwright's fresh context per
// test meant the flag never survived, recording thousands of page views
// against host 127.0.0.1.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("no analytics request escapes during a page load", async ({ page }) => {
  const analytics: string[] = [];
  page.on("request", (r) => {
    if (/cloudflareinsights|\/cdn-cgi\/rum|i\.posthog\.com/.test(r.url()))
      analytics.push(r.url());
  });
  await gotoFeed(page);
  await page.waitForTimeout(1200);
  expect(analytics, "the suite phoned home to analytics").toEqual([]);
});

test("every page carrying an analytics beacon guards it by hostname", () => {
  // A hostname check needs no memory, unlike the ?tranquilo_internal opt-out
  // it backs up. Checks Cloudflare's and PostHog's beacons independently so
  // a guard missing from just one still fails this. Resolves every
  // <script src> a page loads, not just the HTML, since the beacons live in
  // src/analytics/*.ts now.
  const pages = [
    "../../index.html",
    "../../pages/about.html",
    "../../pages/pro.html",
    "../../pages/submit.html",
    "../../pages/privacy.html",
    "../../pages/terms.html",
  ];
  const markers = ["cloudflareinsights", "posthog.init"];
  // Reads a script and, transitively, every local file it `import`s -- the
  // hostname guard lives in trafficGate.js, one import away from the beacons
  // themselves. Matches both `import {x} from "./y"` and the bare
  // side-effect form `import "./y"`, since src/app.ts imports the beacons
  // the second way and a `from`-only regex silently missed it before.
  function resolveImportPath(absPath: string): string {
    if (existsSync(absPath)) return absPath;
    if (existsSync(`${absPath}.ts`)) return `${absPath}.ts`;
    return absPath;
  }

  function readWithImports(absPath: string, seen = new Set<string>()): string {
    if (seen.has(absPath)) return "";
    seen.add(absPath);
    const src = readFileSync(absPath, "utf8");
    const importSrcs = [
      ...src.matchAll(/\b(?:from|import)\s+["'](\.[^"']+)["']/g),
    ].map((m) => m[1]);
    const imported = importSrcs.map((rel) =>
      readWithImports(
        resolveImportPath(path.join(path.dirname(absPath), rel)),
        seen,
      ),
    );
    return [src, ...imported].join("\n");
  }

  for (const rel of pages) {
    const pageDir = path.dirname(path.join(__dirname, rel));
    const html = readFileSync(path.join(__dirname, rel), "utf8");
    const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(
      (m) => m[1],
    );
    const combined = [
      html,
      ...scriptSrcs
        .filter((src) => !/^https?:/.test(src))
        .map((src) => readWithImports(path.join(pageDir, src))),
    ].join("\n");
    for (const marker of markers) {
      if (!combined.includes(marker)) continue; // that beacon isn't on this page, nothing to guard
      expect(combined, `${rel} (${marker})`).toContain(
        'location.hostname !== "tranquilo.art"',
      );
    }
  }
});
