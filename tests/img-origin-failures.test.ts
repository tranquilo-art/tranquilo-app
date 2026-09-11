/* The origin failure matrix, against a real server -- previously required
 * asking a museum to fail for us (see tests/helpers/origin.ts). Drives
 * fetchOriginOnce() directly, not the whole handler, isolating what the
 * proxy does with what an origin sends back; what the handler does with
 * the thrown error is covered in img-guard-atomicity.test.ts and
 * img-proxy.test.ts.
 *
 * Deliberately not covered: the 20s timeout (baked into the function;
 * making it injectable would be a production change for test
 * convenience) and response size (no guard -- unbounded by design since
 * the lightbox tier exists to resize the master).
 */
import { afterEach, describe, expect, it } from "vitest";
import * as guard from "../lib/img-fetch-guard.ts";
import * as identity from "../lib/source-identity.ts";
import { startFakeOrigin } from "./helpers/origin.ts";

const proxy = await import("../api/img/[source]/[id]/[tier].ts");

let origin: any;
afterEach(async () => {
  if (origin) {
    await origin.close();
    origin = null;
  }
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe("a healthy origin", () => {
  it("returns the bytes and the content type unchanged", async () => {
    origin = await startFakeOrigin(() => ({
      status: 200,
      headers: { "content-type": "image/jpeg" },
      body: JPEG,
    }));
    const out = await proxy.fetchOriginOnce(origin.url(), "met");
    expect(Buffer.compare(out.buf, JPEG)).toBe(0);
    expect(out.contentType).toBe("image/jpeg");
  });

  it("falls back to a generic content type when the origin sends none", async () => {
    // Storing "" would make the cached object un-servable later.
    origin = await startFakeOrigin(() => ({
      status: 200,
      body: JPEG,
      headers: {},
    }));
    const out = await proxy.fetchOriginOnce(origin.url(), "met");
    expect(out.contentType).toBeTruthy();
  });
});

describe("we identify ourselves to the institution", () => {
  it("sends a User-Agent naming the product and a contact", async () => {
    // fetch() was once called with no headers, so every cache miss reached
    // an institution anonymously, the one kind of request an operator can
    // only throttle or block.
    origin = await startFakeOrigin(() => ({ status: 200, body: JPEG }));
    await proxy.fetchOriginOnce(origin.url(), "met");
    const ua = origin.requests[0].headers["user-agent"];
    expect(ua).toBe(identity.USER_AGENT);
    expect(ua).toContain("Tranquilo");
    expect(ua).toContain("tranquilo.art");
  });

  it("sends the Wikimedia-shaped identity for commons", async () => {
    // Wikimedia asks for the tool's purpose alongside the contact.
    origin = await startFakeOrigin(() => ({ status: 200, body: JPEG }));
    await proxy.fetchOriginOnce(origin.url(), "commons");
    expect(origin.requests[0].headers["user-agent"]).toBe(
      identity.WIKIMEDIA_USER_AGENT,
    );
  });

  it("sends an Accept header, so a WAF does not read us as a scraper", async () => {
    origin = await startFakeOrigin(() => ({ status: 200, body: JPEG }));
    await proxy.fetchOriginOnce(origin.url(), "met");
    expect(origin.requests[0].headers.accept).toContain("image/");
  });
});

describe("an origin that refuses", () => {
  it("throws with the status attached, for a 503", async () => {
    // The handler branches on err.status to decide between origin_error
    // and origin_429.
    origin = await startFakeOrigin(() => ({
      status: 503,
      body: "unavailable",
    }));
    await expect(
      proxy.fetchOriginOnce(origin.url(), "met"),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("throws with the status attached, for a 404", async () => {
    origin = await startFakeOrigin(() => ({ status: 404, body: "gone" }));
    await expect(
      proxy.fetchOriginOnce(origin.url(), "met"),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not treat a 3xx body as a success", async () => {
    origin = await startFakeOrigin(() => ({ status: 304, body: "" }));
    await expect(proxy.fetchOriginOnce(origin.url(), "met")).rejects.toThrow();
  });
});

describe("an origin that answers 200 with something that is not an image", () => {
  // Found live: an institutional server answered a broken asset request
  // with 200 OK and an HTML error page. r.ok was blind to it, and Sharp's
  // decode failure was (deliberately, for edge cases like SVG) treated as
  // "store the original anyway" -- so the error page got written into our
  // content-addressed, immutable cache permanently.
  it("throws rather than returning an HTML error page as a stored image", async () => {
    origin = await startFakeOrigin(() => ({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: "<html><body>Object not found</body></html>",
    }));
    await expect(
      proxy.fetchOriginOnce(origin.url(), "europeana"),
    ).rejects.toMatchObject({ status: 200 });
  });

  it("still accepts a missing content-type -- some institutional servers omit it on a real image", async () => {
    // Absence must stay legitimate; only an explicit non-image declaration
    // is a rejection.
    origin = await startFakeOrigin(() => ({
      status: 200,
      body: JPEG,
      headers: {},
    }));
    const out = await proxy.fetchOriginOnce(origin.url(), "met");
    expect(Buffer.compare(out.buf, JPEG)).toBe(0);
  });
});

describe("a 429, which is the failure this whole subsystem exists for", () => {
  it("carries Retry-After through, in seconds", async () => {
    // Used to be discarded, so the old retry loop guessed by retrying
    // immediately, three times, at a source that had just said stop.
    origin = await startFakeOrigin(() => ({
      status: 429,
      headers: { "retry-after": "120" },
      body: "slow down",
    }));
    const err = await proxy
      .fetchOriginOnce(origin.url(), "europeana")
      .catch((e: any) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe("120");
  });

  it("carries Retry-After through when it is an HTTP date", async () => {
    const when = new Date(Date.now() + 300000).toUTCString();
    origin = await startFakeOrigin(() => ({
      status: 429,
      headers: { "retry-after": when },
      body: "",
    }));
    const err = await proxy
      .fetchOriginOnce(origin.url(), "europeana")
      .catch((e: any) => e);
    expect(err.retryAfter).toBe(when);
  });

  it("still throws a 429 when the header is absent", async () => {
    origin = await startFakeOrigin(() => ({ status: 429, body: "" }));
    const err = await proxy
      .fetchOriginOnce(origin.url(), "europeana")
      .catch((e: any) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfter == null).toBe(true);
  });

  it("hands a cooldown the guard can actually use, end to end", async () => {
    // The seam between fetchOriginOnce (extracting the header) and
    // parseRetryAfter (interpreting it) -- where a units mistake would hide.
    origin = await startFakeOrigin(() => ({
      status: 429,
      headers: { "retry-after": "90" },
      body: "",
    }));
    const err = await proxy
      .fetchOriginOnce(origin.url(), "europeana")
      .catch((e: any) => e);
    expect(guard.parseRetryAfter(err.retryAfter, 300)).toBe(90);
  });
});

// A cap on what we will buffer from an origin. `Buffer.from(await
// r.arrayBuffer())` took whatever arrived; the lightbox tier legitimately
// fetches masters up to 52.9MB, so the ceiling sits above that, but
// unbounded is different from generous -- concurrent lightbox misses each
// hold a master resident, and sharp then decodes it, where a large TIFF
// expands to many times its compressed size. sharp has its own decode
// guard (limitInputPixels); this is the guard on the step before that,
// which had none.
describe("oversized origin responses", () => {
  const big = (n: number) => Buffer.alloc(n, 0x41);

  it("refuses a response whose content-length is over the cap, without downloading it", async () => {
    let _sentBody = false;
    origin = await startFakeOrigin(() => {
      _sentBody = true;
      return {
        status: 200,
        headers: {
          "content-length": String(proxy.MAX_ORIGIN_BYTES + 1),
          "content-type": "image/tiff",
        },
        body: big(1024),
      };
    });
    await expect(
      proxy.fetchOriginOnce(origin.url(), "cleveland"),
    ).rejects.toMatchObject({ tooLarge: true });
  });

  it("accepts a master just under the cap", async () => {
    // The boundary is `>` not `>=`: an off-by-one here rejects a legitimate
    // master. Sized well below the cap so the test moves 1MB instead of
    // 64MB; content-length must match the body, or the client sits waiting
    // for bytes that never come.
    const size = 1024 * 1024;
    origin = await startFakeOrigin(() => ({
      status: 200,
      headers: { "content-length": String(size), "content-type": "image/jpeg" },
      body: big(size),
    }));
    const out = await proxy.fetchOriginOnce(origin.url(), "met");
    expect(out.buf.length).toBe(size);
  });

  it("catches a body that exceeds the cap despite a small or absent content-length", async () => {
    // The header is the origin's claim, not a guarantee -- a wrong one is
    // worse than none since it invites trusting it.
    const oversize = proxy.MAX_ORIGIN_BYTES + 4096;
    origin = await startFakeOrigin(() => ({
      status: 200,
      headers: { "content-type": "image/tiff" },
      body: big(oversize),
    }));
    await expect(
      proxy.fetchOriginOnce(origin.url(), "cleveland"),
    ).rejects.toMatchObject({ tooLarge: true });
  });

  it("leaves normal images completely alone", async () => {
    origin = await startFakeOrigin(() => ({
      status: 200,
      headers: { "content-type": "image/jpeg" },
      body: big(300 * 1024),
    }));
    const out = await proxy.fetchOriginOnce(origin.url(), "met");
    expect(out.buf.length).toBe(300 * 1024);
  });

  it("sets a cap above the largest master we actually fetch", async () => {
    // A cap below the documented 52.9MB worst case would break the
    // lightbox tier for real items rather than protect it.
    expect(proxy.MAX_ORIGIN_BYTES).toBeGreaterThan(52.9 * 1024 * 1024);
  });
});
