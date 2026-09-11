/* Does every function one file calls on another actually exist? Written
 * against a reproduced outage: lib/source-health.js was once replaced with
 * a different API, its test file replaced to match, both self-consistent
 * (334 green tests) -- while three files calling its now-vanished exports
 * broke silently, and api/og/[slug].js 500'd on every share-link unfurl
 * for about two hours. Deleting an export while leaving its test in place
 * is already caught; replacing a module and its tests together is not,
 * because nothing in tests/ has ever loaded an api/ handler.
 *
 * Not invoking the handlers directly, since they're Vercel (req, res)
 * functions reaching for Neon (api-live-filter.test.ts reads them as text
 * instead). These checks require the modules -- safe, since getSql() is
 * lazy and returns null with no DATABASE_URL -- and compare call sites
 * against the real exports objects. No database, no network, no handler
 * invocation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const rel = (p: string) => relative(ROOT, p);

function walk(dir: string, extensions: string[] = [".js"]): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? walk(full, extensions)
      : extensions.some((ext) => name.endsWith(ext))
        ? [full]
        : [];
  });
}

// Discovered by walking, not listed, so a handler added tomorrow is
// covered tomorrow.
const API_FILES = walk(join(ROOT, "api"), [".ts"]);

describe("every api/ handler loads", () => {
  it("found handlers to check", () => {
    expect(API_FILES.length).toBeGreaterThan(5);
  });

  // A syntax error, a bad import path or a module-scope throw is a total
  // outage for that route.
  it.each(API_FILES.map(rel))("%s", async (path: string) => {
    await expect(
      import(pathToFileURL(join(ROOT, path)).href),
    ).resolves.toBeTruthy();
  });
});

describe("every lib function an api/ handler calls exists", () => {
  // Matches both `const X = require(...)` and `import * as X from ...`,
  // since a file mid-ESM-migration could use either form.
  const bindings = [];
  const BINDING_PATTERNS = [
    /(?:const|var|let)\s+(\w+)\s*=\s*require\(\s*["'](\.[^"']*lib\/[^"']+)["']\s*\)/g,
    /import\s+\*\s+as\s+(\w+)\s+from\s+["'](\.[^"']*lib\/[^"']+)["']/g,
  ];
  for (const file of API_FILES) {
    const src = readFileSync(file, "utf8");
    for (const re of BINDING_PATTERNS) {
      for (const [, local, libPath] of src.matchAll(re)) {
        bindings.push({ file, src, local, libPath });
      }
    }
  }

  it("found bindings to check", () => {
    expect(bindings.length).toBeGreaterThan(5);
  });

  it.each(bindings.map((b) => [`${rel(b.file)} -> ${b.libPath}`, b]))(
    "%s",
    async (_label, b) => {
      const mod = await import(
        pathToFileURL(join(dirname(b.file), b.libPath)).href
      );
      const called = new Set(
        [
          ...b.src.matchAll(new RegExp(`\\b${b.local}\\.(\\w+)\\s*\\(`, "g")),
        ].map((m) => m[1]),
      );
      const missing = [...called].filter(
        (name) => typeof mod[name] !== "function",
      );
      expect(
        missing,
        `${rel(b.file)} calls ${b.local}.${missing.join("/")} but ${b.libPath} ` +
          `does not export it`,
      ).toEqual([]);
    },
  );
});

// The window.TranquiloLogic bridge this used to guard is gone now that
// every caller is a real ES module importing logic.js's named exports
// directly -- tsc already refuses to compile a nonexistent import.
