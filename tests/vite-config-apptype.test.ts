// Found running `bun run preview` locally: fetch("/api/items?...") came
// back 200 with HTML instead of a 404, choking res.json() with "Unexpected
// token '<'" before fetchJson()'s own res.ok check could throw a clear
// error. Root cause: vite.config.mts never set `appType`, defaulting to
// "spa" -- Vite's htmlFallbackMiddleware rewrites any unmatched GET/HEAD
// with a text/html-friendly Accept header to /index.html with a 200, and
// fetch()'s default Accept: */* qualified every /api/** call. There's no
// backend behind `vite preview` (api/**/*.ts are Vercel functions, live
// only under `vercel dev` or a real deploy); appType: "mpa" surfaces that
// 404 honestly instead.
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.mts";

describe("vite.config.mts appType", () => {
  it('is "mpa", not the "spa" default that silently 200s every unmatched request', () => {
    // defineConfig can return either the config object or a function of
    // it; this project's is a plain object literal, but resolve both
    // shapes in case that changes.
    const resolved =
      typeof viteConfig === "function"
        ? (viteConfig as any)({ command: "serve", mode: "development" })
        : viteConfig;
    expect(resolved.appType).toBe("mpa");
  });
});
