// Bumps the app's single SemVer version: package.json's "version", mirrored
// into api/openapi.yaml's info.version so the two never drift (see
// CLAUDE.md's Versioning section).
//
// With no argument, the bump type is inferred from commit subjects since
// the last vX.Y.Z tag: highest-precedence tag wins among
// [major]/[minor]/[patch]/[hotfix]. hotfix bumps the same digit as patch
// (SemVer has no fourth slot) but stays its own tag so an emergency fix
// reads differently in the log and changelog.
//
// Only edits the two files and prints what to run next -- never commits or
// tags on its own, so the bump is always reviewed first.
//
// Usage:
//   bun run version:bump                  # infer bump type from commits since the last tag
//   bun run version:bump patch
//   bun run version:bump minor
//   bun run version:bump major
//   bun run version:bump hotfix
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const OPENAPI_PATH = path.join(ROOT, "api", "openapi.yaml");

type BumpType = "major" | "minor" | "patch" | "hotfix";
const BUMP_TYPES: BumpType[] = ["major", "minor", "patch", "hotfix"];
// Highest-precedence tag wins when more than one shows up since the last tag.
const PRECEDENCE: BumpType[] = ["major", "minor", "patch", "hotfix"];

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function currentVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8"));
  if (!pkg.version)
    throw new Error(`${PACKAGE_JSON_PATH} has no "version" field`);
  return pkg.version as string;
}

function lastVersionTag(): string | null {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"]);
  return tags.split("\n").filter(Boolean)[0] ?? null;
}

function inferBumpType(): BumpType {
  const lastTag = lastVersionTag();
  const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
  const subjects = git(["log", range, "--format=%s"])
    .split("\n")
    .filter(Boolean);

  const found = new Set<BumpType>();
  for (const subject of subjects) {
    for (const type of BUMP_TYPES) {
      if (subject.toLowerCase().includes(`[${type}]`)) found.add(type);
    }
  }
  for (const type of PRECEDENCE) {
    if (found.has(type)) return type;
  }
  throw new Error(
    `No [major]/[minor]/[patch]/[hotfix] tag found in any commit since ` +
      `${lastTag ?? "the beginning of history"}. Pass a bump type explicitly: ` +
      `bun run version:bump <major|minor|patch|hotfix>`,
  );
}

function bump(version: string, type: BumpType): string {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`"${version}" is not a plain X.Y.Z semver string`);
  }
  const [major, minor, patch] = parts;
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  // "patch" and "hotfix" bump the same digit -- see header comment.
  return `${major}.${minor}.${patch + 1}`;
}

function writePackageJsonVersion(version: string) {
  const raw = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
  const updated = raw.replace(
    /"version":\s*"[^"]*"/,
    `"version": "${version}"`,
  );
  if (!/"version":\s*"[^"]*"/.test(raw)) {
    throw new Error(
      `could not find a "version" field to update in ${PACKAGE_JSON_PATH}`,
    );
  }
  fs.writeFileSync(PACKAGE_JSON_PATH, updated);
}

function writeOpenapiVersion(version: string) {
  const raw = fs.readFileSync(OPENAPI_PATH, "utf8");
  const updated = raw.replace(/version:\s*"[^"]*"/, `version: "${version}"`);
  fs.writeFileSync(OPENAPI_PATH, updated);
}

function main() {
  const arg = process.argv[2];
  if (arg && !BUMP_TYPES.includes(arg as BumpType)) {
    console.error(`usage: bun run version:bump [${BUMP_TYPES.join("|")}]`);
    process.exit(1);
  }
  const type = (arg as BumpType) || inferBumpType();
  const current = currentVersion();
  const next = bump(current, type);

  writePackageJsonVersion(next);
  writeOpenapiVersion(next);

  console.log(`version: ${current} -> ${next} (${type})`);
  console.log(`Review the diff, then commit and tag it yourself, e.g.:`);
  console.log(`  git add package.json api/openapi.yaml`);
  console.log(`  git commit -m "[${type}] Bump version to ${next}"`);
  console.log(`  git tag v${next}`);
}

main();
