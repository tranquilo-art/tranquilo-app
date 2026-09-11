// Functional coverage for the flows a visitor actually
// performs, in a real browser.

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mts",
  retries: 0,
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    // A desktop-ish portrait viewport: the feed is one slide per viewport, so
    // the exact height is load-bearing for the recycling-window assertions.
    viewport: { width: 900, height: 800 },
  },
  webServer: {
    // Serves the real `dist/` build (see vite.config.mts) -- `bun run build`
    // must already have run (package.json's test:e2e/test:all do this).
    command: "bunx vite preview --port 4173",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
