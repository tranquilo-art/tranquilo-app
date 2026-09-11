// The /s/{id} share page. This branch of api/v/[slug].ts used to be the
// one handler worth actually invoking (it resolved from a hardcoded file
// and returned before getSql() was called), but since storylines moved
// into Postgres it needs a real `sql` client -- and @neondatabase/serverless
// is externalized, so vi.mock() can't intercept it (confirmed empirically:
// neon()'s own validation still ran against the mock). So this joins the
// rest of the api/ suite in reading the handler as text. The storyline
// content side stays invocation-tested in storyline-share.test.ts; only
// the HTTP-handler wiring is text-only here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, "../api/v/[slug].ts"), "utf8");

// sendStorylinePage()'s own body, isolated so an assertion here can't
// accidentally pass by matching the item branch below it.
const sendStorylinePage = src.slice(
  src.indexOf("async function sendStorylinePage("),
  src.indexOf("export default async function handler("),
);

describe("/s/{id} share page wiring (source-level, see header comment)", () => {
  it("resolves the storyline from Postgres, not a hardcoded file", () => {
    expect(sendStorylinePage).toMatch(
      /await getStoryline\(client, storylineId\)/,
    );
  });

  it("degrades to not-found rather than throwing on a failed query", () => {
    expect(sendStorylinePage).toMatch(/catch \(err\)/);
    expect(sendStorylinePage).toContain("storyline = null");
  });

  it("404s an unknown storyline with its own message, not the item branch's", () => {
    expect(sendStorylinePage).toContain("statusCode = 404");
    expect(sendStorylinePage).toContain("That storyline couldn't be found.");
  });

  it("announces itself as a storyline in the preview title, from the real record", () => {
    expect(sendStorylinePage).toMatch(
      /storyline\.items\.length[^a-zA-Z0-9]*-part storyline/,
    );
    expect(sendStorylinePage).toMatch(
      /ogTitle:\s*escapeHtml\([^)]*storyline\.title[^)]*partLabel[^)]*\)/,
    );
  });

  it("describes it with the storyline's own opening line", () => {
    expect(sendStorylinePage).toContain(
      "clampDescription(storyline.intro_caption, 200)",
    );
  });

  it("points og:image at the storyline card, not an artwork card", () => {
    expect(sendStorylinePage).toMatch(
      /ogImage:\s*[^,]*origin[^,]*\/og\/[^,]*encodeURIComponent\(storylineSlug\(storylineId\)\)[^,]*\.png/,
    );
  });

  it("canonicalises to /s/{id}", () => {
    expect(sendStorylinePage).toMatch(
      /canonicalUrl\s*=\s*[^;]*origin[^;]*\/s\/[^;]*encodeURIComponent\(storylineId\)/,
    );
  });

  it("never redirects /s/{id} back to itself", () => {
    // renderPage's fallback does location.replace(redirectUrl); storylines
    // have no hash form, so reusing the /v/ pattern would reload forever.
    expect(sendStorylinePage).toMatch(
      /redirectUrl:\s*[^,;]*origin[^,;]*\/index\.html(?!#)/,
    );
    expect(sendStorylinePage).not.toMatch(/redirectUrl:\s*canonicalUrl/);
  });

  it("caches like a database-backed row, not a file that ships with a deploy", () => {
    // Used to cache for a day on the premise storylines ship with a
    // deploy -- no longer true once it's an editable Postgres row.
    expect(sendStorylinePage).toContain('"public, max-age=60, s-maxage=300"');
  });

  it("is dispatched before the item branch, with a client already resolved", () => {
    const dispatch = src.slice(
      src.indexOf("export default async function handler("),
    );
    expect(dispatch).toMatch(
      /const client = getSql\(\);[\s\S]*sendStorylinePage\(client,/,
    );
  });
});
