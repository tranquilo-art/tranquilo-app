// One capture endpoint for multiple entry points (Pro waitlist, feature
// notify, newsletter), distinguished by a `source` property rather than
// separate systems per entry point.
//
// Uses Resend's global Contacts model (POST /contacts, no audience_id)
// under their "New Contacts Experience" -- a contact can belong to zero
// or more Audiences, with custom `properties` at the contact level. A
// Resend Segment filtering on `source` can target any cohort for a
// Broadcast.
//
// Required env var: RESEND_API_KEY (shared with api/submit-collection.ts).

import type { VercelRequest, VercelResponse } from "@vercel/node";

import { reportError } from "../lib/sentry.ts";

const VALID_SOURCES: Record<string, boolean> = {
  pro_waitlist: true,
  feature_notify: true,
  newsletter_submit: true,
};

function isValidEmail(value: any): boolean {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Contact Properties must exist on the account before create-contact
// can set one, or it 422s ("One or more properties do not exist"). This
// creates the property on first encounter and retries, self-healing
// rather than needing a manual dashboard step.
function createSourceProperty(apiKey: string) {
  return fetch("https://api.resend.com/contact-properties", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key: "source", type: "string" }),
  });
}

// Resend's create-contact silently upserts, REPLACING `properties`
// wholesale rather than merging -- so this reads the contact's current
// source value first (a 404 is expected for a first-time signup) and
// folds the new source into a comma-separated set instead of
// overwriting a prior signup's tag.
function getContact(apiKey: string, email: string) {
  return fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// GET /contacts/{email} doesn't return properties.source as a plain
// string the way create-contact accepts one -- handles both a plain
// string and an object wrapper, falling back to "no history" (safe) if
// neither shape matches.
function extractPropertyStringValue(raw: any): string | null {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof raw.value === "string")
    return raw.value;
  return null;
}

async function mergedSourceValue(
  apiKey: string,
  email: string,
  newSource: string,
): Promise<string> {
  const getRes = await getContact(apiKey, email);
  if (!getRes.ok) return newSource;
  const data = await getRes.json();
  const rawExisting = data?.properties?.source;
  const existing = extractPropertyStringValue(rawExisting);
  if (rawExisting && existing === null) {
    console.warn(
      "subscribe: unrecognized properties.source shape, treating as no history",
      JSON.stringify(rawExisting),
    );
  }
  if (!existing) return newSource;
  const set = existing
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (set.indexOf(newSource) === -1) {
    set.push(newSource);
  }
  return set.join(",");
}

function createContact(apiKey: string, email: string, source: string) {
  return fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email,
      unsubscribed: false,
      properties: { source: source },
    }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const email = body.email;
  const source = body.source;

  if (!isValidEmail(email)) {
    res.statusCode = 400;
    res.json({ error: "Invalid email" });
    return;
  }
  if (!VALID_SOURCES[source]) {
    res.statusCode = 400;
    res.json({ error: "Invalid source" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("subscribe: missing RESEND_API_KEY env var");
    res.statusCode = 500;
    res.json({ error: "Subscribe isn't configured yet" });
    return;
  }

  let mergedSource: any, resendRes: any, errBody: any;
  try {
    mergedSource = await mergedSourceValue(apiKey, email, source);
    resendRes = await createContact(apiKey, email, mergedSource);

    if (!resendRes.ok) {
      errBody = await resendRes.text();

      if (
        resendRes.status === 422 &&
        /properties do not exist/i.test(errBody)
      ) {
        await createSourceProperty(apiKey);
        resendRes = await createContact(apiKey, email, mergedSource);
        if (!resendRes.ok) {
          errBody = await resendRes.text();
          console.error(
            "subscribe: retry after creating property still failed",
            resendRes.status,
            errBody,
          );
          res.statusCode = 502;
          res.json({ error: "Couldn't subscribe right now" });
          return;
        }
        res.statusCode = 200;
        res.json({ ok: true });
        return;
      }

      console.error("subscribe: Resend API error", resendRes.status, errBody);
      res.statusCode = 502;
      res.json({ error: "Couldn't subscribe right now" });
      return;
    }

    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    console.error("subscribe: unexpected error", err);
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "Unexpected server error" });
  }
}
