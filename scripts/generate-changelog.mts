// Generates a changelog entry from git history between two version tags.
// Default is the two most recent vX.Y.Z tags -- what running this right
// after a bump-version.mts + `git tag` actually wants. Prepends to
// CHANGELOG.md rather than overwriting it.
//
// Commits are grouped by the [major]/[minor]/[patch]/[hotfix] tag in their
// subject line, the same tags bump-version.mts reads (see CLAUDE.md's
// Versioning section). A commit with no such tag lands in "Other" rather
// than being dropped.
//
// Usage:
//   bun run changelog                    # between the two most recent v* tags
//   bun run changelog --to HEAD          # everything since the latest tag, unreleased
//   bun run changelog --from v1.0.0 --to v1.1.0
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CHANGELOG_PATH = path.join(ROOT, "CHANGELOG.md");

type BumpType = "major" | "minor" | "patch" | "hotfix";
type Section = BumpType | "other";
const SECTION_ORDER: Section[] = ["major", "minor", "patch", "hotfix", "other"];
const SECTION_TITLE: Record<Section, string> = {
  major: "Major",
  minor: "Minor",
  patch: "Patch",
  hotfix: "Hotfixes",
  other: "Other",
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function versionTags(): string[] {
  return git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .filter(Boolean);
}

function parseArgs(argv: string[]): { from: string; to: string } {
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") from = argv[++i];
    else if (argv[i] === "--to") to = argv[++i];
  }

  const tags = versionTags();
  if (to == null) to = tags[0] ?? "HEAD";
  if (from == null) {
    // The tag right before `to` in the sorted list when `to` is itself a
    // real tag; otherwise (to === HEAD, an unreleased entry) the latest tag.
    const idx = tags.indexOf(to);
    from = idx >= 0 ? tags[idx + 1] : tags[0];
  }
  if (!from) {
    throw new Error(
      "No previous vX.Y.Z tag to diff against. Pass --from explicitly, " +
        "or tag a starting point first.",
    );
  }
  return { from, to };
}

interface Entry {
  section: Section;
  subject: string;
  hash: string;
}

// Strips every leading [tag] group so the rendered line reads as plain
// prose, not a wall of brackets -- the tags did their job picking a section.
function stripLeadingTags(subject: string): string {
  let s = subject;
  while (/^\[[^\]]+\]\s*/.test(s)) s = s.replace(/^\[[^\]]+\]\s*/, "");
  return s;
}

function collectEntries(from: string, to: string): Entry[] {
  const log = git(["log", `${from}..${to}`, "--format=%h|%s"]);
  const entries: Entry[] = [];
  for (const line of log.split("\n")) {
    if (!line) continue;
    const sep = line.indexOf("|");
    const hash = line.slice(0, sep);
    const subject = line.slice(sep + 1);
    const match = /\[(major|minor|patch|hotfix)\]/i.exec(subject);
    const section = (match?.[1].toLowerCase() as BumpType) || "other";
    entries.push({ section, subject: stripLeadingTags(subject), hash });
  }
  return entries;
}

function renderBody(entries: Entry[]): string {
  const bySection = new Map<Section, Entry[]>();
  for (const entry of entries) {
    if (!bySection.has(entry.section)) bySection.set(entry.section, []);
    bySection.get(entry.section)!.push(entry);
  }

  const parts: string[] = [];
  for (const section of SECTION_ORDER) {
    const group = bySection.get(section);
    if (!group?.length) continue;
    parts.push(`### ${SECTION_TITLE[section]}\n`);
    for (const entry of group) parts.push(`- ${entry.subject} (${entry.hash})`);
    parts.push("");
  }
  return parts.join("\n");
}

function prepend(newSection: string) {
  const existing = fs.existsSync(CHANGELOG_PATH)
    ? fs.readFileSync(CHANGELOG_PATH, "utf8")
    : "";
  const hasHeader = existing.startsWith("# ");
  const header = hasHeader
    ? `${existing.split("\n")[0]}\n\n`
    : "# Changelog\n\n";
  const rest = hasHeader
    ? existing.slice(existing.indexOf("\n") + 1).replace(/^\n+/, "")
    : existing;
  fs.writeFileSync(CHANGELOG_PATH, `${header}${newSection}\n${rest}`);
}

function main() {
  const { from, to } = parseArgs(process.argv.slice(2));
  const entries = collectEntries(from, to);
  if (entries.length === 0) {
    console.log(`No commits between ${from} and ${to} -- nothing to add.`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const heading =
    to === "HEAD" ? "## Unreleased\n\n" : `## ${to} - ${today}\n\n`;
  prepend(`${heading}${renderBody(entries)}`);

  console.log(
    `changelog: added ${entries.length} commit(s) from ${from}..${to} to ${CHANGELOG_PATH}`,
  );
}

main();
