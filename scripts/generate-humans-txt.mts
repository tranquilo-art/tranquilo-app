// Regenerates humans.txt (https://humanstxt.org/) from git history itself
// rather than a hand-maintained list that silently drifts. Run: `bun run
// humans`, or `node scripts/generate-humans-txt.mts` directly.
//
// Contributors are derived from `git log`, deduped by lowercased email
// (the same person has committed under two capitalizations here) and
// ordered by earliest commit, which needs no bookkeeping to stay correct.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "public", "humans.txt");

interface Contributor {
  email: string;
  name: string;
  firstCommitDate: string;
}

function getContributors(): Contributor[] {
  // --reverse walks oldest-first, so the first line seen for a given
  // (lowercased) email is that contributor's earliest commit.
  const log = execFileSync(
    "git",
    ["log", "--format=%ae|%an|%ad", "--date=format:%Y-%m-%d", "--reverse"],
    { cwd: ROOT, encoding: "utf8" },
  );

  const seen = new Set<string>();
  const contributors: Contributor[] = [];
  for (const line of log.split("\n")) {
    if (!line) continue;
    const [email, name, firstCommitDate] = line.split("|");
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contributors.push({ email, name, firstCommitDate });
  }
  return contributors;
}

// Known-AI committer emails get an honest label rather than being folded
// in as an unlabelled "team member" -- humans.txt exists so a visitor
// knows who actually built the thing, and that includes how.
const AI_EMAILS = new Set(["noreply@anthropic.com"]);

function roleFor(contributor: Contributor): string {
  return AI_EMAILS.has(contributor.email.toLowerCase())
    ? "AI pair programmer"
    : "Development";
}

function buildHumansTxt(contributors: Contributor[]): string {
  const team = contributors
    .map(
      (c) =>
        `    ${roleFor(c)}: ${c.name}\n    Contact: ${c.email}\n    From: ${c.firstCommitDate}\n`,
    )
    .join("\n");

  const today = new Date().toISOString().slice(0, 10);

  return `/* TEAM */

${team}
/* THANKS */

    The Metropolitan Museum of Art, Smithsonian Open Access, Cleveland
    Museum of Art, Wikimedia Commons and Europeana -- for making their
    collections available under open licenses in the first place.

/* SITE */

    Last update: ${today}
    Language: English
    Standards: HTML5, CSS3
    Components: TypeScript, Vite, Prisma (migrations only), Neon Postgres
    Software: bun, Biome, Vitest, Playwright, Vercel

/* This file is generated -- edit scripts/generate-humans-txt.mts, not
   this file directly. Regenerate with \`bun run humans\`. */
`;
}

function main() {
  const contributors = getContributors();
  const content = buildHumansTxt(contributors);
  fs.writeFileSync(OUTPUT_PATH, content);
  console.log(
    `generate-humans-txt: wrote ${OUTPUT_PATH} (${contributors.length} contributor(s))`,
  );
}

main();
