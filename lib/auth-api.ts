// Email sign-in, dispatched on ?action=:
//   POST request-link {email}  emails a one-time sign-in link
//   POST verify {token}        uses the link's token, sets the session cookie
//   POST logout                ends the session and clears the cookie
//   GET  session               { user: { email } | null }
//
// The emailed link opens the site, which posts the token here. A link that
// worked on GET would be spent by mail scanners that open every link.
// Answers 404 while [auth].enabled is false. See lib/auth.ts.
//
// Required env vars: DATABASE_URL, RESEND_API_KEY, ITEMS_CURSOR_SECRET.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authBudgetOrRespond,
  authEnabled,
  clearedSessionCookie,
  consumeLoginLink,
  createLoginLink,
  endSession,
  normalizeEmail,
  resolveSession,
  sendSignInEmail,
  sessionCookie,
  sessionTokenFromCookie,
  signInUrl,
  startSession,
} from "./auth.ts";
import { getSql } from "./db.ts";
import { isValidEmail } from "./is-valid-email.ts";
import { reportError, reportProblem } from "./sentry.ts";

const METHODS: Record<string, string> = {
  "request-link": "POST",
  verify: "POST",
  logout: "POST",
  session: "GET",
};

function fail(res: VercelResponse, status: number, error: string) {
  res.statusCode = status;
  res.json({ error });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (!authEnabled()) return fail(res, 404, "Not found");

  const action = String(req.query?.action ?? "");
  const method = METHODS[action];
  if (!method) return fail(res, 400, "Unknown action");
  if (req.method !== method) {
    res.setHeader("Allow", method);
    return fail(res, 405, "Method not allowed");
  }

  const sql = getSql();
  if (!sql) return fail(res, 503, "Sign-in is unavailable");
  const body = req.body || {};
  const cookieToken = sessionTokenFromCookie(req.headers?.cookie);

  try {
    if (action === "session") {
      const user = await resolveSession(sql, cookieToken);
      res.statusCode = 200;
      res.json({ user: user ? { email: user.email } : null });
      return;
    }

    if (action === "logout") {
      if (cookieToken) await endSession(sql, cookieToken);
      res.setHeader("Set-Cookie", clearedSessionCookie());
      res.statusCode = 200;
      res.json({ ok: true });
      return;
    }

    if (action === "verify") {
      const user = await consumeLoginLink(sql, body.token);
      if (!user)
        return fail(res, 400, "This sign-in link is invalid or expired");
      const token = await startSession(sql, user.userId);
      res.setHeader("Set-Cookie", sessionCookie(token));
      res.statusCode = 200;
      res.json({ user: { email: user.email } });
      return;
    }

    if (!isValidEmail(body.email)) return fail(res, 400, "Invalid email");
    const email = normalizeEmail(body.email);
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      await reportProblem(
        "auth.not_configured",
        "auth: RESEND_API_KEY is not set",
      );
      return fail(res, 503, "Sign-in is unavailable");
    }
    if (await authBudgetOrRespond(sql, req, email, res)) return;

    const token = await createLoginLink(sql, email);
    if (!(await sendSignInEmail(apiKey, email, signInUrl(token)))) {
      await reportProblem(
        "auth.email_failed",
        "auth: Resend did not accept a sign-in email",
      );
      return fail(res, 502, "Couldn't send the email right now");
    }
    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    console.error("auth: unexpected error", err);
    await reportError(err);
    fail(res, 500, "Unexpected server error");
  }
}
