import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "../lib/cron-auth.ts";

const withAuth = (authorization: unknown) => ({
  headers: { authorization } as Record<string, string | string[] | undefined>,
});

describe("isCronAuthorized", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "s3cret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts the exact bearer token", () => {
    expect(isCronAuthorized(withAuth("Bearer s3cret"))).toBe(true);
  });

  it.each([
    ["wrong token of equal length", "Bearer s3creX"],
    ["shorter token", "Bearer s3"],
    ["longer token", "Bearer s3cret-and-more"],
    ["empty header", ""],
    ["missing scheme", "s3cret"],
    ["array-valued header", ["Bearer s3cret"]],
    ["undefined header", undefined],
  ])("rejects %s without throwing", (_name, header) => {
    expect(isCronAuthorized(withAuth(header))).toBe(false);
  });

  it("rejects a request with no headers object", () => {
    expect(isCronAuthorized({})).toBe(false);
  });

  it("rejects everything when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isCronAuthorized(withAuth("Bearer "))).toBe(false);
    expect(isCronAuthorized(withAuth(""))).toBe(false);
  });
});
