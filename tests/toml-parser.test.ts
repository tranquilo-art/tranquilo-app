// lib/toml.ts is a deliberately minimal parser -- config.toml is read
// once and trusted from then on, so a wrong parse here would silently
// mis-tune caching/eviction/feed behavior rather than throw somewhere obvious.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseToml } from "../lib/toml.ts";

describe("parseToml", () => {
  it("parses sections, integers, floats, strings and booleans", () => {
    const doc = parseToml(`
[rate_limiting]
default_min_request_interval_seconds = 2.0
low_watermark = 20
label = "hello"
enabled = true
disabled = false
`);
    expect(doc.rate_limiting).toEqual({
      default_min_request_interval_seconds: 2.0,
      low_watermark: 20,
      label: "hello",
      enabled: true,
      disabled: false,
    });
  });

  it("ignores comments and blank lines", () => {
    const doc = parseToml(`
# a leading comment

[a]
# a comment inside a section
x = 1

y = 2
`);
    expect(doc.a).toEqual({ x: 1, y: 2 });
  });

  it("strips a trailing comment on a key = value line", () => {
    const doc = parseToml(`[a]\nx = 1 # inline comment`);
    expect(doc.a).toEqual({ x: 1 });
  });

  it("does not treat a # inside a quoted string as a comment", () => {
    const doc = parseToml(`[a]\nx = "value # not a comment"`);
    expect(doc.a).toEqual({ x: "value # not a comment" });
  });

  it('supports \\" \\\\ \\n \\t escapes in strings', () => {
    const doc = parseToml(`[a]\nx = "a\\"b\\\\c\\nd\\te"`);
    expect(doc.a.x).toBe('a"b\\c\nd\te');
  });

  it("handles negative integers and floats", () => {
    const doc = parseToml(`[a]\nx = -5\ny = -1.5`);
    expect(doc.a).toEqual({ x: -5, y: -1.5 });
  });

  it("supports multiple sections", () => {
    const doc = parseToml(`[a]\nx = 1\n[b]\ny = 2`);
    expect(doc).toEqual({ a: { x: 1 }, b: { y: 2 } });
  });

  it("round-trips this repo's real config.toml", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "..", "config.toml"),
      "utf8",
    );
    const doc = parseToml(source);
    expect(doc.feed.page_size).toBe(60);
    expect(doc.feed.prefetch_slides).toBe(20);
    expect(doc.collection.upsell_min_saved).toBe(3);
    // bust_version is bumped by hand on an unrelated schedule.
    expect(typeof doc.cache.bust_version).toBe("number");
  });

  it("throws on a key = value line before any [section]", () => {
    expect(() => parseToml("x = 1")).toThrow(/before any \[section\]/);
  });

  it("throws on an unparseable line", () => {
    expect(() => parseToml("[a]\nnot a key value line")).toThrow(
      /isn't a \[section\]/,
    );
  });

  it("throws on an unsupported value shape", () => {
    expect(() => parseToml("[a]\nx = [1, 2, 3]")).toThrow(/unsupported value/);
  });
});
