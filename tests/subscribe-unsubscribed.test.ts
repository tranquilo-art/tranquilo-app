// Resend's create-contact upserts, so /api/subscribe must carry an existing
// contact's unsubscribe choice through -- otherwise anyone could put an
// unsubscribed address back on the list just by entering it in a form.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/subscribe.ts";

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
  setHeader(k: string, v: unknown): void;
  json(payload: unknown): MockRes;
};

function mockRes(): MockRes {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

type Lookup = { ok: boolean; status: number; json: () => Promise<unknown> };
type CreateBody = { unsubscribed: boolean };

// What the contact lookup returns, and every create-contact body sent.
let lookup: Lookup;
let creates: CreateBody[];

function found(contact: unknown): Lookup {
  return { ok: true, status: 200, json: async () => contact };
}

beforeEach(() => {
  lookup = { ok: false, status: 404, json: async () => ({}) };
  creates = [];
  process.env.RESEND_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method || "GET") === "GET") return lookup;
      creates.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, text: async () => "" };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

async function post() {
  const res = mockRes();
  const req = {
    method: "POST",
    body: { email: "a@example.com", source: "newsletter_submit" },
  };
  await handler(
    req as unknown as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res;
}

describe("subscribe respects an existing unsubscribe", () => {
  it("subscribes a first-time signup", async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(creates.at(-1)?.unsubscribed).toBe(false);
  });

  it("keeps an unsubscribed contact unsubscribed", async () => {
    lookup = found({ unsubscribed: true, properties: {} });
    const res = await post();
    // Same reply as a real signup, so the form doesn't reveal list status.
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(creates.at(-1)?.unsubscribed).toBe(true);
  });

  it("keeps a subscribed contact subscribed", async () => {
    lookup = found({ unsubscribed: false, properties: {} });
    await post();
    expect(creates.at(-1)?.unsubscribed).toBe(false);
  });

  it("treats a contact with no clear status as unsubscribed", async () => {
    lookup = found({ properties: {} });
    await post();
    expect(creates.at(-1)?.unsubscribed).toBe(true);
  });

  it("writes nothing when the lookup fails", async () => {
    lookup = { ok: false, status: 500, json: async () => ({}) };
    const res = await post();
    expect(res.statusCode).toBe(500);
    expect(creates).toEqual([]);
  });
});
