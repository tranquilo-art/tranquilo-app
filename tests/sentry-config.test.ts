// lib/sentry.ts calls Sentry.init() at require time (a real network
// client, no test seam), so this is a source-text structural test. This
// project has no visitor accounts, so nothing captured should ever carry
// a name/email/session id/IP -- Sentry's Node SDK auto-instruments
// http/fetch once tracesSampleRate > 0, so these checks keep that
// instrumentation's output PII-free.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  join(import.meta.dirname, "..", "lib", "sentry.ts"),
  "utf8",
);

describe("lib/sentry.ts PII policy", () => {
  it("explicitly disables sendDefaultPii rather than relying on an inherited default", () => {
    expect(src).toMatch(/sendDefaultPii:\s*false/);
  });

  it("scrubs cookies, auth headers and any user object from every event and transaction", () => {
    const scrubber = src.slice(
      src.indexOf("function scrubEvent"),
      src.indexOf("Sentry.init({"),
    );
    expect(scrubber).toContain("delete event.request.cookies");
    expect(scrubber).toContain("delete event.request.headers.cookie");
    expect(scrubber).toContain("delete event.request.headers.authorization");
    expect(scrubber).toContain("delete event.user");

    expect(src).toMatch(/beforeSend:\s*scrubEvent/);
    expect(src).toMatch(/beforeSendTransaction:\s*scrubEvent/);
  });

  it("leaves tracing off by default, tunable only via env var", () => {
    // Number(undefined) || 0 === 0 -- tracing stays off unless the env
    // var is set, a sampling/cost decision rather than a code change.
    expect(src).toMatch(
      /tracesSampleRate:\s*Number\(process\.env\.SENTRY_TRACES_SAMPLE_RATE\)\s*\|\|\s*0/,
    );
  });
});
