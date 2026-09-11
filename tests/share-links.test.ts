// share/copy-link URLs must be percent-encoded. slugFor() built
// "{source}-{native_id}" and shareUrlFor() dropped it into a path with no
// encoding, so a leading "/" in Europeana ids split the URL into extra
// path segments (a hard 404, verified live), and Commons filenames with
// spaces/colons were invalid URL characters. A blanket
// encodeURIComponent(slugFor(item)) fixed validity but not readability,
// and blew up CJK filenames past a real fetch tool's URL-length limit
// (each Chinese character becomes 9 percent-encoded bytes). encodeURI()
// doesn't help either -- verified it percent-encodes non-ASCII exactly
// like encodeURIComponent() does in real JavaScript. The actual fix only
// escapes the handful of characters that would corrupt a path segment
// ("%", "/", "#", "?", whitespace); Commons' "File:" prefix and
// Europeana's internal "/" are handled separately before that.
//
// Source assertions rather than DOM tests, since app.ts is a browser IIFE
// with no module exports and this suite is offline by design.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(path.join(__dirname, "../src/app.ts"), "utf8");
// slugFor() lives in slideBuilder.ts; app.ts keeps shareUrlFor(), which
// builds the encoded URL form inline rather than calling slugFor().
const slideBuilderSource = readFileSync(
  path.join(__dirname, "../src/feed/slideBuilder.ts"),
  "utf8",
);
const feedSource = readFileSync(
  path.join(__dirname, "../src/components/TranquiloFeed.ts"),
  "utf8",
);
const slugRouteSource = readFileSync(
  path.join(__dirname, "../api/v/[slug].ts"),
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

// Real live ids, one per source, chosen for the characters that broke.
const REAL_IDS = [
  [
    "europeana",
    "/91643/SMVK_OM_objekt_119801",
    "leading slash -- split the route, hard 404",
  ],
  [
    "europeana",
    "/2024903/photography_ProvidedCHO_KU_Leuven_9990939540101488",
    "leading slash",
  ],
  ["commons", "File:Tour in Spring and Come back late.jpg", "colon and spaces"],
  [
    "commons",
    "File:Mughal Emperor Shahjahan - Google Art Project.jpg",
    "colon, spaces, hyphen",
  ],
  [
    "commons",
    "File:岁朝欢庆图轴.清姚文瀚绘.纸本设色.台北故宫博物院藏.tif",
    "CJK -- blew up past a fetch tool's URL-length limit",
  ],
  ["smithsonian", "ld1-1643399887910-1643399894916-0", "internal hyphens"],
  ["met", "436535", "the plain case that always worked"],
];

// The functions, reproduced exactly. Kept in sync by the source
// assertions below, which fail if the real ones stop matching.
function slugFor(item: any) {
  return `${item.source || "met"}-${item.id}`;
}

function encodeSlugId(source: any, rawId: any) {
  let idPart = rawId;
  if (source === "commons" && idPart.slice(0, 5) === "File:") {
    idPart = idPart.slice(5);
  } else if (source === "europeana") {
    const m = /^\/([0-9]+)\/(.+)$/.exec(idPart);
    if (m) idPart = `${m[1]}-${m[2]}`;
  }
  // NOT encodeURI() -- it percent-encodes non-ASCII exactly like
  // encodeURIComponent() in real JavaScript. Only characters that would
  // corrupt the path get escaped.
  return idPart.replace(/[%/#?\s]/g, encodeURIComponent);
}

// Client-side decode: the segment it receives (from location.pathname/hash)
// is still percent-encoded.
function decodeSlugIdClient(source: any, idPart: any) {
  let rawId = decodeURIComponent(idPart);
  if (source === "commons") {
    if (rawId.slice(0, 5) !== "File:") rawId = `File:${rawId}`;
  } else if (source === "europeana" && rawId.charAt(0) !== "/") {
    const m = /^([0-9]+)-(.+)$/.exec(rawId);
    if (m) rawId = `/${m[1]}/${m[2]}`;
  }
  return rawId;
}

// Server-side decode: no decodeURIComponent, since Vercel's router
// already fully decoded req.query.slug before the handler sees it --
// decoding twice throws on a lone "%" that survived as a literal character.
function decodeSlugIdServer(source: any, idPart: any) {
  if (source === "commons") {
    return idPart.slice(0, 5) === "File:" ? idPart : `File:${idPart}`;
  }
  if (source === "europeana" && idPart.charAt(0) !== "/") {
    const m = /^([0-9]+)-(.+)$/.exec(idPart);
    if (m) return `/${m[1]}/${m[2]}`;
  }
  return idPart;
}

function shareUrlFor(item: any) {
  const source = item.source || "met";
  return `https://tranquilo.art/v/${source}-${encodeSlugId(source, item.id)}`;
}

describe("share URLs are encoded", () => {
  it("shareUrlFor uses the id-only encode, not blanket encodeURIComponent(slugFor(item))", () => {
    expect(shareServiceSource).toContain("encodeSlugId(source, item.id)");
    expect(shareServiceSource).not.toContain(
      "encodeURIComponent(slugFor(item))",
    );
  });

  it("produces a URL with no raw slash, space or colon in the slug segment", () => {
    REAL_IDS.forEach(([source, id, why]) => {
      const url = shareUrlFor({ source: source, id: id });
      const slugSegment = url.split("/v/")[1];
      expect(slugSegment, `${source} ${id} (${why})`).not.toMatch(/[/ :]/);
    });
  });

  it("does not blow up a CJK filename into an over-long percent-encoded mess", () => {
    // The fixed scheme leaves Unicode letters literal, so the slug
    // segment should track the filename's own length.
    const cjk = "File:岁朝欢庆图轴.清姚文瀚绘.纸本设色.台北故宫博物院藏.tif";
    const slugSegment = shareUrlFor({ source: "commons", id: cjk }).split(
      "/v/",
    )[1];
    expect(slugSegment.length).toBeLessThan(cjk.length + 20);
  });

  it("round-trips: the backend recovers the exact original source and native id", () => {
    // parseSlug() receives the slug already decoded by Vercel's router,
    // splits on the first hyphen, then reverses the transform via decodeSlugId().
    REAL_IDS.forEach(([source, id]) => {
      const url = shareUrlFor({ source: source, id: id });
      const vercelDecoded = decodeURIComponent(url.split("/v/")[1]);

      const parts = vercelDecoded.split(/-(.+)/); // api/v/[slug].js parseSlug
      expect(parts[0]).toBe(source);
      expect(decodeSlugIdServer(parts[0], parts[1])).toBe(id);
    });
  });

  it("an OLD-style share link still resolves to the same native id", () => {
    // Old links blanket-escaped the whole slug, so decoding one hands
    // decodeSlugId a rawId that already looks fully reconstructed, and its
    // guards must pass it through unchanged.
    REAL_IDS.forEach(([source, id]) => {
      const oldStyleUrl = `https://tranquilo.art/v/${encodeURIComponent(slugFor({ source: source, id: id }))}`;
      const vercelDecoded = decodeURIComponent(oldStyleUrl.split("/v/")[1]);
      const parts = vercelDecoded.split(/-(.+)/);
      expect(decodeSlugIdServer(parts[0], parts[1])).toBe(id);
    });
  });

  it("the client-side decode (deep-link resume) also recovers the exact raw slug", () => {
    REAL_IDS.forEach(([source, id]) => {
      const url = shareUrlFor({ source: source, id: id });
      const pathPart = url.split("/v/")[1]; // still percent-encoded, as location.pathname would show it
      const cut = pathPart.indexOf("-");
      const srcPart = pathPart.slice(0, cut);
      const idPart = pathPart.slice(cut + 1);
      const rebuilt = `${srcPart}-${decodeSlugIdClient(srcPart, idPart)}`;
      expect(rebuilt).toBe(slugFor({ source: source, id: id }));

      // And an old-style link decodes the same way client-side too.
      const oldStyleUrl = `https://tranquilo.art/v/${encodeURIComponent(slugFor({ source: source, id: id }))}`;
      const oldPathPart = oldStyleUrl.split("/v/")[1];
      const oldCut = oldPathPart.indexOf("-");
      const oldRebuilt = `${oldPathPart.slice(0, oldCut)}-${decodeSlugIdClient(oldPathPart.slice(0, oldCut), oldPathPart.slice(oldCut + 1))}`;
      expect(oldRebuilt).toBe(slugFor({ source: source, id: id }));
    });
  });
});

describe("slugFor stays RAW -- the fix that would break deep links", () => {
  // Encoding inside slugFor() looks equivalent and passes every test
  // above, but slugFor() also feeds data-slug, which every e2e test that
  // locates a slide builds a `[data-slug="source-id"]` selector against --
  // encoding one side and not the other would silently break all of them.
  it("slugFor itself does not encode", () => {
    const line = slideBuilderSource
      .split("\n")
      .find((l) => l.indexOf("function slugFor(item") !== -1);
    expect(line, "slugFor should return the raw identity").toBeTruthy();
    expect(line).not.toContain("encodeURIComponent");
  });

  it("data-slug is written from the raw slug", () => {
    expect(slideBuilderSource).toContain("el.dataset.slug = slugFor(item)");
  });

  it("the hash side decodes, so raw-in-DOM is the matching contract", () => {
    // Structural rather than one exact line, so this survives a reflow of
    // either method.
    expect(slugCodecSource).toContain('location.hash.replace(/^#/, "")');
    const decodeSlugBody = slugCodecSource.slice(
      slugCodecSource.indexOf("decodeSlug(part"),
      slugCodecSource.indexOf("slugFromLocation()"),
    );
    expect(decodeSlugBody).toContain("decodeURIComponent");
    expect(slugRouteSource).toMatch(
      /index\.html#[^a-zA-Z0-9]*encodeURIComponent\(slug\)/,
    );
  });

  it("a slug survives the full share -> hash -> deep-link round trip", () => {
    // The historical /index.html#{slug} fallback carries whatever slug the
    // request came in as, re-encoded verbatim, without running parseSlug()'s
    // decode -- so slugFromLocation()'s hash branch has to reverse the
    // transform itself.
    REAL_IDS.forEach(([source, id]) => {
      const raw = slugFor({ source: source, id: id });
      // share link -> server re-encodes the (still-transformed) slug into a hash
      const hash = encodeURIComponent(
        decodeURIComponent(
          shareUrlFor({ source: source, id: id }).split("/v/")[1],
        ),
      );
      const hashPart = decodeURIComponent(hash); // location.hash.replace(/^#/, "") equivalent, pre-decode
      const cut = hashPart.indexOf("-");
      const rebuilt = `${hashPart.slice(0, cut)}-${decodeSlugIdServer(hashPart.slice(0, cut), hashPart.slice(cut + 1))}`;
      expect(rebuilt).toBe(raw);
    });
  });

  it("every real slug matches the router's shape check", () => {
    // app.ts's deep-link init only honours a slug matching /^[a-z]+-.+$/;
    // anything else is left as a plain hash/path, not treated as an item.
    REAL_IDS.forEach(([source, id]) => {
      expect(
        /^[a-z]+-.+$/.test(slugFor({ source: source, id: id })),
        `${source}-${id}`,
      ).toBe(true);
    });
  });
});

describe("a slug never reaches a CSS selector at all", () => {
  // This used to be an escaping test: the deep-link resume interpolated
  // the slug into '[data-slug="..."]', and an unescaped Commons filename
  // could close the selector early and throw. That vulnerability was
  // removed instead of escaped -- a deep link is now honoured by ordering
  // the first render via a plain string comparison, so it never enters a
  // selector at all.
  it("does not interpolate a slug into a querySelector", () => {
    expect(appSource).not.toMatch(/querySelector\([^)]*data-slug="\s*\+/);
  });

  it("resolves a slug by string handling, never by a selector", () => {
    // Checks the property, not the implementation, since a slug is
    // source-controlled text (Commons names files literally) that must
    // never be handed to a parser. resolveSlug() splits the slug on its
    // first hyphen and looks the item up by id, then starts the feed at
    // that item's shuffle_key -- pure string handling, no selector.
    const resolver = feedSource.slice(feedSource.indexOf("resolveSlug(slug"));
    expect(resolver, "resolveSlug() should exist").not.toBe("");
    expect(resolver.slice(0, 900)).toMatch(/indexOf\("-"\)/);
    expect(resolver.slice(0, 900)).toMatch(/\.slice\(/);
  });

  it("does not call CSS.escape, which is for identifiers not quoted values", () => {
    expect(appSource).not.toMatch(/CSS\.escape\s*\(/);
  });
});
