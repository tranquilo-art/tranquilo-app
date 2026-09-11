// A deliberately minimal TOML parser -- Bun imports .toml natively but
// Vercel's Node function runtime doesn't, and config.toml is also read by a
// build-time script that has to run under plain `node`. config.toml's shape
// is entirely flat `[section]` tables of number/string/boolean values, so a
// full TOML implementation would be near-total dead code.
//
// Supports exactly: comments, blank lines, one level of `[section]`
// headers, and `key = value` where value is an integer, a float, a
// double-quoted string (with \" \\ \n \t escapes), or true/false. Anything
// else throws rather than silently mis-parsing.

type TomlValue = number | string | boolean;
type TomlTable = Record<string, TomlValue>;
type TomlDocument = Record<string, TomlTable>;

const SECTION_RE = /^\[([A-Za-z0-9_.-]+)\]$/;
const KEY_VALUE_RE = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/;

function stripComment(line: string): string {
  // A `#` inside a double-quoted string must not end the line early; walking
  // char-by-char since the escape rules aren't expressible as a regex lookbehind.
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && inString) {
      i++; // skip the escaped character
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (ch === "#" && !inString) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(raw: string, context: string): TomlValue {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    let out = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === "\\") {
        const next = inner[i + 1];
        if (next === "n") {
          out += "\n";
          i++;
          continue;
        }
        if (next === "t") {
          out += "\t";
          i++;
          continue;
        }
        if (next === '"') {
          out += '"';
          i++;
          continue;
        }
        if (next === "\\") {
          out += "\\";
          i++;
          continue;
        }
        throw new Error(`toml: unsupported escape "\\${next}" in ${context}`);
      }
      out += ch;
    }
    return out;
  }
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  throw new Error(
    `toml: unsupported value "${raw}" in ${context} -- only integers, floats, "double-quoted strings" and true/false are supported`,
  );
}

function parseToml(source: string): TomlDocument {
  const doc: TomlDocument = {};
  let currentSection: string | null = null;
  const lines = source.split("\n");

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = stripComment(lines[lineNo]).trim();
    if (!raw) continue;

    const sectionMatch = SECTION_RE.exec(raw);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!doc[currentSection]) doc[currentSection] = {};
      continue;
    }

    const kvMatch = KEY_VALUE_RE.exec(raw);
    if (!kvMatch) {
      throw new Error(
        `toml: line ${lineNo + 1} isn't a [section], a key = value pair, or a comment: "${lines[lineNo]}"`,
      );
    }
    if (!currentSection) {
      throw new Error(
        `toml: line ${lineNo + 1} sets "${kvMatch[1]}" before any [section] header`,
      );
    }
    const [, key, valueRaw] = kvMatch;
    doc[currentSection][key] = parseValue(
      valueRaw,
      `${currentSection}.${key} (line ${lineNo + 1})`,
    );
  }

  return doc;
}

export { parseToml };
