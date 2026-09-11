// ItemsApiClient owns every fetch against api/items -- URL construction
// and the shape-specific endpoints. No DOM environment is configured for
// this suite, so fetch is stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemsApiClient } from "../src/app/ItemsApiClient";

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(jsonResponse({})));
  vi.stubGlobal("fetch", fetchMock);
});

describe("apiUrl", () => {
  it("builds a query string and appends the cache-bust version", () => {
    const client = new ItemsApiClient(7, 40);
    expect(client.apiUrl({ shape: "facets" })).toBe(
      "/api/items?shape=facets&v=7",
    );
  });

  it("drops undefined, null and empty-string params", () => {
    const client = new ItemsApiClient(7, 40);
    expect(
      client.apiUrl({ shape: "manifest", cursor: undefined, q: null, x: "" }),
    ).toBe("/api/items?shape=manifest&v=7");
  });

  it("encodes both keys and values", () => {
    const client = new ItemsApiClient(1, 40);
    expect(client.apiUrl({ q: "a b&c" })).toBe("/api/items?q=a%20b%26c&v=1");
  });
});

describe("fetchJson", () => {
  it("resolves with the parsed body on a successful response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 3 }));
    const client = new ItemsApiClient(1, 40);
    await expect(client.fetchJson("/api/items?x=1", "test")).resolves.toEqual({
      total: 3,
    });
  });

  it("throws a labeled error on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503));
    const client = new ItemsApiClient(1, 40);
    await expect(client.fetchJson("/api/items?x=1", "widgets")).rejects.toThrow(
      "api/items widgets responded with 503",
    );
  });
});

describe("fetchFeedPage", () => {
  it("defaults shape/order/limit and merges the caller's own params", async () => {
    const client = new ItemsApiClient(9, 40);
    await client.fetchFeedPage({ category: "Prints", start: 0 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "/api/items?shape=manifest&order=shuffle&limit=40&category=Prints&start=0&v=9",
    );
  });

  it("lets the caller override the default limit", async () => {
    const client = new ItemsApiClient(9, 40);
    await client.fetchFeedPage({ limit: 5 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("limit=5");
  });
});

describe("the fixed-shape fetchers hit the expected endpoint", () => {
  it.each([
    ["fetchFacets", "shape=facets"],
    ["fetchStorylineIndex", "shape=storylines"],
    ["fetchShelves", "shape=shelves"],
    ["fetchMusicBuckets", "shape=music"],
    ["fetchHeroPool", "shape=heroes"],
    ["fetchSetOfWorksIndex", "shape=set_of_works"],
  ] as const)("%s", async (method, expectedQuery) => {
    const client = new ItemsApiClient(1, 40);
    await (client[method] as () => Promise<unknown>)();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(expectedQuery);
  });

  it("fetchStorylineDetail includes the storyline id", async () => {
    const client = new ItemsApiClient(1, 40);
    await client.fetchStorylineDetail("el-greco-evolution");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/items?shape=storyline&id=el-greco-evolution&v=1");
  });

  it("fetchSetOfWorkDetail includes the set id", async () => {
    const client = new ItemsApiClient(1, 40);
    await client.fetchSetOfWorkDetail("set-42");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/items?shape=set_of_work&id=set-42&v=1");
  });
});

describe("countMatches", () => {
  it("returns the total from a successful count response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 12 }));
    const client = new ItemsApiClient(1, 40);
    await expect(client.countMatches({ q: "monet" })).resolves.toBe(12);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/items?shape=count&q=monet&v=1");
  });

  it("defaults a missing total to 0", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    const client = new ItemsApiClient(1, 40);
    await expect(client.countMatches({ q: "x" })).resolves.toBe(0);
  });

  it("swallows a fetch failure and resolves 0 rather than rejecting", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new ItemsApiClient(1, 40);
    await expect(client.countMatches({ q: "x" })).resolves.toBe(0);
    errorSpy.mockRestore();
  });
});

describe("fetchItemsByIds", () => {
  it("sends one ids= parameter per id, not a comma-joined list", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const client = new ItemsApiClient(3, 40);
    await client.fetchItemsByIds(["1", "File:A, B.jpg"]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/items?ids=1&ids=File%3AA%2C%20B.jpg&v=3");
  });

  it("throws a labeled error on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 404));
    const client = new ItemsApiClient(1, 40);
    await expect(client.fetchItemsByIds(["1"])).rejects.toThrow(
      "api/items lookup responded with 404",
    );
  });
});
