// The AI disclosure is a fixed string. Nothing may append to it.
//
// It has previously grown to include a storyline's `source_note` on the
// reasoning that "the disclosure and 'where did this come from' are the same
// question asked twice". They are not. The disclosure is a statement about
// HOW THE TEXT WAS PRODUCED and it backs a claim in the ToS about human
// editorial review. A curator's working notes are a different thing wearing
// the same badge, and appending them buries the sentence that has to be read.
//
// This was not a one-off: several storylines carry a source_note, some far
// longer than the disclosure itself. Trimming any single note would have
// left the rest.
//
// The disclosure is a static string and does not change without approval.
// These tests exist so that rule is enforced by something other than memory.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Each renderer (TranquiloDetailModal.ts for an item's Tea caption,
// TranquiloStorylineMode.ts for a storyline's intro caption) carries its own
// copy of the disclosure markup.
const FILES = [
  "../src/components/TranquiloDetailModal.ts",
  "../src/components/TranquiloStorylineMode.ts",
];
const sources = FILES.map((f) =>
  readFileSync(new URL(f, import.meta.url), "utf8"),
);

describe("the AI disclosure is immutable", () => {
  it("still carries the exact approved wording", () => {
    for (const src of sources) {
      expect(src).toContain(
        "Drafted with AI help; edited and reviewed by a person. ",
      );
    }
  });

  it("still ends at the corrections email", () => {
    for (const src of sources) {
      expect(src).toContain('Spotted an error? <a href="mailto:');
    }
  });

  it("has no builder that varies the disclosure per caller", () => {
    // The specific mechanism that leaked. A function taking an argument and
    // returning a disclosure is the shape of the bug, whatever it is named.
    for (const src of sources) {
      expect(src).not.toMatch(/function aiDisclosureHtml/);
    }
  });

  it("is never string-surgeried", () => {
    // `AI_DISCLOSURE_HTML.replace('</span>', ...)` is how the note was
    // injected: it reopened a closed element and appended inside it.
    for (const src of sources) {
      expect(src).not.toMatch(/AI_DISCLOSURE_HTML\s*\.\s*(replace|concat)/);
    }
  });

  it("is emitted as one closed unit, with no injection point", () => {
    // Placing the constant into surrounding markup (`AI_DISCLOSURE_HTML +
    // '</p>'`) is ordinary templating and must stay allowed -- the constant
    // has to be usable. What is forbidden is reopening it and writing inside,
    // which is what the leak did by replacing its closing tag.
    for (const src of sources) {
      expect(src).not.toMatch(
        /AI_DISCLOSURE_HTML[\s\S]{0,40}['"`]<\/span>['"`]/,
      );
    }
  });

  it("does not render a storyline's source_note anywhere", () => {
    // source_note stays in the storylines table (sql/019_storylines.sql) as
    // the curatorial record -- the integrity checker requires one on every
    // narrative storyline -- but it is an internal provenance note, not
    // product copy.
    // Property ACCESS, not the word: this file documents the incident in
    // prose above, and banning the substring would forbid explaining it.
    for (const src of sources) {
      expect(src).not.toMatch(/\.\s*source_note/);
      expect(src).not.toMatch(/\bstoryline\.source_note\b/);
      expect(src).not.toContain("How this connection was verified");
    }
  });
});
