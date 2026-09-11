// Querying Wikidata for cluster research, conditioned on compliance with
// their policy (a proper User-Agent, WDQS's rate limits) and on never
// discarding what's fetched (results are CC0, stored and committed rather
// than re-fetched). The error budget matters most: the rate-limit hold
// was caused by a script running 628 consecutive failures with no
// circuit breaker, and WDQS bans by user agent -- we have exactly one
// Wikimedia identity, so an error storm here would cost Commons access too.
import { describe, expect, it } from "vitest";
import * as identity from "../lib/source-identity.ts";
import * as wd from "../lib/wikidata-client.ts";

describe("identifying ourselves", () => {
  it("sends the Wikimedia-shaped user agent, not the generic one", () => {
    const h = wd.requestHeaders();
    expect(h["User-Agent"]).toBe(identity.WIKIMEDIA_USER_AGENT);
    expect(h["User-Agent"]).toContain("https://tranquilo.art");
    expect(h["User-Agent"]).toContain("@");
  });

  it("asks for SPARQL JSON explicitly", () => {
    expect(wd.requestHeaders().Accept).toMatch(/sparql-results\+json/);
  });
});

describe("the error circuit breaker", () => {
  it("opens well below the published error budget", () => {
    // WDQS allows 30 errors/minute; stopping near that is the limit, not a margin.
    expect(wd.ERROR_LIMIT).toBeLessThan(10);
  });

  it("stops after consecutive failures", () => {
    expect(wd.shouldStop(wd.ERROR_LIMIT)).toBe(true);
    expect(wd.shouldStop(wd.ERROR_LIMIT - 1)).toBe(false);
  });

  it("counts CONSECUTIVE failures, so a success resets it", () => {
    // A breaker counting lifetime errors would also stop a long healthy run.
    const b = wd.makeBreaker();
    for (let i = 0; i < wd.ERROR_LIMIT - 1; i++) b.fail();
    b.succeed();
    expect(b.tripped()).toBe(false);
    expect(b.consecutive).toBe(0);
  });

  it("trips once the run really is failing", () => {
    const b = wd.makeBreaker();
    for (let i = 0; i < wd.ERROR_LIMIT; i++) b.fail();
    expect(b.tripped()).toBe(true);
  });
});

describe("pacing", () => {
  it("leaves a gap between queries", () => {
    // WDQS throttles on query time per minute, so back-to-back heavy
    // queries are the thing to avoid.
    expect(wd.MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1000);
  });

  it("honours Retry-After when the service asks us to wait", () => {
    expect(wd.retryAfterMs({ get: () => "30" })).toBe(30000);
    expect(wd.retryAfterMs({ get: () => null })).toBe(null);
  });

  it("ignores a nonsense Retry-After rather than sleeping forever", () => {
    expect(wd.retryAfterMs({ get: () => "not-a-number" })).toBe(null);
    expect(wd.retryAfterMs({ get: () => "-5" })).toBe(null);
  });
});

describe("the query", () => {
  it("asks for the artists it was given", () => {
    const q = wd.artistQuery(["Edgar Degas", "Odilon Redon"]);
    expect(q).toContain('"Edgar Degas"@en');
    expect(q).toContain('"Odilon Redon"@en');
  });

  it("escapes a name containing a quote", () => {
    // An unescaped quote produces a malformed query, which WDQS counts as
    // an error against the budget rather than an empty result.
    const q = wd.artistQuery(['Robert "Bob" Smith']);
    expect(q).not.toMatch(/"Robert "Bob" Smith"@en/);
    expect(q).toContain('\\"Bob\\"');
  });

  it("restricts to humans, so a museum or a movement cannot match a name", () => {
    expect(wd.artistQuery(["x"])).toContain("wd:Q5");
  });

  it("asks for the Wikipedia article, which is where the story lives", () => {
    expect(wd.artistQuery(["x"])).toContain("schema:about");
  });
});

describe("matching the RIGHT person", () => {
  // The first full run stored 19 provably wrong people out of 120, since
  // rdfs:label matches any human with that English label and the store
  // kept whichever row came last. A wrong birth year in a caption is
  // worse than no caption, since nothing about it looks wrong.

  it("requires an art occupation", () => {
    // P106 against painter/printmaker/sculptor/photographer/artist.
    const q = wd.artistQuery(["Ma Lin"]);
    expect(q).toContain("wdt:P106");
    expect(q).toMatch(/wd:Q1028181/); // painter
  });

  it("still asks only for humans", () => {
    expect(wd.artistQuery(["x"])).toContain("wd:Q5");
  });
});

describe("ambiguity is recorded, never guessed", () => {
  // Picking one silently is how the wrong biography ends up in a
  // caption; the honest answer is to say which is unknown and let a
  // human resolve it.
  const twoPainters = {
    results: {
      bindings: [
        {
          artist: { value: "http://www.wikidata.org/entity/Q111" },
          artistLabel: { value: "Ma Lin" },
          birth: { value: "1180-01-01T00:00:00Z" },
          artistDescription: { value: "Chinese painter" },
        },
        {
          artist: { value: "http://www.wikidata.org/entity/Q222" },
          artistLabel: { value: "Ma Lin" },
          birth: { value: "1963-01-01T00:00:00Z" },
          artistDescription: { value: "painter" },
        },
      ],
    },
  };

  it("flags a name matching more than one person", () => {
    const [row] = wd.parseArtists(twoPainters);
    expect(row.ambiguous).toBe(true);
  });

  it("keeps every candidate rather than choosing", () => {
    const [row] = wd.parseArtists(twoPainters);
    expect(row.candidates).toHaveLength(2);
    expect(row.candidates.map((c: any) => c.wikidata).sort()).toEqual([
      "http://www.wikidata.org/entity/Q111",
      "http://www.wikidata.org/entity/Q222",
    ]);
  });

  it("does not present facts for an ambiguous name", () => {
    // A record that looks resolved is the dangerous shape.
    const [row] = wd.parseArtists(twoPainters);
    expect(row.birth).toBeUndefined();
  });

  it("leaves an unambiguous match fully resolved", () => {
    const one = {
      results: {
        bindings: [
          {
            artist: { value: "http://www.wikidata.org/entity/Q46373" },
            artistLabel: { value: "Edgar Degas" },
            birth: { value: "1834-07-19T00:00:00Z" },
          },
        ],
      },
    };
    const [row] = wd.parseArtists(one);
    expect(row.ambiguous).toBeFalsy();
    expect(row.birth).toBe("1834");
  });
});

describe("parsing", () => {
  const response = {
    results: {
      bindings: [
        {
          artist: { value: "http://www.wikidata.org/entity/Q46373" },
          artistLabel: { value: "Edgar Degas" },
          birth: { value: "1834-07-19T00:00:00Z" },
          death: { value: "1917-09-27T00:00:00Z" },
          nationalityLabel: { value: "France" },
          movementLabel: { value: "Impressionism" },
          article: { value: "https://en.wikipedia.org/wiki/Edgar_Degas" },
        },
      ],
    },
  };

  it("keeps the citable URLs", () => {
    const [row] = wd.parseArtists(response);
    expect(row.wikidata).toBe("http://www.wikidata.org/entity/Q46373");
    expect(row.article).toBe("https://en.wikipedia.org/wiki/Edgar_Degas");
  });

  it("reduces dates to years, which is what a caption uses", () => {
    const [row] = wd.parseArtists(response);
    expect(row.birth).toBe("1834");
    expect(row.death).toBe("1917");
  });

  it("survives missing optional fields", () => {
    const sparse = {
      results: { bindings: [{ artistLabel: { value: "Unknown" } }] },
    };
    expect(() => wd.parseArtists(sparse)).not.toThrow();
    expect(wd.parseArtists(sparse)[0].birth).toBe(null);
  });

  it("returns nothing for an empty result rather than throwing", () => {
    expect(wd.parseArtists({ results: { bindings: [] } })).toEqual([]);
    expect(wd.parseArtists({})).toEqual([]);
  });
});

describe("multi-valued facts", () => {
  // Wikidata returns one row per combination -- an artist with two
  // nationalities and two movements comes back as four rows. Keying the
  // store by name and letting later rows win once silently discarded the
  // alternatives (Pissarro, Danish-French, kept only France).
  const multi = {
    results: {
      bindings: [
        {
          artist: { value: "http://www.wikidata.org/entity/Q134741" },
          artistLabel: { value: "Camille Pissarro" },
          nationalityLabel: { value: "France" },
          movementLabel: { value: "Impressionism" },
        },
        {
          artist: { value: "http://www.wikidata.org/entity/Q134741" },
          artistLabel: { value: "Camille Pissarro" },
          nationalityLabel: { value: "Denmark" },
          movementLabel: { value: "Impressionism" },
        },
        {
          artist: { value: "http://www.wikidata.org/entity/Q134741" },
          artistLabel: { value: "Camille Pissarro" },
          nationalityLabel: { value: "France" },
          movementLabel: { value: "Neo-Impressionism" },
        },
      ],
    },
  };

  it("collapses repeated rows into one artist", () => {
    expect(wd.parseArtists(multi)).toHaveLength(1);
  });

  it("keeps every distinct nationality", () => {
    const [row] = wd.parseArtists(multi);
    expect(row.nationality.sort()).toEqual(["Denmark", "France"]);
  });

  it("keeps every distinct movement", () => {
    const [row] = wd.parseArtists(multi);
    expect(row.movement.sort()).toEqual(["Impressionism", "Neo-Impressionism"]);
  });

  it("does not repeat a value that appeared in several rows", () => {
    const [row] = wd.parseArtists(multi);
    expect(row.nationality.filter((n: any) => n === "France")).toHaveLength(1);
  });
});

describe("not losing what we fetched", () => {
  it("merges into the existing store instead of replacing it", () => {
    // A run that overwrote the file would throw away every earlier query.
    const existing = { "Edgar Degas": { birth: "1834" } };
    const merged = wd.mergeStore(existing, [
      { name: "Odilon Redon", birth: "1840" },
    ]);
    expect(Object.keys(merged).sort()).toEqual(["Edgar Degas", "Odilon Redon"]);
  });

  it("does not re-ask for a name already stored", () => {
    const existing = { "Edgar Degas": { birth: "1834" } };
    expect(wd.namesToFetch(["Edgar Degas", "Odilon Redon"], existing)).toEqual([
      "Odilon Redon",
    ]);
  });

  it("records a name that returned nothing, so it is not asked forever", () => {
    // A miss is an answer; without this, every run re-queries the same
    // unheard-of artists.
    const merged = wd.mergeStore({}, [], ["Nobody At All"]);
    expect(merged["Nobody At All"]).toMatchObject({ found: false });
    expect(wd.namesToFetch(["Nobody At All"], merged)).toEqual([]);
  });
});
