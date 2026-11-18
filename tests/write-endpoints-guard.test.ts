import type { VercelResponse } from "@vercel/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => ({
  query: vi.fn(async (_text: string, _params?: unknown[]) => [] as unknown[]),
}));
vi.mock("../lib/db.ts", () => ({ getSql: () => sqlMock }));
vi.stubEnv("ITEMS_CURSOR_SECRET", "test-secret");

const { default: track } = await import("../api/track.ts");
const { default: subscribe } = await import("../api/subscribe.ts");
const { default: submit } = await import("../api/submit-collection.ts");

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  setHeader(k: string, v: string): void;
  json(payload: unknown): MockRes;
}

function mockRes(): MockRes & VercelResponse {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as MockRes & VercelResponse;
}

const post = (body: unknown) =>
  ({
    method: "POST",
    body,
    headers: { "x-forwarded-for": "203.0.113.9" },
  }) as never;

beforeEach(() => {
  sqlMock.query.mockReset();
  sqlMock.query.mockResolvedValue([{ tokens: 10 }]);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("SUBMIT_NOTIFY_EMAIL", "ops@example.com");
});

describe("api/track", () => {
  it("accepts a conventional event", async () => {
    const res = mockRes();
    await track(post({ event_name: "page_view", props: { a: 1 } }), res);
    expect(res.statusCode).toBe(200);
  });

  it.each(["has space", "<script>", "x".repeat(65), "", "-leading"])(
    "rejects event_name %j",
    async (name) => {
      const res = mockRes();
      await track(post({ event_name: name }), res);
      expect(res.statusCode).toBe(400);
    },
  );

  it("rejects a non-string event_name", async () => {
    const res = mockRes();
    await track(post({ event_name: { a: 1 } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects a body over the size cap with 413", async () => {
    const res = mockRes();
    await track(
      post({ event_name: "ok", props: { blob: "x".repeat(20000) } }),
      res,
    );
    expect(res.statusCode).toBe(413);
  });

  it("rejects props over the props cap or nested too deeply", async () => {
    let res = mockRes();
    await track(
      post({ event_name: "ok", props: { blob: "x".repeat(5000) } }),
      res,
    );
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await track(
      post({ event_name: "ok", props: { a: { b: { c: { d: 1 } } } } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("answers 429 once the per-IP bucket is empty", async () => {
    sqlMock.query.mockResolvedValue([]);
    const res = mockRes();
    await track(post({ event_name: "page_view" }), res);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });
});

describe("api/subscribe", () => {
  it("rejects an oversized body with 413 and an overlong field with 400", async () => {
    let res = mockRes();
    await subscribe(
      post({ email: "a@b.co", source: "pro_waitlist", pad: "x".repeat(5000) }),
      res,
    );
    expect(res.statusCode).toBe(413);
    res = mockRes();
    await subscribe(
      post({ email: `${"a".repeat(300)}@b.co`, source: "pro_waitlist" }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("answers 429 once the per-IP bucket is empty", async () => {
    sqlMock.query.mockResolvedValue([]);
    const res = mockRes();
    await subscribe(post({ email: "a@b.co", source: "pro_waitlist" }), res);
    expect(res.statusCode).toBe(429);
  });

  it("logs neither the Resend error body nor the email address", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) =>
        (init?.method || "GET") === "GET"
          ? { ok: false, status: 404, json: async () => ({}) }
          : {
              ok: false,
              status: 500,
              text: async () => "rejected victim@example.com",
            },
      ),
    );
    const res = mockRes();
    await subscribe(
      post({ email: "victim@example.com", source: "pro_waitlist" }),
      res,
    );
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(
      "victim@example.com",
    );
    errors.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("api/submit-collection", () => {
  it("logs neither the Resend error body nor the reply-to address", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 422,
        text: async () => "invalid reply_to victim@example.com",
      })),
    );
    const res = mockRes();
    await submit(
      post({ kind: "feedback", message: "hi", email: "victim@example.com" }),
      res,
    );
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(
      "victim@example.com",
    );
    errors.mockRestore();
    vi.unstubAllGlobals();
  });

  it("rejects an oversized body with 413", async () => {
    const res = mockRes();
    await submit(post({ kind: "feedback", message: "x".repeat(40000) }), res);
    expect(res.statusCode).toBe(413);
  });

  it("rejects an overlong field with 400", async () => {
    const res = mockRes();
    await submit(
      post({
        kind: "report",
        itemSource: "met",
        itemNativeId: "1",
        itemUrl: "u".repeat(2500),
        comment: "c",
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("answers 429 once the per-IP bucket is empty", async () => {
    sqlMock.query.mockResolvedValue([]);
    const res = mockRes();
    await submit(post({ kind: "feedback", message: "hi" }), res);
    expect(res.statusCode).toBe(429);
  });
});
