// Turns coverage/coverage-summary.json (bun run test:coverage's json-summary
// reporter) into a shields.io endpoint badge JSON, committed to
// badges/coverage.json and read by the README's badge via the raw GitHub
// URL. Labelled "vitest coverage", not "test coverage": this measures only
// the offline Vitest suite (api/, lib/, src/, scripts/) -- the DOM-bound
// custom elements under src/components/ and src/pages/ are exercised by the
// separate ~277-test Playwright e2e suite instead, which this number does
// not include.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SUMMARY_PATH = path.join(ROOT, "coverage", "coverage-summary.json");
const BADGE_PATH = path.join(ROOT, "badges", "coverage.json");

if (!fs.existsSync(SUMMARY_PATH)) {
  console.error(
    `${SUMMARY_PATH} not found -- run \`bun run test:coverage\` first.`,
  );
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
const pct = summary.total.lines.pct as number;

function colorFor(p: number): string {
  if (p >= 80) return "brightgreen";
  if (p >= 60) return "green";
  if (p >= 40) return "yellow";
  if (p >= 20) return "orange";
  return "red";
}

const badge = {
  schemaVersion: 1,
  label: "vitest coverage",
  message: `${pct.toFixed(1)}%`,
  color: colorFor(pct),
};

fs.mkdirSync(path.dirname(BADGE_PATH), { recursive: true });
fs.writeFileSync(BADGE_PATH, `${JSON.stringify(badge, null, 2)}\n`);
console.log(`Wrote ${BADGE_PATH}:`, badge);
