import { afterEach, describe, expect, it, vi } from "vitest";
import { visitorKey } from "../lib/visitor-hash.ts";

const DAY = new Date("2026-11-03T10:00:00Z");

describe("visitorKey", () => {
  it("is stable for one address within a day", () => {
    const later = new Date("2026-11-03T23:59:00Z");
    expect(visitorKey("203.0.113.7", "s", DAY)).toBe(
      visitorKey("203.0.113.7", "s", later),
    );
  });

  it("cannot be linked across days", () => {
    const next = new Date("2026-11-04T00:01:00Z");
    expect(visitorKey("203.0.113.7", "s", DAY)).not.toBe(
      visitorKey("203.0.113.7", "s", next),
    );
  });

  it("separates addresses and secrets", () => {
    const base = visitorKey("203.0.113.7", "s", DAY);
    expect(visitorKey("203.0.113.8", "s", DAY)).not.toBe(base);
    expect(visitorKey("203.0.113.7", "other", DAY)).not.toBe(base);
  });

  it("does not contain the address", () => {
    expect(visitorKey("203.0.113.7", "s", DAY)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns null when there is nothing safe to hash with", () => {
    expect(visitorKey("203.0.113.7", undefined, DAY)).toBeNull();
    expect(visitorKey(null, "s", DAY)).toBeNull();
  });
});

describe("visitorKey without a secret", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it("falls back to a deterministic unkeyed hash on AWS", () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = visitorKey("203.0.113.7", undefined, DAY);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(visitorKey("203.0.113.7", undefined, DAY)).toBe(key);
    expect(visitorKey("203.0.113.8", undefined, DAY)).not.toBe(key);
    expect(key).not.toBe(visitorKey("203.0.113.7", "s", DAY));
  });

  it("falls back in a production environment", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.VERCEL_ENV = "production";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(visitorKey("203.0.113.7", undefined, DAY)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("warns exactly once", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    vi.resetModules();
    const fresh = await import("../lib/visitor-hash.ts");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fresh.visitorKey("203.0.113.7", undefined, DAY);
    fresh.visitorKey("203.0.113.8", undefined, DAY);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays null outside AWS and production", () => {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.VERCEL_ENV;
    expect(visitorKey("203.0.113.7", undefined, DAY)).toBeNull();
  });
});
