// /api/auth end to end against real Postgres (PGlite), with Resend stubbed.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRANQUILO_CONFIG } from "../lib/config.generated.ts";
import { makeSql } from "./helpers/pg.ts";

type Sql = {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  $close(): Promise<void>;
};

const db = vi.hoisted(() => ({ sql: null as unknown as Sql }));
vi.mock("../lib/db.ts", () => ({ getSql: () => db.sql }));
vi.mock("../lib/sentry.ts", () => ({
  Sentry: {},
  reportError: vi.fn(),
  reportProblem: vi.fn(),
}));

const { default: handler } = await import("../lib/auth-api.ts");

const FILES = [
  "035_visitor_rate_state.sql",
  "065_visitor_spent.sql",
  "067_user_accounts.sql",
];

const auth = TRANQUILO_CONFIG.auth as { enabled: boolean; site_origin: string };
let sentEmails: { to: string[]; text: string; html?: string }[];

beforeEach(async () => {
  db.sql = await makeSql(FILES);
  auth.enabled = true;
  sentEmails = [];
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ITEMS_CURSOR_SECRET", "test-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sentEmails.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
    }),
  );
});

afterEach(async () => {
  await db.sql.$close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface Reply {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: unknown;
}

async function call(
  method: string,
  action: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<Reply> {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | string[]>,
    body: undefined as unknown,
    setHeader(name: string, value: string | string[]) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  await handler(
    {
      method,
      query: { action },
      body,
      headers: { host: "tranquilo.art", ...headers },
    } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  );
  return res as Reply;
}

function linkToken(): string {
  const text = sentEmails.at(-1)?.text ?? "";
  const match = /\?signin=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error("no sign-in link in the email");
  return match[1];
}

function cookiePair(reply: Reply): string {
  const raw = reply.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value).split(";")[0];
}

async function signIn(email = "mel@example.org"): Promise<string> {
  await call("POST", "request-link", { email });
  const reply = await call("POST", "verify", { token: linkToken() });
  expect(reply.statusCode).toBe(200);
  return cookiePair(reply);
}

describe("/api/auth", () => {
  it("is not found while auth is switched off", async () => {
    auth.enabled = false;
    const reply = await call("POST", "request-link", {
      email: "mel@example.org",
    });
    expect(reply.statusCode).toBe(404);
    expect(sentEmails).toEqual([]);
  });

  it("never lets a response be cached", async () => {
    const reply = await call("GET", "session");
    expect(reply.headers["cache-control"]).toBe("no-store");
  });

  it("rejects an unknown action and a wrong method", async () => {
    expect((await call("POST", "explode")).statusCode).toBe(400);
    expect((await call("GET", "request-link")).statusCode).toBe(405);
    expect((await call("POST", "session")).statusCode).toBe(405);
  });

  it("emails one sign-in link and rejects a bad address", async () => {
    expect(
      (await call("POST", "request-link", { email: "nope" })).statusCode,
    ).toBe(400);
    const reply = await call("POST", "request-link", {
      email: "mel@example.org",
    });
    expect(reply.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toEqual(["mel@example.org"]);
  });

  it("puts the configured origin in the link even under a forged Host", async () => {
    await call(
      "POST",
      "request-link",
      { email: "mel@example.org" },
      { host: "evil.example", "x-forwarded-host": "evil.example" },
    );
    const text = sentEmails[0].text;
    expect(text).toContain(`${auth.site_origin}/?signin=`);
    expect(text).not.toContain("evil.example");
  });

  it("answers the same for a new and an existing account", async () => {
    await signIn("old@example.org");
    const existing = await call("POST", "request-link", {
      email: "old@example.org",
    });
    const fresh = await call("POST", "request-link", {
      email: "new@example.org",
    });
    expect(existing.statusCode).toBe(fresh.statusCode);
    expect(existing.body).toEqual(fresh.body);
  });

  it("signs in with the emailed token and sets a session cookie", async () => {
    const cookie = await signIn();
    const session = await call("GET", "session", {}, { cookie });
    expect(session.body).toEqual({ user: { email: "mel@example.org" } });
  });

  it("refuses a used or made-up token without setting a cookie", async () => {
    await call("POST", "request-link", { email: "mel@example.org" });
    const token = linkToken();
    await call("POST", "verify", { token });
    for (const t of [token, "made-up", undefined]) {
      const reply = await call("POST", "verify", { token: t });
      expect(reply.statusCode).toBe(400);
      expect(reply.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("reports no user without a valid cookie", async () => {
    expect((await call("GET", "session")).body).toEqual({ user: null });
    expect(
      (await call("GET", "session", {}, { cookie: "tq_session=forged" })).body,
    ).toEqual({ user: null });
  });

  it("signs out: the old cookie stops working and is cleared", async () => {
    const cookie = await signIn();
    const out = await call("POST", "logout", {}, { cookie });
    expect(out.statusCode).toBe(200);
    expect(String(out.headers["set-cookie"])).toMatch(/Max-Age=0/);
    const session = await call("GET", "session", {}, { cookie });
    expect(session.body).toEqual({ user: null });
  });

  it("stops emailing one address once its budget is spent", async () => {
    let limited = false;
    for (let i = 0; i < 50 && !limited; i++) {
      const reply = await call("POST", "request-link", {
        email: "mel@example.org",
      });
      limited = reply.statusCode === 429;
    }
    expect(limited).toBe(true);
    const before = sentEmails.length;
    await call("POST", "request-link", { email: "mel@example.org" });
    expect(sentEmails.length).toBe(before);
  });

  it("does not report success when the email fails to send", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const reply = await call("POST", "request-link", {
      email: "mel@example.org",
    });
    expect(reply.statusCode).toBe(502);
  });
});
