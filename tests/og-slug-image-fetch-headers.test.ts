// fetchImageDataUri() fetches item.img -- the raw origin URL, not the /img
// proxy URL -- every time a social platform unfurls a shared link, but
// never carried the proxy's identifying headers. An unheaded request to a
// real Europeana thumbnail got a 403 from Cloudflare; the identical
// request with imageFetchHeaders() succeeded.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImageDataUri } from "../api/og/[slug].ts";
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
});
