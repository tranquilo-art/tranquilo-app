// The HTML preloads the six boot requests; the app must reuse them rather
// than fetch each URL a second time (a mismatch silently doubles the load).

import { expect, test } from "@playwright/test";
import { gotoFeed } from "./harness.mts";

const BOOT_SHAPES = [
  "facets",
  "storylines",
  "shelves",
  "music",
  "heroes",
  "set_of_works",
];

test("each boot request is made once, not once for the preload and again for the app", async ({
  page,
}) => {
  const seen = new Map<string, number>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    const shape = url.searchParams.get("shape");
    if (url.pathname === "/api/items" && shape && BOOT_SHAPES.includes(shape)) {
      seen.set(request.url(), (seen.get(request.url()) ?? 0) + 1);
    }
  });

  await gotoFeed(page);

  expect([...seen.keys()]).toHaveLength(BOOT_SHAPES.length);
  for (const [url, count] of seen) {
    expect(count, `${url} was requested ${count} times`).toBe(1);
  }
});
