// /api/auth and /api/boards are one function: vercel.json rewrites both to
// api/account.ts, which dispatches on ?area=.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("../lib/auth-api.ts", () => ({
  default: async () => {
    calls.push("auth");
  },
}));
vi.mock("../lib/boards-api.ts", () => ({
  default: async () => {
    calls.push("boards");
  },
}));

const { default: handler } = await import("../api/account.ts");

const vercel = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "vercel.json"), "utf8"),
);

function res() {
  return {
    statusCode: 200,
    setHeader() {},
    json() {},
  } as unknown as VercelResponse;
}

describe("account endpoints", () => {
  it.each(["auth", "boards"])("rewrites /api/%s to its area", (area) => {
    const rule = vercel.rewrites.find(
      (r: { source: string }) => r.source === `/api/${area}`,
    );
    expect(rule?.destination).toBe(`/api/account?area=${area}`);
  });

  it.each(["auth", "boards"])("hands ?area=%s to its handler", async (area) => {
    calls.length = 0;
    await handler({ query: { area } } as unknown as VercelRequest, res());
    expect(calls).toEqual([area]);
  });

  it("answers 404 for any other area", async () => {
    calls.length = 0;
    const reply = res();
    await handler(
      { query: { area: "admin" } } as unknown as VercelRequest,
      reply,
    );
    expect(reply.statusCode).toBe(404);
    expect(calls).toEqual([]);
  });
});
