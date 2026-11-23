// fetchImageDataUri() fetches item.img -- the raw origin URL, not the /img
// proxy URL -- every time a social platform unfurls a shared link, but
// never carried the proxy's identifying headers. An unheaded request to a
// real Europeana thumbnail got a 403 from Cloudflare; the identical
// request with imageFetchHeaders() succeeded.
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardImageDataUri, fetchImageDataUri } from "../api/og/[slug].ts";
import { imageFetchHeaders } from "../lib/source-identity.ts";

describe("fetchImageDataUri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the same identifying headers as the main proxy fetch", async () => {
    let sentHeaders: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init: any) => {
        sentHeaders = init?.headers;
        return {
          ok: true,
          status: 200,
          headers: { get: () => "image/jpeg" },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }),
    );
    await fetchImageDataUri(
      "https://api.europeana.eu/thumbnail/v2/x.jpg",
      "europeana",
    );
    expect(sentHeaders).toEqual(imageFetchHeaders("europeana"));
  });

  function stubImageResponse(contentType: string | null, body?: Buffer) {
    const bytes = body ?? Buffer.alloc(4);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: { get: () => contentType },
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
      })),
    );
  }

  async function sampleImage(format: "webp" | "tiff" | "avif") {
    return sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: { r: 200, g: 120, b: 40 },
      },
    })
      .toFormat(format)
      .toBuffer();
  }

  it.each([
    ["webp", "image/webp"],
    ["tiff", "image/tiff"],
    ["avif", "image/avif"],
    ["webp", "application/octet-stream"],
  ] as const)(
    "converts %s served as %s to a JPEG the card renderer can decode",
    async (format, type) => {
      stubImageResponse(type, await sampleImage(format));
      const uri = await fetchImageDataUri("https://example.org/a", "met");
      expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
      const decoded = Buffer.from(uri.split(",")[1], "base64");
      expect((await sharp(decoded).metadata()).format).toBe("jpeg");
    },
  );

  it("rejects an unsupported type whose bytes cannot be decoded", async () => {
    stubImageResponse("image/webp", Buffer.from("not an image"));
    await expect(
      fetchImageDataUri("https://example.org/a", "met"),
    ).rejects.toThrow();
  });

  it("passes a supported type through untouched", async () => {
    stubImageResponse("Image/JPEG; charset=binary");
    const uri = await fetchImageDataUri("https://example.org/a", "met");
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("treats a missing content type as jpeg", async () => {
    stubImageResponse(null);
    const uri = await fetchImageDataUri("https://example.org/a", "met");
    expect(uri.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
});

describe("cardImageDataUri", () => {
  const ORIGIN = "https://images.example.org/original.jpg";
  const CDN = "https://cdn.example.net";
  const row = { source: "met", native_id: "459334", img: ORIGIN };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetch(responses: Record<string, "jpeg" | "html" | "fail">) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const kind = responses[url] ?? "fail";
        if (kind === "fail") return { ok: false, status: 404 };
        return {
          ok: true,
          status: 200,
          headers: {
            get: () => (kind === "html" ? "text/html" : "image/jpeg"),
          },
          arrayBuffer: async () => new ArrayBuffer(4),
        };
      }),
    );
    return calls;
  }

  function clientWithKey(key: string | null) {
    return {
      query: vi.fn(async () => (key ? [{ object_key: key }] : [])),
    } as any;
  }

  it("reads our stored copy and never contacts the origin", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", CDN);
    const calls = stubFetch({ [`${CDN}/img-cache/k.webp`]: "jpeg" });
    const uri = await cardImageDataUri(clientWithKey("img-cache/k.webp"), row);
    expect(uri?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(calls).toEqual([`${CDN}/img-cache/k.webp`]);
  });

  it("looks the copy up by the display tier's cache key", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", CDN);
    stubFetch({});
    const client = clientWithKey("img-cache/k.webp");
    await cardImageDataUri(client, row);
    expect(client.query.mock.calls[0][1]).toEqual(["met:459334:display"]);
  });

  it("falls back to the origin when no copy is stored", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", CDN);
    const calls = stubFetch({ [ORIGIN]: "jpeg" });
    const uri = await cardImageDataUri(clientWithKey(null), row);
    expect(uri).not.toBeNull();
    expect(calls).toEqual([ORIGIN]);
  });

  it("falls back to the origin when the stored copy cannot be fetched", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", CDN);
    const calls = stubFetch({ [ORIGIN]: "jpeg" });
    const uri = await cardImageDataUri(clientWithKey("img-cache/k.webp"), row);
    expect(uri).not.toBeNull();
    expect(calls).toEqual([`${CDN}/img-cache/k.webp`, ORIGIN]);
  });

  it("uses the origin when no CDN is configured", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", "");
    const calls = stubFetch({ [ORIGIN]: "jpeg" });
    const client = clientWithKey("img-cache/k.webp");
    await cardImageDataUri(client, row);
    expect(calls).toEqual([ORIGIN]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns null when a bot-challenge page is all the origin offers", async () => {
    vi.stubEnv("IMG_CDN_BASE_URL", CDN);
    stubFetch({ [ORIGIN]: "html" });
    expect(await cardImageDataUri(clientWithKey(null), row)).toBeNull();
  });

  it("returns null for a row without an image", async () => {
    stubFetch({});
    expect(
      await cardImageDataUri(clientWithKey(null), { ...row, img: null }),
    ).toBeNull();
  });
});
