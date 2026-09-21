/* vercel.json is validated against a strict schema BEFORE the build runs.
 * A production deploy once failed schema validation over an added
 * `_comment_redirects` key -- valid JSON, every test green, commit pushed
 * clean, but Vercel rejected it before the build even started, so there
 * were no build logs and the previous deployment kept serving silently.
 * Same failure shape as the Hobby function cap: the platform says no
 * after our tooling already said yes. The rule now: vercel.json carries
 * configuration only, and its prose lives wherever the matching code does
 * (e.g. the redirect's reasoning now lives in css/style.css).
 */

import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const raw = readFileSync(join(ROOT, "vercel.json"), "utf8");

// Vercel's documented top-level properties. Deliberately an allowlist
// rather than a "no underscore-prefixed keys" check: the schema rejects
// any property it doesn't know, so a typo like "rewrite" should fail here too.
const KNOWN_KEYS = new Set([
  "$schema",
  "buildCommand",
  "cleanUrls",
  "crons",
  "devCommand",
  "framework",
  "functions",
  "git",
  "headers",
  "ignoreCommand",
  "images",
  "installCommand",
  "outputDirectory",
  "public",
  "redirects",
  "regions",
  "rewrites",
  "routes",
  "trailingSlash",
]);

describe("vercel.json", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("carries only properties Vercel's schema recognises", () => {
    const unknown = Object.keys(JSON.parse(raw)).filter(
      (k) => !KNOWN_KEYS.has(k),
    );
    expect(
      unknown,
      "vercel.json rejects unknown top-level properties, and " +
        "fails the deploy at schema validation before the build runs",
    ).toEqual([]);
  });

  it("has no comment-shaped keys, because JSON cannot hold comments", () => {
    const commentish = Object.keys(JSON.parse(raw)).filter(
      (k) => k.startsWith("_") || /comment|note|todo/i.test(k),
    );
    expect(
      commentish,
      "put the explanation next to the code it describes",
    ).toEqual([]);
  });

  it("redirects the retired volunteer page to Get Involved", () => {
    // pages/volunteer.html was deleted in favor of pages/get-involved.html;
    // a temporary redirect (not permanent -- easy to retarget again later)
    // keeps any existing links from dead-ending.
    const redirects = JSON.parse(raw).redirects || [];
    const toGetInvolved = redirects.filter(
      (r: { destination: string }) =>
        r.destination === "/pages/get-involved.html",
    );
    expect(
      toGetInvolved.map((r: { source: string }) => r.source).sort(),
      "expected redirects from both the old .html path and its extensionless form",
    ).toEqual(["/pages/volunteer", "/pages/volunteer.html"]);
    for (const r of toGetInvolved) {
      expect(r.permanent).toBe(false);
    }
  });

  it("keeps api/ within Vercel Hobby's 12-function cap", () => {
    // A thirteenth function fails the deploy while the build passes, so
    // production silently keeps serving the previous commit.
    const fns = globSync("api/**/*.ts", { cwd: ROOT });
    expect(
      fns.length,
      "Hobby allows 12 serverless functions; fold new " +
        "endpoints into an existing route behind a ?op= or kind discriminator",
    ).toBeLessThanOrEqual(12);
  });
});
