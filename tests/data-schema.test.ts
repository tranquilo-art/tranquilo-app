// Runs against a frozen snapshot of the retired js/data.js and js/storylines.js
// (tests/fixtures/*.json), plus retired src/data/music.ts/shelves.ts -- see
// scripts/check_storyline_integrity.py for the live-database equivalent.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATEGORY_TO_MUSIC_BUCKET, MUSIC_BUCKETS } from "../src/data/music.ts";
import { SHELVES } from "../src/data/shelves.ts";
import type { MusicBucketKey } from "../src/types/MusicBucket";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRANQUILO_ITEMS = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/data-schema-items.json"), "utf8"),
);
const STORYLINES = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/storylines.json"), "utf8"),
);

// Controlled vocabularies come from shared/vocabulary.json, also loaded by the
// ingestion pipeline's vocab.py -- previously duplicated by hand across this
// file, core.py, and the README, with nothing keeping them in sync.
const VOCABULARY = JSON.parse(
  readFileSync(path.join(__dirname, "../shared/vocabulary.json"), "utf8"),
);

const REQUIRED_FIELDS = VOCABULARY.required_fields;

describe("catalogue: required fields", () => {
  REQUIRED_FIELDS.forEach((field: any) => {
    it(`every item has a non-empty '${field}'`, () => {
      TRANQUILO_ITEMS.forEach((item: any) => {
        expect(item[field], `item ${item.id} missing ${field}`).toBeTruthy();
      });
    });
  });
});

const VALID_CATEGORIES = VOCABULARY.categories;
const VALID_REGIONS = VOCABULARY.regions;
const VALID_TIMEFRAMES = VOCABULARY.timeframes;
const VALID_MEDIA_TYPES = VOCABULARY.media_types;
const VALID_PALETTES = VOCABULARY.palettes;
const VALID_SUBJECT_TYPES = VOCABULARY.subject_types;

describe("catalogue: category taxonomy", () => {
  it("every item's category is one of the 5 current values", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(VALID_CATEGORIES, `item ${item.id}`).toContain(item.category);
    });
  });
});

describe("catalogue: facets", () => {
  it("region_primary, where non-null, is one of the 8 controlled-vocabulary values", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.region_primary == null) return;
      expect(VALID_REGIONS, `item ${item.id}`).toContain(item.region_primary);
    });
  });

  it("every item has region_primary populated (either mechanically or via manual assignment)", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(
        item.region_primary,
        `item ${item.id} missing region_primary`,
      ).toBeTruthy();
    });
  });

  it("timeframe, where non-null, is one of the 6 bucket names", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.timeframe == null) return;
      expect(VALID_TIMEFRAMES, `item ${item.id}`).toContain(item.timeframe);
    });
  });

  it("media_type is one of the controlled set", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(VALID_MEDIA_TYPES, `item ${item.id}`).toContain(item.media_type);
    });
  });

  it("palette, where non-null, is one of the 9 named buckets", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.palette == null) return;
      expect(VALID_PALETTES, `item ${item.id}`).toContain(item.palette);
    });
  });

  it("music_mood is present (null placeholder) on every item, per the deferred-field decision", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(item, `item ${item.id} missing music_mood`).toHaveProperty(
        "music_mood",
      );
      expect(item.music_mood, `item ${item.id}`).toBeNull();
    });
  });

  // subject_type applies only to Paintings & Portraits, so this is
  // required-when-applicable rather than catalogue-wide.
  it("every Paintings & Portraits item has a subject_type from the controlled set", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.category !== "Paintings & Portraits") return;
      expect(VALID_SUBJECT_TYPES, `item ${item.id}`).toContain(
        item.subject_type,
      );
    });
  });

  it("subject_type is absent on non-Paintings & Portraits items", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.category === "Paintings & Portraits") return;
      expect(item.subject_type, `item ${item.id}`).toBeUndefined();
    });
  });
});

describe("catalogue: id uniqueness", () => {
  it("every id is unique across the catalogue", () => {
    const ids = TRANQUILO_ITEMS.map((i: any) => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("catalogue: accentColor", () => {
  // 8 items lack accentColor entirely; treated as optional since app.js's
  // sampleArtworkColor handles a missing value. Make required once backfilled.
  it("accentColor, where present, is a valid 6-digit hex", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.accentColor === undefined || item.accentColor === null) return;
      expect(
        item.accentColor,
        `item ${item.id} has malformed accentColor`,
      ).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

describe("catalogue: Tea Voice fields", () => {
  // Renamed from `fact`. Newly-ingested items land with tea_voice_status
  // "not_started" and empty caption_tea (ingest/core.py's enrich_item),
  // pending a manual writing pass. "basic_tier" is excluded on purpose: it's
  // a fourth, permanent outcome (Stage 4 couldn't ground the item's claims)
  // that legitimately has no caption_tea, distinct from "implemented".
  it("every item whose Tea Voice status is past not_started has a non-empty caption_tea", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.tea_voice_status === "not_started") return;
      if (item.tea_voice_status === "basic_tier") return;
      expect(
        item.caption_tea,
        `item ${item.id} missing caption_tea`,
      ).toBeTruthy();
    });
  });

  it("basic_tier items have no caption_tea -- that is the point of the status", () => {
    // Inverse guard, so "basic_tier" can't quietly become a dumping ground
    // for items that do have a caption.
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.tea_voice_status !== "basic_tier") return;
      expect(
        item.caption_tea,
        `item ${item.id} is basic_tier but has a caption_tea`,
      ).toBeFalsy();
    });
  });

  it("every item has a caption_basic string (may be empty)", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(typeof item.caption_basic, `item ${item.id}`).toBe("string");
    });
  });

  it("tea_voice_status, where present, is one of not_started/in_progress/implemented", () => {
    const VALID_STATUSES = VOCABULARY.tea_voice_statuses;
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.tea_voice_status === undefined) return;
      expect(VALID_STATUSES, `item ${item.id}`).toContain(
        item.tea_voice_status,
      );
    });
  });

  it("tea_voice_eligible, where present, is a boolean", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.tea_voice_eligible === undefined) return;
      expect(typeof item.tea_voice_eligible, `item ${item.id}`).toBe("boolean");
    });
  });

  it("no item still carries the old 'fact' field", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      expect(item, `item ${item.id} still has 'fact'`).not.toHaveProperty(
        "fact",
      );
    });
  });
});

describe("storylines: cross-reference integrity", () => {
  const itemIds = new Set(TRANQUILO_ITEMS.map((i: any) => i.id));
  const storylineIds = new Set(STORYLINES.map((s: any) => s.id));

  it("every item's storyline_ids entries correspond to a real storyline", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      (item.storyline_ids || []).forEach((sid: any) => {
        expect(
          storylineIds.has(sid),
          `item ${item.id} references unknown storyline '${sid}'`,
        ).toBe(true);
      });
    });
  });

  it("every item id referenced inside a storyline's items[] corresponds to a real catalogue item (the fixture) or a documented, live-verified post-migration item", () => {
    STORYLINES.forEach((storyline: any) => {
      storyline.items.forEach((entry: any) => {
        const known =
          itemIds.has(entry.id) || POST_MIGRATION_ITEM_IDS.has(entry.id);
        expect(
          known,
          `storyline '${storyline.id}' references unknown item id ${entry.id}`,
        ).toBe(true);
      });
    });
  });
});

// The catalogue fixture is a frozen pre-migration snapshot, offline with no
// DB access, so it can't verify a post-migration item (Cleveland/Commons/
// Europeana/newer Met pulls) the way it can anything in the fixture. This is
// the explicit, documented exception list for such ids, each confirmed live
// (via /api/items?ids=... or a direct Postgres query) before shipping -- an
// id neither in the fixture nor listed here still fails loudly.
const POST_MIGRATION_ITEM_IDS = new Set([
  // Scene Stealers, widened to admit companion pets and photographs of them.
  437890, // Veronese, "Boy with a Greyhound"
  782306, // Landseer, "A Deerhound"
  265794, // Capel Cure, "Peter" -- a named dog
  261350,
  261353, // Pierson, "Les Chiens" -- the Countess de Castiglione's dogs
  438617, // Tischbein, the three Heckscher children with their dog (1803)
  142744, // House of Fabergé, "Bulldog" -- Creature Curiosities, not Furry Friends
  // The castiglione-pierson storyline: Pierre-Louis Pierson's photographs of
  // the Countess de Castiglione, all nine confirmed live over HTTP
  // (/api/items?ids=...) before shipping. 261370 also appears via the
  // computed "storylines" shelf, as this storyline's cover item.
  261312,
  261287,
  261290,
  261268,
  261546,
  261370,
  261353,
  286787,
  288112,
  // The chess-two-branches storyline. Only 436884 (Liberale da Verona) is
  // pre-migration and in the fixture; the board is a Commons filename string
  // rather than a numeric id, the same shape the Birdwatching shelf
  // established.
  260988,
  267247,
  263123,
  "File:Chinese chess board painted with flowers of the four seasons.jpg",
  // Creature Curiosities additions: animals rendered as precious or ritual
  // objects.
  142745,
  115159,
  43248,
  109106,
  155432,
  44719,
  42179,
  // Scene Stealers additions + the Birdwatching shelf.
  99443,
  127235,
  140408,
  451725,
  132616,
  142738,
  117940,
  147576,
  "File:A Colorful Spring.jpg",
  "File:Chen Lin, Water Fowl.jpg",
  "File:Bian Jingzhao-Four Magpies.jpg",
  // Salvator Rosa's "Scenes of Witchcraft" (4 items) and Van Gogh's
  // "Saint-Rémy to Auvers" (3 items), Cleveland items.
  149105,
  149106,
  149107,
  149108,
  125249,
  135299,
  135310,
  // "Redon Draws the End of the World" -- the 12 plates of Redon's Apocalypse
  // of Saint John, Cleveland accession 1926.140.2-.13.
  108396,
  108397,
  108399,
  108400,
  108401,
  108402,
  108403,
  108404,
  108405,
  108406,
  108407,
  108408,
  // "Breaking the Picture Apart" -- cubism traced from Cezanne to Mondrian, 8
  // Cleveland items. Each artist was checked against Brazil's life+70 term
  // before ingestion; two Blazys works and one undated attribution were
  // excluded as still in copyright there despite Cleveland's CC0 flag.
  115405,
  142692,
  143278,
  146806,
  153749,
  160771,
  164630,
  325449,
  // "Why They Went" -- three photographic expeditions to Egypt and the Near
  // East: Du Camp, Salzmann, Frith.
  287073,
  263235,
  287159,
  287053,
  287054,
  286948,
  260973,
  260957,
  260971,
]);

describe("shelves: referential integrity", () => {
  const itemIds = new Set(TRANQUILO_ITEMS.map((i: any) => i.id));
  // Fields that actually appear on at least one item, so rule-shelf filter
  // keys are checked against the real schema, not a list that can drift.
  const knownFields = new Set();
  TRANQUILO_ITEMS.forEach((item: any) => {
    Object.keys(item).forEach((key) => {
      knownFields.add(key);
    });
  });

  it("every hero shelf's itemIds entries correspond to a real catalogue item (the fixture) or a documented, live-verified post-migration item", () => {
    SHELVES.filter((s: any) => s.type === "hero").forEach((shelf: any) => {
      // The "storylines" shelf's itemIds is [] on purpose -- storylines are
      // fetched now, so app.js populates it at runtime; checked below
      // directly against STORYLINES' cover_item_id instead.
      if (shelf.id === "storylines") return;
      shelf.itemIds.forEach((id: any) => {
        const known = itemIds.has(id) || POST_MIGRATION_ITEM_IDS.has(id);
        expect(
          known,
          `shelf '${shelf.id}' references unknown item id ${id}`,
        ).toBe(true);
      });
    });
  });

  it('the "storylines" shelf\'s runtime-computed itemIds (app.js) correspond to a real catalogue item or a documented, live-verified post-migration item', () => {
    // Mirrors app.js's storylineIndex.map(s => s.cover_item_id) -- the same
    // check as the hero-shelf test above, for the one shelf SHELVES can't cover.
    STORYLINES.forEach((storyline: any) => {
      const id = storyline.cover_item_id;
      const known = itemIds.has(id) || POST_MIGRATION_ITEM_IDS.has(id);
      expect(
        known,
        `storyline '${storyline.id}' cover_item_id ${id} is unknown`,
      ).toBe(true);
    });
  });

  it("every rule shelf's filter keys correspond to a real field in the current item schema", () => {
    SHELVES.filter((s: any) => s.type === "rule").forEach((shelf: any) => {
      Object.keys(shelf.filter).forEach((key) => {
        expect(
          knownFields.has(key),
          `shelf '${shelf.id}' filters on unknown field '${key}'`,
        ).toBe(true);
      });
    });
  });
});

// Tripwire: CATEGORY_TO_MUSIC_BUCKET is keyed by category with no
// error-handling on a miss -- a lookup failure just silently resolves to no
// music (app.js's fadeTo()). Ensures a category rename shipped without a
// matching music.js update fails loudly here instead.
describe("music: category-to-bucket mapping integrity", () => {
  it("every CATEGORY_TO_MUSIC_BUCKET key corresponds to a category that actually exists in the catalogue fixture", () => {
    const liveCategories = new Set(TRANQUILO_ITEMS.map((i: any) => i.category));
    Object.keys(CATEGORY_TO_MUSIC_BUCKET).forEach((category) => {
      expect(
        liveCategories.has(category),
        `CATEGORY_TO_MUSIC_BUCKET references category '${category}', which no longer exists in the catalogue fixture`,
      ).toBe(true);
    });
  });

  // MUSIC_BUCKETS[key].category and CATEGORY_TO_MUSIC_BUCKET state the same
  // 1:1 relationship in opposite directions, kept as two hand-written
  // statements rather than deriving one from the other so
  // `Record<Category, MusicBucketKey>`'s compile-time exhaustiveness check
  // stays in force. This test is the tripwire keeping them from drifting apart.
  it("MUSIC_BUCKETS[key].category agrees with CATEGORY_TO_MUSIC_BUCKET in both directions", () => {
    Object.keys(CATEGORY_TO_MUSIC_BUCKET).forEach((category) => {
      const bucketKey = CATEGORY_TO_MUSIC_BUCKET[category];
      const bucket = MUSIC_BUCKETS[bucketKey];
      expect(
        bucket,
        `CATEGORY_TO_MUSIC_BUCKET['${category}'] names bucket '${bucketKey}', which doesn't exist in MUSIC_BUCKETS`,
      ).toBeTruthy();
      expect(
        bucket.category,
        `MUSIC_BUCKETS['${bucketKey}'].category should be '${category}' to agree with CATEGORY_TO_MUSIC_BUCKET`,
      ).toBe(category);
    });
    Object.keys(MUSIC_BUCKETS).forEach((bucketKey) => {
      const category = MUSIC_BUCKETS[bucketKey as MusicBucketKey].category;
      if (category === null) return; // "asian-art" -- a real, permanent orphan, not an omission
      expect(
        CATEGORY_TO_MUSIC_BUCKET[category],
        `MUSIC_BUCKETS['${bucketKey}'].category is '${category}', but CATEGORY_TO_MUSIC_BUCKET has no matching entry`,
      ).toBe(bucketKey);
    });
  });
});

// Forward-looking: no items yet carry a twist_* field, so this passes
// vacuously until the Plot Twist manual tagging pass begins.
const TWIST_REQUIRED_FIELDS = VOCABULARY.twist_required_fields;
// "looted" and "repatriation_dispute" stay in the enum but are deliberately
// paused pending thought on tone for sensitive subject matter -- see
// TWIST_DEFERRED_VALUES and the test enforcing the pause.
const TWIST_CATEGORY_VALUES = VOCABULARY.twist_categories;
const TWIST_DEFERRED_VALUES = VOCABULARY.twist_categories_deferred;
const TWIST_CONFIDENCE_VALUES = VOCABULARY.twist_confidences;
describe("catalogue: Plot Twist fields (forward-looking)", () => {
  it("every item with a twist_category has all of the required twist_ fields, and vice versa", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      const hasAny = TWIST_REQUIRED_FIELDS.some(
        (f: any) => item[f] !== undefined,
      );
      if (!hasAny) return;
      TWIST_REQUIRED_FIELDS.forEach((f: any) => {
        expect(
          item[f],
          `item ${item.id} has a twist_ field set but is missing ${f}`,
        ).not.toBeUndefined();
      });
    });
  });

  it("twist_category, where present, is one of the 9 defined values", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.twist_category === undefined) return;
      expect(TWIST_CATEGORY_VALUES, `item ${item.id}`).toContain(
        item.twist_category,
      );
    });
  });

  it("twist_category, where present, is not one of the currently-deferred values (looted, repatriation_dispute)", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.twist_category === undefined) return;
      expect(TWIST_DEFERRED_VALUES, `item ${item.id}`).not.toContain(
        item.twist_category,
      );
    });
  });

  it("twist_confidence, where present, is one of verified/disputed/anecdotal", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.twist_confidence === undefined) return;
      expect(TWIST_CONFIDENCE_VALUES, `item ${item.id}`).toContain(
        item.twist_confidence,
      );
    });
  });
});

describe("catalogue: Meet the Cast", () => {
  const ATTRIBUTION_VALUES = VOCABULARY.cast_attribution_confidences;
  const TIER_VALUES = VOCABULARY.cast_tiers;

  it("cast_tier, where present, is one of full/partial/none", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.cast_tier === undefined) return;
      expect(TIER_VALUES).toContain(item.cast_tier);
    });
  });

  it("any item with cast_tier full or partial has a non-empty cast array", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      if (item.cast_tier === "full" || item.cast_tier === "partial") {
        expect(Array.isArray(item.cast), `item ${item.id}`).toBe(true);
        expect(item.cast.length, `item ${item.id}`).toBeGreaterThan(0);
      }
    });
  });

  it("every cast entry has a name and a valid attribution_confidence", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      (item.cast || []).forEach((person: any) => {
        expect(person.name, `item ${item.id}`).toBeTruthy();
        expect(
          ATTRIBUTION_VALUES,
          `item ${item.id} cast entry ${person.name}`,
        ).toContain(person.attribution_confidence);
      });
    });
  });

  it("no item with a hedged cast entry has cast_tier full (hedged attributions never reach Full Cast)", () => {
    TRANQUILO_ITEMS.forEach((item: any) => {
      const hasHedged = (item.cast || []).some(
        (person: any) => person.attribution_confidence === "hedged",
      );
      if (hasHedged) {
        expect(item.cast_tier, `item ${item.id}`).not.toBe("full");
      }
    });
  });

  // Regression set: 5 originally named items plus 544740 ("Yuny and His
  // Wife Renenutet"), confirmed live as correctly tiered full.
  const EXPECTED_FULL_IDS = [436106, 436840, 451264, 544740, 299310, 306149];
  it("the fixed regression set of items still resolves to cast_tier full", () => {
    EXPECTED_FULL_IDS.forEach((id: any) => {
      const item = TRANQUILO_ITEMS.find((i: any) => i.id === id);
      expect(item, `expected item ${id} to exist`).toBeTruthy();
      expect(item.cast_tier, `item ${id} (${item.title})`).toBe("full");
    });
  });
});
