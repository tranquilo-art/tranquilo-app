// Boot data is preloaded from the HTML under the exact URLs the app fetches.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootDataUrls } from "../src/app/bootDataUrls";
import { ItemsApiClient } from "../src/app/ItemsApiClient";
import {
  addBootPreloads,
  readBootUrls,
} from "../vite-plugins/boot-preload.mts";

const HTML = `<html><head>
<title>t</title>
</head><body></body></html>`;

describe("addBootPreloads", () => {
  const urls = ["/api/items?shape=a&locale=en&v=1", "/api/items?shape=b&v=1"];

  it("adds one same-origin fetch preload per URL, inside <head>", () => {
    const out = addBootPreloads(HTML, urls);
    expect(out.match(/rel="preload" as="fetch"/g)).toHaveLength(2);
    expect(out.lastIndexOf("preload")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("crossorigin");
  });

  it("escapes ampersands in the href attribute", () => {
    const out = addBootPreloads(HTML, urls);
    expect(out).toContain('href="/api/items?shape=a&amp;locale=en&amp;v=1"');
    expect(out).not.toMatch(/href="[^"]*&(?!amp;)/);
  });

  it("leaves the page unchanged without URLs", () => {
    expect(addBootPreloads(HTML, [])).toBe(HTML);
  });

  it("does not add a preload twice", () => {
    const once = addBootPreloads(HTML, urls);
    expect(addBootPreloads(once, urls)).toBe(once);
  });
});

describe("bootDataUrls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists exactly the URLs the client requests at startup", () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requested.push(url);
      return new Promise(() => {});
    });
    const client = new ItemsApiClient(7, 60, "en");

    client.fetchFacets();
    client.fetchStorylineIndex();
    client.fetchShelves();
    client.fetchMusicBuckets();
    client.fetchHeroPool();
    client.fetchSetOfWorksIndex();

    expect([...bootDataUrls(client)].sort()).toEqual([...requested].sort());
  });
});

describe("readBootUrls", () => {
  function tempFile(content: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boot-urls-"));
    const file = path.join(dir, "urls.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("returns the listed API URLs", () => {
    const file = tempFile(JSON.stringify(["/api/items?shape=a&v=1"]));
    expect(readBootUrls(file)).toEqual(["/api/items?shape=a&v=1"]);
  });

  it("returns nothing when the file is missing", () => {
    expect(readBootUrls("/nonexistent/boot-urls.json")).toEqual([]);
  });

  it("returns nothing for malformed content", () => {
    expect(readBootUrls(tempFile("not json"))).toEqual([]);
    expect(readBootUrls(tempFile('{"a":1}'))).toEqual([]);
  });

  it("drops entries that are not same-origin API paths", () => {
    const file = tempFile(
      JSON.stringify(["/api/items?shape=a", "https://evil.test/x", 7]),
    );
    expect(readBootUrls(file)).toEqual(["/api/items?shape=a"]);
  });
});
