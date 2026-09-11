// Renders the root config.toml into the two generated files app.ts and
// the /api + lib/ Node functions actually consume -- see config.toml's
// own header comment for the full design. Both outputs are gitignored
// build artifacts, regenerated here rather than hand-edited; `bun run
// build`/`typecheck` all run this first (package.json), and it's also
// its own `bun run generate-config`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseToml } from "../lib/toml.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CONFIG_TOML_PATH = path.join(ROOT, "config.toml");
const BROWSER_OUTPUT_PATH = path.join(
  ROOT,
  "src",
  "data",
  "config.generated.ts",
);
const NODE_OUTPUT_PATH = path.join(ROOT, "lib", "config.generated.ts");

const BANNER =
  "// GENERATED FILE -- do not edit directly.\n" +
  "// Source: config.toml. Regenerate with `bun run generate-config`.\n\n";

function main() {
  const source = fs.readFileSync(CONFIG_TOML_PATH, "utf8");
  const config = parseToml(source);
  const serialized = JSON.stringify(config, null, 2);

  // A real ES module, imported directly by app.js and every other browser
  // consumer.
  fs.writeFileSync(
    BROWSER_OUTPUT_PATH,
    `${BANNER}export const TRANQUILO_CONFIG = ${serialized} as const;\n`,
  );

  // A real ES module, imported by /api and lib/ files -- Vercel's own
  // function bundler traces and inlines it at build time (same mechanism
  // lib/sentry.ts's header comment describes), so the deployed function
  // never reads config.toml or this file at request time.
  fs.writeFileSync(
    NODE_OUTPUT_PATH,
    `${BANNER}export const TRANQUILO_CONFIG = ${serialized};\n`,
  );

  console.log(
    `generate-config: wrote ${path.relative(ROOT, BROWSER_OUTPUT_PATH)} and ${path.relative(ROOT, NODE_OUTPUT_PATH)}`,
  );
}

main();
