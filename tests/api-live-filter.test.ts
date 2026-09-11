// Guards two properties of the /api handlers that are easy to break and
// expensive to notice. Static source assertions rather than behavioural
// tests, since the handlers open a real Neon connection at module scope
// and this suite is deliberately offline and synchronous.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVE_ITEMS_AND,
  LIVE_ITEMS_PREDICATE,
  LIVE_ITEMS_WHERE,
} from "../lib/items-sql.ts";
import { expandBaseTemplate } from "../vite-plugins/base-template.mts";
import { expandHeadPartial } from "../vite-plugins/head-partial.mts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function source(relativePath: string) {
  return readFileSync(path.join(__dirname, relativePath), "utf8");
}

// canonical/og/twitter tags expand from a <!-- HEAD:SHARED --> marker at
// build time; running the real transform (not a build) keeps this suite
// honest about what api/v/[slug].ts receives from dist/index.html.
// pages/*.html additionally extend pages/_base.html -- their <title>/
// <meta description> only exist once the extends step resolves them.
// index.html is the app shell, not a marketing page, so it has no
// <extends> and expandBaseTemplate is a no-op for it.
async function builtHtml(relativePath: string) {
  const filename = path.join(__dirname, relativePath);
  const extended = await expandBaseTemplate(
    ROOT,
    filename,
    source(relativePath),
  );
  return expandHeadPartial(ROOT, filename, extended);
}

// All three read `items` independently and do NOT share a serializer.
// Missing the filter in any one leaves a quarantined item publicly
// reachable by direct share URL or preview card.
const HANDLERS = [
  ["api/items.ts", "../api/items.ts"],
  ["api/v/[slug].ts", "../api/v/[slug].ts"],
  ["api/og/[slug].ts", "../api/og/[slug].ts"],
];

describe("live-items filter is applied by every handler that reads `items`", () => {
  HANDLERS.forEach(([label, relativePath]) => {
    it(`${label} imports the shared predicate rather than inlining one`, () => {
      expect(source(relativePath), label).toContain("lib/items-sql.ts");
    });

    it(`${label} has no unfiltered SELECT against items`, () => {
      const text = source(relativePath);
      // Asserts the guarantee, not one spelling of it -- a query built by
      // concatenation rather than a template literal must still count.
      const selects = text.match(/SELECT[^`"';]*FROM items[^`"';]*/g) || [];
      expect(selects.length, `${label} should query items`).toBeGreaterThan(0);

      // api/v/[slug].ts's not-found branch deliberately runs one unfiltered
      // lookup, to redirect a bookmark for a withdrawn item to its museum
      // page instead of a dead end. Exempted by shape: "SELECT url" can't
      // structurally leak title/img/caption, and a museum's object page is
      // already public regardless of why Tranquilo stopped serving it.
      const isDocumentedUrlOnlyException = (statement: string) =>
        /^SELECT url FROM items /.test(statement);

      const interpolatesPredicate = selects.every(
        (statement) =>
          statement.indexOf("${LIVE_ITEMS_") !== -1 ||
          isDocumentedUrlOnlyException(statement),
      );
      // The other legitimate shape: a builder seeding its WHERE clause
      // from the shared constant.
      const seedsFromPredicate =
        /where\s*=\s*\[\s*LIVE_ITEMS_PREDICATE\s*\]/.test(text);

      expect(
        interpolatesPredicate || seedsFromPredicate,
        `${label}: every SELECT against items must derive its filter from lib/items-sql.js, either interpolated or seeded into a WHERE builder`,
      ).toBe(true);
    });
  });
});

describe("the predicate itself", () => {
  it("excludes quarantined rows", () => {
    expect(LIVE_ITEMS_PREDICATE).toContain("quarantined");
  });

  it("enumerates what is HIDDEN, so an unrecognized future status stays visible", () => {
    // The predicate names the states to withhold, so an unrecognized
    // status shows -- the safer failure direction, since accidentally
    // showing an item is recoverable and accidentally hiding the whole
    // catalogue is an outage.
    expect(LIVE_ITEMS_PREDICATE).toMatch(/NOT\s+IN|<>|!=/i);
    expect(LIVE_ITEMS_PREDICATE).not.toMatch(/(?<!NOT\s)\bIN\s*\(/i);
  });

  it("withholds quarantined, rejected, and delisted", () => {
    expect(LIVE_ITEMS_PREDICATE).toContain("quarantined");
    expect(LIVE_ITEMS_PREDICATE).toContain("rejected");
    // delisted is withheld from the feed exactly like the other two; the
    // fallback-redirect behavior that treats it differently lives in
    // api/v/[slug].ts, not this predicate.
    expect(LIVE_ITEMS_PREDICATE).toContain("delisted");
  });

  it("keeps flagged and reviewed items live", () => {
    // Flagged means "worth a look"; reviewed means "looked, it's fine" --
    // neither is a reason to withhold.
    expect(LIVE_ITEMS_PREDICATE).not.toContain("flagged");
    expect(LIVE_ITEMS_PREDICATE).not.toContain("reviewed");
  });

  it("composes correctly with and without an existing WHERE clause", () => {
    expect(LIVE_ITEMS_WHERE.startsWith("WHERE ")).toBe(true);
    expect(LIVE_ITEMS_AND.startsWith("AND ")).toBe(true);
  });
});

describe("share-link attribution never invents an institution", () => {
  const slugSource = source("../api/v/[slug].ts");

  it("falls back to the raw source string, not a hardcoded museum name", () => {
    // The original bug labelled 708 of 954 live items "via The
    // Metropolitan Museum of Art" regardless of real credit --
    // wrong-but-honest beats wrong-but-confident for attribution.
    expect(slugSource).toContain(
      "(INSTITUTION_NAMES as any)[item.source] || item.source",
    );
  });

  it("never defaults to a specific institution entry", () => {
    expect(slugSource).not.toMatch(
      /INSTITUTION_NAMES\[[^\]]*\]\s*\|\|\s*INSTITUTION_NAMES\./,
    );
  });

  it("maps every live source, so the fallback stays a genuine last resort", () => {
    ["met", "smithsonian", "cleveland", "commons", "europeana"].forEach(
      (src) => {
        expect(slugSource, `INSTITUTION_NAMES missing ${src}`).toMatch(
          new RegExp(`\\b${src}\\s*:`),
        );
      },
    );
  });
});

describe("the feed payload carries nothing nobody reads", () => {
  // /api/items is 2.3MB for 941 items and grows linearly toward the
  // catalogue target. Pagination is the structural fix; this guards the
  // cheap part -- not shipping fields with zero consumers.
  const itemsSource = source("../api/items.ts");

  it("does not send `full` -- the lightbox reads lightbox_img", () => {
    expect(itemsSource).not.toMatch(/^\s*full:\s*row\.full_img,/m);
  });

  it("does not send tea_voice_claims -- authoring evidence, not visitor data", () => {
    expect(itemsSource).not.toMatch(/^\s*tea_voice_claims:/m);
  });

  it("still sends the fields the feed actually renders", () => {
    // The counterweight: not an excuse to trim something load-bearing.
    [
      "img:",
      "lightbox_img:",
      "blur_placeholder:",
      "title:",
      "artist:",
      "category:",
      "accentColor:",
      "caption_basic:",
    ].forEach((field) => {
      expect(itemsSource, `feed needs ${field}`).toContain(field);
    });
  });
});

describe("query endpoint: filters, search and cursor paging", () => {
  const itemsSource = source("../api/items.ts");

  it("no longer has an unpaginated response at all (superseded by Phase 5)", () => {
    // Kept as a test rather than deleted, since "a bare request returns
    // everything" is exactly the convenience someone would reasonably re-add.
    expect(itemsSource).toContain("if (!query.paginated)");
    expect(itemsSource).toContain("no longer returns the whole catalogue");
  });

  it("pages by cursor, not offset", () => {
    // An offset silently skips or repeats rows when an item is ingested
    // mid-scroll, and separately this feed contains non-item slides, so
    // DOM position and item index can already disagree by one.
    expect(itemsSource).toContain("encodeCursor");
    // Matches SQL use, not the word -- the comment above the builder
    // explains why cursors beat offsets and contains "OFFSET" itself.
    expect(itemsSource).not.toMatch(/OFFSET\s+[$\d]/i);
  });

  it("the manifest carries ordering and facets, never the heavy text fields", () => {
    // Exists so the client can compute a global feed order --
    // declusterOrder() needs the whole set, which a single page can't
    // provide. Must stay small, so matchesQuery()'s fields are deliberately
    // absent and search goes server-side via ?q= instead.
    const fn = itemsSource.slice(
      itemsSource.indexOf("function serializeManifestRow"),
    );
    const body = fn.slice(0, fn.indexOf("\n}"));
    // source is load-bearing: slugFor() falls back to "met" without it.
    for (const keep of [
      "source",
      "title",
      "artist",
      "category",
      "timeframe",
      "palette",
      "media_type",
      "region_primary",
      "storyline_ids",
      "contains_nudity",
      "twist_category",
    ]) {
      expect(body).toContain(`${keep}:`);
    }
    // title stays: suggestions are built from titles/artists client-side;
    // the rest of matchesQuery()'s fields do not, which is why search
    // itself goes server-side.
    for (const drop of [
      "medium",
      "tags",
      "bio",
      "img",
      "caption_basic",
      "blur_placeholder",
    ]) {
      expect(body).not.toContain(`${drop}:`);
    }
  });

  it("refuses to serve the whole catalogue in one response (Phase 5)", () => {
    expect(itemsSource).toContain("no longer returns the whole catalogue");
    // A 400, not a silent first page: a caller expecting everything and
    // getting 60 items would quietly work on 6% of the catalogue instead
    // of failing.
    expect(itemsSource).not.toMatch(
      /if \(!query\.paginated\) \{\s*res\.json\(items\)/,
    );
  });

  it("the manifest and id-lookup answer before the paginated check", () => {
    // Neither sets `paginated`, so falling through to the Phase 5 guard
    // would 400 the client's first request and every collection/export/
    // storyline lookup.
    const at = (needle: string) => itemsSource.indexOf(needle);
    expect(at("if (query.manifest)")).toBeGreaterThan(-1);
    expect(at("if (query.lookup)")).toBeGreaterThan(at("if (query.manifest)"));
    expect(at("if (!query.paginated)")).toBeGreaterThan(
      at("if (query.lookup)"),
    );
  });

  it("a manifest is never truncated by a stray limit or cursor", () => {
    // A short manifest still looks like a working feed -- just missing
    // items the client never learned about.
    expect(itemsSource).toContain("paginated = false;");
    expect(itemsSource).toContain("cursor is not valid with shape=manifest");
  });

  it("round-trips microsecond precision through the cursor", async () => {
    // Shipped broken: Date.toISOString() truncates to milliseconds while
    // Postgres stores microseconds, so a cursor built from a JS Date said
    // "…197Z" for a row actually at "…197624+00", and `created_at > cursor`
    // stayed true for the row the cursor pointed at -- every page returned
    // the same rows.
    const api = await import("../api/items.ts");
    const ts = "2026-08-05 22:49:10.197624+00";
    const back = api.decodeCursor(api.encodeCursor(ts, "15026"));
    expect(back.createdAt).toBe(ts); // NOT "2026-08-05T22:49:10.197Z"
    expect(back.nativeId).toBe("15026");
  });

  it("selects the timestamp as text so no JS Date is ever in the path", () => {
    expect(itemsSource).toContain("created_at::text AS cursor_ts");
    expect(itemsSource).toContain("encodeCursor(last.cursor_ts");
  });

  it("uses a row-value comparison so the composite index is read directly", () => {
    // Easy to get subtly wrong on the tie case with a hand-written OR chain.
    expect(itemsSource).toContain("(created_at, native_id) > (");
  });

  it("whitelists facets rather than accepting an arbitrary column", () => {
    expect(itemsSource).toMatch(/const FACETS = \[/);
  });

  it("reproduces matchesQuery: substring over search_text, plus the century rule", () => {
    // Verified empirically against all 162 fixture modes with zero
    // disagreements; these assertions pin the shape that produced it.
    expect(itemsSource).toContain(
      "search_text LIKE '%' || immutable_unaccent(lower(",
    );
    expect(itemsSource).toContain("century <= 10"); // "ancient"
    expect(itemsSource).toContain("century = "); // "Nth century"
  });

  it("caps limit so one request cannot ask for the whole catalogue", () => {
    expect(itemsSource).toMatch(/MAX_LIMIT\s*=\s*\d+/);
    expect(itemsSource).toMatch(/Math\.min\(\s*parseInt\(params\.limit/);
  });

  it("returns an explicit null cursor on the last page", () => {
    // A client checking `if (cursor)` should stop; null says so without
    // relying on absence.
    expect(itemsSource).toContain("next_cursor");
    expect(itemsSource).toMatch(/:\s*null,/);
  });
});

describe("id-set lookup protects saved and curated data", () => {
  const itemsSource = source("../api/items.ts");

  it("reports what it could NOT find, not just what it could", () => {
    // Consumers degrade silently when an item is absent: a short CSV,
    // a curated hero row filtered down, a storyline chapter's blank slide.
    expect(itemsSource).toContain("missing:");
    expect(itemsSource).toContain("requestedIds");
  });

  it("an id lookup ignores every other filter", () => {
    // Combining "resolve exactly these" with "find matching" would let a
    // stale category filter silently hide a saved item.
    expect(itemsSource).toMatch(/if \(params\.ids !== undefined\)/);
    expect(itemsSource).toContain("native_id = ANY($1)");
  });

  it("treats a single ids value as one id, never a comma-separated list", () => {
    // 41 live Commons items have a comma in their native_id, so a comma
    // fallback and commas-in-ids can't coexist -- a lone comma-bearing id
    // with one value is exactly that case.
    expect(itemsSource).toContain(
      "Array.isArray(params.ids) ? params.ids : [params.ids]",
    );
    expect(itemsSource).not.toContain('String(params.ids).split(",")');
  });

  it("bounds the id list", () => {
    expect(itemsSource).toMatch(/MAX_IDS\s*=\s*\d+/);
  });

  it("still applies the live-items predicate to a lookup", () => {
    // A rejected item must not become reachable just by asking for it by id.
    // Bounded by structure, not a character count -- a fixed-length slice
    // once broke when a nearby comment pushed the SQL past its window
    // while the code stayed correct.
    const start = itemsSource.indexOf("params.ids !== undefined");
    const end = itemsSource.indexOf("function bind(", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(itemsSource.slice(start, end)).toContain("LIVE_ITEMS_PREDICATE");
  });

  it("caller mistakes are 400s, not 500s, and are not reported to Sentry", () => {
    // Reporting caller mistakes would bury real failures under typos, and
    // a 500 tells a client to retry something that will never succeed.
    expect(itemsSource).toMatch(/\(err as any\)\.status === 400/);
    // Anchored on `query = buildQuery(params)` rather than the first
    // "} catch (err) {" in the file, since earlier-dispatched branches add
    // catch blocks of the same shape with no 400 case.
    const afterQuery = itemsSource.indexOf("query = buildQuery(params)");
    expect(afterQuery, "buildQuery(params) call not found").toBeGreaterThan(-1);
    const catchBlock = itemsSource.slice(
      itemsSource.indexOf("} catch (err) {", afterQuery),
    );
    expect(catchBlock.indexOf("res.statusCode = 400")).toBeLessThan(
      catchBlock.indexOf("reportError"),
    );
  });
});

describe("SEO metadata", () => {
  const slugSource = source("../api/v/[slug].ts");

  it("every page carries a canonical and social tags", async () => {
    // A crawler following a share link already got rich per-item tags;
    // one arriving at the front door got nothing at all.
    for (const page of [
      "../index.html",
      "../pages/about.html",
      "../pages/privacy.html",
      "../pages/pro.html",
      "../pages/submit.html",
      "../pages/terms.html",
    ]) {
      const html = await builtHtml(page);
      expect(html, page).toContain('rel="canonical"');
      expect(html, page).toContain('property="og:title"');
      expect(html, page).toContain('name="twitter:card"');
      expect(html, page).toMatch(/<meta name="description" content="[^"]+">/);
    }
  });

  it("the homepage description no longer says Met-only", () => {
    // A leftover from when the Met was the only source; there are five now.
    expect(source("../index.html")).not.toContain(
      "public-domain art from The Met",
    );
  });

  it("a /v/{slug} page strips the homepage's tags before adding its own", () => {
    // api/v/[slug].js serves index.html in place, which already has its
    // own canonical/og:title -- without stripping first, an artwork page
    // would carry two of each and a crawler could index it as the homepage.
    expect(slugSource).toContain('replace(/<link rel="canonical"[^>]*>');
    expect(slugSource).toMatch(
      /replace\(\/<meta \(\?:property="og:\|name="twitter:\)/,
    );
  });

  it("exactly one canonical survives the transform", async () => {
    // Run against the real built index.html rather than asserted from
    // source shape.
    const html = (await builtHtml("../index.html"))
      .replace(/<link rel="canonical"[^>]*>\s*/g, "")
      .replace(/<meta (?:property="og:|name="twitter:)[^>]*>\s*/g, "");
    expect((html.match(/rel="canonical"/g) || []).length).toBe(0);
    expect((html.match(/og:title/g) || []).length).toBe(0);
  });
});
