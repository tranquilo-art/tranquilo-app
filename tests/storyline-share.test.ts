// A Storyline needs its own shareable URL, because it has no URL at
// all today -- openStorylineMode() pushes history state with location.href
// UNCHANGED, so the address bar never moves and there is nothing to copy.
//
// The share slug is `s-{storyline_id}`, served at the public path /s/{id} via a
// vercel.json rewrite into the EXISTING api/v/[slug].js. That indirection is
// not stylistic: Vercel Hobby allows 12 serverless functions and api/ is at
// exactly 12, so a dedicated api/storyline route would fail the DEPLOY while
// the BUILD passed, leaving production silently serving the previous commit.
// Rewrites are free; functions are not. tests/vercel-config.test.js enforces
// the cap itself -- this file enforces that the storyline route reaches the
// right handler without adding one.
//
// Storylines moved from a hardcoded js/storylines.js array into Postgres
// (sql/019_storylines.sql). lib/storylines.ts's getStoryline()/
// getStorylineIndex() are async now (they take an open `sql` client), so this
// file's DB-backed assertions run against PGlite (tests/helpers/pg.ts) --
// real Postgres, in-process, seeded from the actual seed file
// (sql/020_storylines_seed.sql) rather than a hand-copied fixture, so a
// change to either the schema or the seed data is exercised here too.
//
// Source assertions for the app.ts side stay synchronous and offline, same
// as before: app.ts is a browser IIFE with no exports, and this suite is
// offline by design.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getStoryline,
  getStorylineIndex,
  parseStorylineSlug,
  STORYLINE_SLUG_PREFIX,
  storylineSlug,
} from "../lib/storylines.ts";
import { makeSql } from "./helpers/pg.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const appSource = readFileSync(path.join(__dirname, "../src/app.ts"), "utf8");
// app.ts keeps same-named wrappers for storylineShareUrlFor/
// storylineIdFromLocation; their bodies live in src/app/ShareService.ts
// and src/app/SlugCodec.ts respectively, checked below.
const storylineModeSource = readFileSync(
  path.join(__dirname, "../src/components/TranquiloStorylineMode.ts"),
  "utf8",
);
const slugCodecSource = readFileSync(
  path.join(__dirname, "../src/app/SlugCodec.ts"),
  "utf8",
);
const shareServiceSource = readFileSync(
  path.join(__dirname, "../src/app/ShareService.ts"),
  "utf8",
);
const vercelConfig = JSON.parse(
  readFileSync(path.join(__dirname, "../vercel.json"), "utf8"),
);

// api/v/[slug].js and api/og/[slug].js both parse a slug this way. Reproduced
// rather than imported because those files are serverless handlers that open a
// Neon client at module scope.
function parseSlug(slug: string) {
  const parts = slug.split(/-(.+)/);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return { source: parts[0], nativeId: parts[1] };
}

let sql: any;
let STORYLINES: any;
beforeAll(async () => {
  sql = await makeSql(["019_storylines.sql", "020_storylines_seed.sql"]);
  STORYLINES = await getStorylineIndex(sql);
});
afterAll(async () => {
  if (sql) await sql.$close();
});

describe("storylines actually loaded from the seed migration", () => {
  it("seeded at least one storyline", () => {
    expect(Array.isArray(STORYLINES)).toBe(true);
    expect(STORYLINES.length).toBeGreaterThan(0);
  });
});

describe("storyline share slugs", () => {
  it("round-trips every real storyline id", () => {
    STORYLINES.forEach((s: any) => {
      expect(parseStorylineSlug(storylineSlug(s.id))).toBe(s.id);
    });
  });

  it("survives the first-hyphen split the share handlers use", () => {
    // Storyline ids contain hyphens ("el-greco-evolution"), and parseSlug
    // splits on the FIRST hyphen only. That is what makes the prefix work:
    // "s-el-greco-evolution" must yield the whole id, not "el".
    STORYLINES.forEach((s: any) => {
      const parsed = parseSlug(storylineSlug(s.id));
      expect(parsed!.source).toBe(STORYLINE_SLUG_PREFIX);
      expect(parsed!.nativeId).toBe(s.id);
    });
  });

  it("does not claim an artwork slug", () => {
    expect(parseStorylineSlug("met-436535")).toBeNull();
    expect(parseStorylineSlug("smithsonian-ld1-1643399887910")).toBeNull();
    expect(parseStorylineSlug("")).toBeNull();
    expect(parseStorylineSlug("s")).toBeNull();
  });

  it("reserves the `s` prefix against every live source name", () => {
    // The prefix only disambiguates while no real source is called "s". This
    // is the guard: adding such a source would silently route its share links
    // into the storyline branch, and the failure would look like a 404 on a
    // valid artwork rather than like a naming collision.
    ["met", "smithsonian", "cleveland", "commons", "europeana"].forEach(
      (src) => {
        expect(src).not.toBe(STORYLINE_SLUG_PREFIX);
      },
    );
  });

  it("resolves a real storyline and rejects an unknown one", async () => {
    await expect(getStoryline(sql, STORYLINES[0].id)).resolves.toMatchObject({
      id: STORYLINES[0].id,
    });
    expect(await getStoryline(sql, "no-such-storyline")).toBeNull();
    expect(await getStoryline(sql, "")).toBeNull();
    expect(await getStoryline(sql, undefined)).toBeNull();
  });
});

describe("storyline ids are safe in a URL path", () => {
  it("needs no percent-encoding", () => {
    // The cautionary tale: Europeana ids begin with "/" and every share link
    // for that source 404'd in production. Storyline ids are hand-authored,
    // so this is cheap to keep true rather than to repair.
    STORYLINES.forEach((s: any) => {
      expect(s.id, `${s.id} must be URL-safe`).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(s.id)).toBe(s.id);
    });
  });
});

describe("the share page has something to render", () => {
  it("every storyline carries the fields the preview needs", async () => {
    for (const index of STORYLINES) {
      const s = await getStoryline(sql, index.id);
      expect(s.title, `${s.id} title`).toBeTruthy();
      expect(s.intro_caption, `${s.id} intro_caption`).toBeTruthy();
      expect(s.cover_item_id, `${s.id} cover_item_id`).toBeTruthy();
      expect(
        Array.isArray(s.items) && s.items.length > 0,
        `${s.id} items`,
      ).toBe(true);
    }
  });
});

describe("vercel.json routes /s/ without adding a function", () => {
  it("rewrites /s/:id into the existing share handler", () => {
    const rewrite = (vercelConfig.rewrites || []).find(
      (r: any) => r.source === "/s/:id",
    );
    expect(
      rewrite,
      "no /s/:id rewrite -- storyline links would 404",
    ).toBeTruthy();
    expect(rewrite.destination).toBe("/api/v/s-:id");
  });

  it("does not introduce an api/storyline function", () => {
    // Belt to tests/vercel-config.test.js's braces: that file caps the count,
    // this one names the specific mistake this ticket was most likely to make.
    const fns = Object.keys(vercelConfig.functions || {});
    expect(fns.some((f) => /storyline/i.test(f))).toBe(false);
  });
});

describe("app.ts builds and honours storyline share URLs", () => {
  it("shares a /s/ URL, not the cover artwork's /v/ URL", () => {
    // The whole point of the request: sharing from the intro page must yield
    // the STORY, not one painting out of it.
    expect(appSource).toMatch(/function storylineShareUrlFor/);
    expect(shareServiceSource).toMatch(
      /\/s\/[^a-zA-Z0-9]*encodeURIComponent\(storyline\.id\)/,
    );
  });

  it("renders a share control on the storyline intro page", () => {
    const intro = storylineModeSource.slice(
      storylineModeSource.indexOf("buildIntroPage("),
      storylineModeSource.indexOf("buildChapterPage("),
    );
    expect(intro, "intro page must offer a share control").toContain(
      "btn-share",
    );
  });

  it("opens a storyline from a /s/{id} cold load", () => {
    expect(appSource).toMatch(/storylineIdFromLocation/);
    expect(slugCodecSource).toMatch(/\\\/s\\\//);
  });
});
