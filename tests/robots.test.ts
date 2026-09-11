// robots.txt reserves our writing from AI model training. Worth testing a
// static text file since its failure modes are all silent -- a renamed
// token or a stray Allow group changes what's reserved with nothing
// reporting it, and the worst one (a named group re-opening /api/) reads
// like a helpful clarification in a diff.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TXT = readFileSync(path.join(__dirname, "../robots.txt"), "utf8");

// Parse into groups the way a crawler does: consecutive User-agent lines share
// the rules that follow, until the next User-agent line starts a new group.
function parseGroups(text: string) {
  const groups: {
    agents: string[];
    rules: { field: string; value: string }[];
  }[] = [];
  let current: {
    agents: string[];
    rules: { field: string; value: string }[];
  } | null = null;
  let expectingAgents = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [key, ...rest] = line.split(":");
    const field = key.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (field === "user-agent") {
      if (!expectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current!.agents.push(value);
      expectingAgents = true;
    } else if (field === "allow" || field === "disallow") {
      expectingAgents = false;
      if (current) current.rules.push({ field, value });
    }
  }
  return groups;
}

const GROUPS = parseGroups(TXT);
const groupFor = (agent: string) =>
  GROUPS.find((g) =>
    g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()),
  );

const BLOCKED = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "PerplexityBot",
  "Meta-ExternalAgent",
  "Bytespider",
  "cohere-ai",
  "Diffbot",
  "Amazonbot",
  "Google-Extended",
  "Applebot-Extended",
];

// Named in the ticket as deliberately allowed. Each must inherit the `*` group
// rather than have one of its own.
const ALLOWED = [
  "Googlebot",
  "Bingbot",
  "DuckDuckBot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-User",
  "Claude-SearchBot",
  "Perplexity-User",
];

describe("training crawlers are blocked", () => {
  for (const agent of BLOCKED) {
    it(`${agent} is disallowed from everything`, () => {
      const g = groupFor(agent);
      expect(g, `${agent} has no group at all`).toBeTruthy();
      expect(g!.rules).toContainEqual({ field: "disallow", value: "/" });
    });
  }

  it("blocks both of OpenAI's and Anthropic's TRAINING tokens, not their search ones", () => {
    // Getting it backwards would reserve nothing and cost search visibility.
    expect(groupFor("GPTBot")).toBeTruthy();
    expect(groupFor("ClaudeBot")).toBeTruthy();
    expect(groupFor("OAI-SearchBot")).toBeFalsy();
    expect(groupFor("Claude-SearchBot")).toBeFalsy();
  });

  it("keeps the -Extended training directives, which are not duplicate crawlers", () => {
    // Google-Extended/Applebot-Extended fetch nothing -- "do not train on
    // this site" -- while Googlebot/Applebot keep indexing normally.
    expect(groupFor("Google-Extended")).toBeTruthy();
    expect(groupFor("Applebot-Extended")).toBeTruthy();
    expect(groupFor("Googlebot")).toBeFalsy();
    expect(groupFor("Applebot")).toBeFalsy();
  });
});

describe("search and query-time agents stay allowed", () => {
  for (const agent of ALLOWED) {
    it(`${agent} has no group of its own, so it inherits *`, () => {
      // A named group replaces the `*` group rather than adding to it, so
      // one would silently re-open /api/, /img/ and /og/ to it.
      expect(
        groupFor(agent),
        `${agent} has its own group; it would stop inheriting the * disallows`,
      ).toBeFalsy();
    });
  }
});

describe("the wildcard group still protects the internal endpoints", () => {
  it("allows the site and disallows the three internal paths", () => {
    const star = groupFor("*");
    expect(star).toBeTruthy();
    expect(star!.rules).toContainEqual({ field: "allow", value: "/" });
    for (const p of ["/api/", "/img/", "/og/"]) {
      expect(star!.rules, `${p} must stay disallowed`).toContainEqual({
        field: "disallow",
        value: p,
      });
    }
  });

  it("never disallows / for everyone", () => {
    const star = groupFor("*");
    expect(star!.rules).not.toContainEqual({ field: "disallow", value: "/" });
  });
});

describe("the file itself", () => {
  it("points at a sitemap on the real domain", () => {
    expect(TXT).toMatch(/^Sitemap: https:\/\/tranquilo\.art\/sitemap\.xml$/m);
  });

  it("says what is NOT reserved", () => {
    // The artwork is public domain/openly licensed and we want it spread.
    expect(TXT).toMatch(/NOT reserved: the artwork/);
  });

  it("has no duplicate user-agent groups", () => {
    // Two groups for one agent means the second is ignored.
    const seen = GROUPS.flatMap((g) => g.agents.map((a) => a.toLowerCase()));
    expect(new Set(seen).size).toBe(seen.length);
  });
});
