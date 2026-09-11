// Runs only the e2e specs relevant to what actually changed, for fast
// local/PR iteration. CI still runs the full suite unmodified as the merge
// gate -- this is a faster first signal, not a replacement for it.
//
// Diffs against a base ref (origin/main by default), maps each changed path
// to the e2e spec group(s) it can plausibly affect, and runs playwright
// against the union. An unrecognized path, or one shared widely enough that
// scoping it down would be guessing, falls back to the full suite -- prefer
// a slow correct run over a fast wrong one.
//
// Run:  node scripts/select_e2e_specs.mts
//       node scripts/select_e2e_specs.mts --base main
//       node scripts/select_e2e_specs.mts --dry-run   (print the plan, don't run)
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Every e2e spec file, grouped by the feature area it exercises. Kept as an
// explicit list (not derived by scanning tests/e2e/) so adding a new spec
// forces a decision about which group it belongs to, rather than silently
// landing nowhere.
const GROUPS: Record<string, string[]> = {
  topbar: [
    "chips-reachable.spec.mts",
    "topbar-icon-cluster.spec.mts",
    "discover-home-link.spec.mts",
  ],
  search: ["search-filter.spec.mts", "search-status-in-header.spec.mts"],
  collection: [
    "collection-keys.spec.mts",
    "collect-export.spec.mts",
    "upsell-gating.spec.mts",
  ],
  storyline: [
    "storyline-arrows.spec.mts",
    "storyline-disclosure.spec.mts",
    "storyline-filter.spec.mts",
    "storyline-navigation.spec.mts",
    "storyline-share.spec.mts",
    "storylines-shelves.spec.mts",
  ],
  feed: [
    "journeys.spec.mts",
    "paging.spec.mts",
    "smoke.spec.mts",
    "urls.spec.mts",
    "image-failure.spec.mts",
  ],
  lightbox: ["lightbox-source-link.spec.mts", "link-underlines.spec.mts"],
  detail: ["ai-disclosure.spec.mts", "tea-sources.spec.mts"],
  pages: [
    "support-strip.spec.mts",
    "legal-pages.spec.mts",
    "nav-links.spec.mts",
    "feedback-page.spec.mts",
  ],
  misc: ["share.spec.mts", "no-analytics.spec.mts"],
};

// Ordered path -> group(s) rules, checked with String.prototype.startsWith.
// First match wins per changed file; a file can only widen the run (adding
// groups), never narrow it.
interface PathRule {
  prefix: string;
  groups: string[] | null;
  singleSpec?: boolean;
}

const PATH_RULES: PathRule[] = [
  { prefix: "src/components/TranquiloTopbar.ts", groups: ["topbar"] },
  { prefix: "src/components/TranquiloMusicToggle.ts", groups: ["topbar"] },
  { prefix: "src/types/ITopbarHost.ts", groups: ["topbar"] },
  { prefix: "src/components/TranquiloSearchBar.ts", groups: ["search"] },
  { prefix: "src/components/TranquiloFeed.ts", groups: ["feed"] },
  { prefix: "src/types/ITranquiloFeedHost.ts", groups: ["feed"] },
  { prefix: "src/types/SlideRecord.ts", groups: ["feed"] },
  { prefix: "src/feed/", groups: ["feed"] },
  { prefix: "src/components/TranquiloLightbox.ts", groups: ["lightbox"] },
  { prefix: "src/types/ITranquiloLightboxHost.ts", groups: ["lightbox"] },
  // detail+storyline, not just detail: the two reach into each other via
  // the storyline-handoff-open/-restore events, and
  // storyline-navigation.spec.mts (the "storyline" group) exercises that
  // handoff through this component's own code too.
  {
    prefix: "src/components/TranquiloDetailModal.ts",
    groups: ["detail", "storyline"],
  },
  {
    prefix: "src/types/ITranquiloDetailModalHost.ts",
    groups: ["detail", "storyline"],
  },
  { prefix: "src/components/TranquiloStorylineMode.ts", groups: ["storyline"] },
  {
    prefix: "src/types/ITranquiloStorylineModeHost.ts",
    groups: ["storyline"],
  },
  // storylines-shelves.spec.mts (Shelves half) lives in the "storyline"
  // group -- there's no dedicated "shelves" group.
  { prefix: "src/components/TranquiloShelvesMode.ts", groups: ["storyline"] },
  { prefix: "src/types/ITranquiloShelvesModeHost.ts", groups: ["storyline"] },
  { prefix: "src/types/Shelf.ts", groups: ["storyline"] },
  { prefix: "src/enums/ShelfType.ts", groups: ["storyline"] },
  { prefix: "src/components/TranquiloSupportStrip.ts", groups: ["pages"] },
  { prefix: "src/data/storylines.ts", groups: ["storyline"] },
  { prefix: "src/data/shelves.ts", groups: ["storyline"] },
  // collect-export.spec.mts and upsell-gating.spec.mts (the "collection"
  // group) are these two components' only e2e coverage.
  { prefix: "src/components/TranquiloExportModal.ts", groups: ["collection"] },
  {
    prefix: "src/types/ITranquiloExportModalHost.ts",
    groups: ["collection"],
  },
  { prefix: "src/components/TranquiloUpsellToast.ts", groups: ["collection"] },
  // A spec file changing affects only itself, not its whole group -- find
  // which group owns it and run just that file, not its siblings.
  { prefix: "tests/e2e/", groups: null, singleSpec: true },
];

// Anything matching one of these (or nothing above matching at all) means
// "don't guess" -- run everything. These are the files wide enough that a
// change to any of them can plausibly touch every spec.
const RUN_EVERYTHING_PREFIXES = [
  "src/app.ts",
  "src/logic/logic.ts",
  "src/utils/on.ts",
  "src/types/Item.ts",
  "tests/e2e/harness.mts",
  "css/style.css",
  "css/tokens.css",
  "index.html",
  "playwright.config.mts",
];

function resolveBase(explicitBase: string | null) {
  if (explicitBase) return explicitBase;
  for (const candidate of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", candidate], {
        cwd: ROOT,
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  return "HEAD~1";
}

function changedFiles(base: string) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  // Uncommitted work-in-progress matters just as much as committed diff --
  // this is meant to run mid-iteration, not just pre-push.
  const uncommitted = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  return [...new Set([...out.split("\n").filter(Boolean), ...uncommitted])];
}

type Plan =
  | { runAll: true; reason: string }
  | { runAll: false; specs: string[] };

function planFor(files: string[]): Plan {
  if (!files.length)
    return { runAll: true, reason: "no changed files detected" };

  const groups = new Set<string>();
  const singleSpecs = new Set<string>();

  for (const file of files) {
    if (RUN_EVERYTHING_PREFIXES.some((p) => file.startsWith(p))) {
      return { runAll: true, reason: `${file} affects too much to scope down` };
    }

    const rule = PATH_RULES.find((r) => file.startsWith(r.prefix));
    if (!rule) {
      return { runAll: true, reason: `${file} isn't a recognized path` };
    }

    if (rule.singleSpec) {
      const basename = path.basename(file);
      if (!basename.endsWith(".spec.mts")) continue; // e.g. harness.mts, handled above
      singleSpecs.add(basename);
      continue;
    }
    // Every rule that isn't singleSpec carries a real groups array -- only
    // the tests/e2e/ singleSpec rule above has groups: null, and that branch
    // already continued past this point.
    rule.groups?.forEach((g) => {
      groups.add(g);
    });
  }

  const specs = new Set(singleSpecs);
  for (const group of groups) {
    for (const basename of GROUPS[group]) specs.add(basename);
  }
  return { runAll: false, specs: [...specs] };
}

function runSpecs(basenames: string[]) {
  const result = spawnSync(
    "bunx",
    ["playwright", "test", ...basenames.map((s) => `tests/e2e/${s}`)],
    { cwd: ROOT, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

function runAll() {
  const result = spawnSync("bunx", ["playwright", "test"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  // `--group <name>` bypasses the git diff entirely -- this is what the
  // package.json test:e2e:<group> aliases call, so GROUPS above stays the
  // one place that lists each group's spec files.
  const groupIdx = args.indexOf("--group");
  if (groupIdx !== -1) {
    const name = args[groupIdx + 1];
    const specs = GROUPS[name];
    if (!specs) {
      console.error(
        `select_e2e_specs: unknown group "${name}". Known groups: ${Object.keys(GROUPS).join(", ")}`,
      );
      process.exit(1);
    }
    console.log(
      `select_e2e_specs: running the "${name}" group (${specs.length} spec file(s)).`,
    );
    if (dryRun) return;
    runSpecs(specs);
    return;
  }

  const baseIdx = args.indexOf("--base");
  const explicitBase = baseIdx !== -1 ? args[baseIdx + 1] : null;

  const base = resolveBase(explicitBase);
  const files = changedFiles(base);
  const plan = planFor(files);

  if (plan.runAll) {
    console.log(`select_e2e_specs: running the FULL suite (${plan.reason}).`);
    if (dryRun) return;
    runAll();
    return;
  }

  if (!plan.specs.length) {
    console.log(
      "select_e2e_specs: changed files don't touch anything e2e-relevant -- skipping.",
    );
    return;
  }

  console.log(
    `select_e2e_specs: running ${plan.specs.length} spec file(s) against ${base}:\n${plan.specs
      .map((s) => `  tests/e2e/${s}`)
      .join("\n")}`,
  );
  if (dryRun) return;
  runSpecs(plan.specs);
}

main();
