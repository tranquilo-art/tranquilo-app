// A 500 on the shed path, from an en dash in a museum's filename
// (CI37.51.10a–c_F.jpg) -- HTTP header values can't hold code points above
// U+00FF or control characters, so res.setHeader("Location", originUrl)
// threw. encodeURI() would have been worse: it also escapes "%", double-
// encoding the 306 of 3,308 image URLs (mostly Commons) that already
// contain one. So the encoder targets exactly Node's actual rejected set
// (measured, not assumed) and leaves everything else alone.

import { readFileSync } from "node:fs";
import { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

const { headerSafeLocation } = await import(
  "../api/img/[source]/[id]/[tier].ts"
);

const MET_EN_DASH =
  "https://images.metmuseum.org/CRDImages/ci/web-large/CI37.51.10a–c_F.jpg";
const COMMONS_ENCODED =
  "https://upload.wikimedia.org/wikipedia/commons/3/3f/Arhat_%28National_Museum_of_Korea%29.jpg";

function canSetHeader(value: any) {
  const res = new ServerResponse({ method: "GET" } as any);
  try {
    res.setHeader("Location", value);
    return true;
  } catch {
    return false;
  }
}

describe("headerSafeLocation", () => {
  it("makes the URL that actually threw settable", () => {
    expect(canSetHeader(MET_EN_DASH)).toBe(false); // the bug
    expect(canSetHeader(headerSafeLocation(MET_EN_DASH))).toBe(true);
  });

  it("encodes the en dash as UTF-8 percent escapes", () => {
    expect(headerSafeLocation(MET_EN_DASH)).toContain("%E2%80%93");
  });

  it("does NOT touch an already percent-encoded Commons URL", () => {
    expect(headerSafeLocation(COMMONS_ENCODED)).toBe(COMMONS_ENCODED);
  });

  it("leaves a literal space alone, because Node accepts one", () => {
    const url = "https://example.org/a b.jpg";
    expect(headerSafeLocation(url)).toBe(url);
  });

  it("leaves latin-1 accents alone", () => {
    const url = "https://example.org/café.jpg";
    expect(canSetHeader(url)).toBe(true);
    expect(headerSafeLocation(url)).toBe(url);
  });

  it("strips control characters, which are a header-injection risk", () => {
    const injected = "https://example.org/a\r\nX-Injected: yes";
    const safe = headerSafeLocation(injected);
    expect(safe).not.toContain("\r");
    expect(safe).not.toContain("\n");
    expect(canSetHeader(safe)).toBe(true);
  });

  it("is idempotent", () => {
    // A second pass must not re-encode the escapes from the first.
    const once = headerSafeLocation(MET_EN_DASH);
    expect(headerSafeLocation(once)).toBe(once);
  });

  it("handles null and undefined without throwing", () => {
    expect(headerSafeLocation(null)).toBe("null");
    expect(headerSafeLocation(undefined)).toBe("undefined");
  });

  it("is used by EVERY Location header in the proxy, not just the one that threw", () => {
    // Other call sites set a Location header with the same variable that
    // crashed -- fixing only the reported line would leave an identical
    // 500 reachable by a different route.
    const src = readFileSync(
      new URL("../api/img/[source]/[id]/[tier].ts", import.meta.url),
      "utf8",
    );
    const unwrapped = [
      ...src.matchAll(/res\.setHeader\("Location",\s*([^)]+)\)/g),
    ]
      .map((m) => m[1].trim())
      .filter((arg) => !arg.startsWith("headerSafeLocation("));
    expect(unwrapped).toEqual([]);
  });
});
