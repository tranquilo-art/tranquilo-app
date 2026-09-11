// vitest  -> tests/*.test.ts        offline, no DOM, no network
// playwright -> tests/e2e/*.spec.mts  real browser, stubbed backend
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
});
