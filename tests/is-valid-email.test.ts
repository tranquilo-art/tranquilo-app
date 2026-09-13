import { describe, expect, it } from "vitest";
import { isValidEmail } from "../lib/is-valid-email.ts";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last@example.com")).toBe(true);
    expect(isValidEmail("a+tag@sub.example.com")).toBe(true);
  });

  it("rejects the obvious malformed shapes", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at-sign.com")).toBe(false);
    expect(isValidEmail("@no-local.com")).toBe(false);
    expect(isValidEmail("no-domain@")).toBe(false);
    expect(isValidEmail("no-dot@domain")).toBe(false);
    expect(isValidEmail("two@at@signs.com")).toBe(false);
    expect(isValidEmail("trailing.dot@domain.")).toBe(false);
    expect(isValidEmail("has space@domain.com")).toBe(false);
    expect(isValidEmail("local@has space.com")).toBe(false);
  });

  it("rejects non-string input rather than throwing", () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail(42)).toBe(false);
    expect(isValidEmail({})).toBe(false);
  });

  // The previous implementation, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, let both
  // [^\s@]+ groups absorb "." (CodeQL js/polynomial-redos): a run of "."s
  // followed by a character the pattern can never match forced exponential
  // backtracking. This is the exact shape CodeQL's alert cited -- it must
  // return, and stay false, in well under a second rather than hang.
  it("resolves the ReDoS-shaped input instantly instead of hanging", () => {
    const evil = `!@!${".!".repeat(50000)}\n`;
    const start = performance.now();
    const result = isValidEmail(evil);
    const elapsedMs = performance.now() - start;
    expect(result).toBe(false);
    expect(elapsedMs).toBeLessThan(50);
  });
});
