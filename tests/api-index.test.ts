import type { VercelRequest, VercelResponse } from "@vercel/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  calls: [] as { file: string; query: Record<string, unknown> }[],
}));

const handlerFor = (file: string) => ({
  default: (req: VercelRequest) => {
    seen.calls.push({ file, query: { ...req.query } });
  },
});

vi.mock("../api/items.ts", () => handlerFor("items"));
vi.mock("../api/submit-collection.ts", () => handlerFor("submit-collection"));
vi.mock("../api/subscribe.ts", () => handlerFor("subscribe"));
vi.mock("../api/track.ts", () => handlerFor("track"));
vi.mock("../api/webhooks/resend.ts", () => handlerFor("resend"));
vi.mock("../api/webhooks/patreon.ts", () => handlerFor("patreon"));
vi.mock("../api/sitemap.ts", () => handlerFor("sitemap"));
vi.mock("../api/v/[slug].ts", () => handlerFor("v"));
vi.mock("../api/img/[source]/[id]/[tier].ts", () => handlerFor("img"));
vi.mock("../api/og/[slug].ts", () => handlerFor("og"));

import handler from "../api/index.ts";

function response() {
  const res = {
    code: 0,
    body: undefined as unknown,
    location: "",
    status(code: number) {
      res.code = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    redirect(code: number, url: string) {
      res.code = code;
      res.location = url;
      return res;
    },
  };
  return res;
}

async function call(
  method: string,
  path: string,
  query: Record<string, string> = {},
) {
  const req = { method, query: { path, ...query } } as unknown as VercelRequest;
  const res = response();
  await handler(req, res as unknown as VercelResponse);
  return res;
}

beforeEach(() => {
  seen.calls.length = 0;
});

describe("api/index routing", () => {
  it("keeps the existing routes", async () => {
    await call("GET", "/api/items", { q: "x" });
    await call("POST", "/api/track");
    await call("GET", "/sitemap.xml");
    await call("GET", "/v/{slug}", { slug: "abc" });
    expect(seen.calls.map((c) => c.file)).toEqual([
      "items",
      "track",
      "sitemap",
      "v",
    ]);
    expect(seen.calls[3].query.slug).toBe("abc");
  });

  it("answers 404 for unknown routes and methods", async () => {
    expect((await call("GET", "/nope")).code).toBe(404);
    expect((await call("POST", "/api/items")).code).toBe(404);
    expect((await call("GET", "/constructor")).code).toBe(404);
    expect(seen.calls).toHaveLength(0);
  });

  it("serves /discover as the discover page", async () => {
    await call("GET", "/discover");
    expect(seen.calls).toEqual([
      { file: "v", query: { path: "/discover", slug: "discover" } },
    ]);
  });

  it("serves /category/{slug} as the category- page slug", async () => {
    await call("GET", "/category/{slug}", { slug: "prints" });
    expect(seen.calls[0].file).toBe("v");
    expect(seen.calls[0].query.slug).toBe("category-prints");
  });

  it("serves /shelf/{id} as the shelf- page slug", async () => {
    await call("GET", "/shelf/{id}", { id: "42" });
    expect(seen.calls[0].query.slug).toBe("shelf-42");
  });

  it("serves /s/{id} with the s- prefix, from id or slug", async () => {
    await call("GET", "/s/{id}", { id: "7" });
    await call("GET", "/s/{slug}", { slug: "8" });
    expect(seen.calls.map((c) => c.query.slug)).toEqual(["s-7", "s-8"]);
  });

  it("serves /v1/items as the keyed items feed", async () => {
    await call("GET", "/v1/items", { audience: "other", q: "x" });
    expect(seen.calls[0].file).toBe("items");
    expect(seen.calls[0].query.audience).toBe("keyed");
    expect(seen.calls[0].query.q).toBe("x");
  });

  it("redirects the volunteer pages", async () => {
    for (const path of ["/pages/volunteer", "/pages/volunteer.html"]) {
      const res = await call("GET", path);
      expect(res.code).toBe(307);
      expect(res.location).toBe("/pages/get-involved.html");
    }
    expect(seen.calls).toHaveLength(0);
  });
});
