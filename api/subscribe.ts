// One capture endpoint for multiple entry points (Tranquilo Curator waitlist, feature
// notify, newsletter opt-in on submit, homepage newsletter), distinguished by a `source` property rather than
// separate systems per entry point.
//
// Uses Resend's global Contacts model (POST /contacts, no audience_id)
// under their "New Contacts Experience" -- a contact can belong to zero
// or more Audiences, with custom `properties` at the contact level. A
// Resend Segment filtering on `source` can target any cohort for a
// Broadcast. A `locale` property records the language the signup was made
// in (lib/request-locale.ts), so a later newsletter can match it.
//
// Required env var: RESEND_API_KEY (shared with api/submit-collection.ts).

import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { getSql } from "../lib/db.ts";
import { isValidEmail } from "../lib/is-valid-email.ts";
import { requestLocale } from "../lib/request-locale.ts";
import { reportError, reportProblem } from "../lib/sentry.ts";
import {
  rejectOverlongField,
  rejectOversizedBody,
  writeRateLimited,
} from "../lib/write-guard.ts";

const MAX_BODY_BYTES = 2048;
const FIELD_MAX = { email: 254, source: 40, locale: 20 };

const VALID_SOURCES: Record<string, boolean> = {
  pro_waitlist: true,
  feature_notify: true,
  newsletter_submit: true,
  homepage_newsletter: true,
};

// Contact Properties must exist on the account before create-contact
// can set one, or it 422s ("One or more properties do not exist"). This
// creates the property on first encounter and retries, self-healing
// rather than needing a manual dashboard step.
function createStringProperty(apiKey: string, key: string) {
  return fetch("https://api.resend.com/contact-properties", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, type: "string" }),
  });
}

// Resend's create-contact silently upserts, REPLACING `properties`
// wholesale rather than merging -- so this reads the contact's current
// properties first (a 404 is expected for a first-time signup), folds the
// new source into a comma-separated set instead of overwriting a prior
// signup's tag, and keeps a stored locale when this signup sent none.
function getContact(apiKey: string, email: string) {
  return fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

// GET /contacts/{email} doesn't return a property as a plain
// string the way create-contact accepts one -- handles both a plain
// string and an object wrapper, falling back to "no history" (safe) if
// neither shape matches.
function extractPropertyStringValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (
    raw &&
    typeof raw === "object" &&
    "value" in raw &&
    typeof raw.value === "string"
  )
    return raw.value;
  return null;
}

// `unsubscribed` is null for a first-time signup. For an existing contact
// it's their current choice, which a signup must never undo -- otherwise
// anyone could put an unsubscribed address back on the list.
type MergedContact = {
  properties: Record<string, string>;
  unsubscribed: boolean | null;
};

async function mergedContact(
  apiKey: string,
  email: string,
  newSource: string,
  newLocale: string | null,
): Promise<MergedContact> {
  const merged: Record<string, string> = { source: newSource };
  if (newLocale) merged.locale = newLocale;

  const getRes = await getContact(apiKey, email);
  if (getRes.status === 404) return { properties: merged, unsubscribed: null };
  // Any other failure leaves us not knowing whether they unsubscribed, so
  // write nothing rather than risk re-subscribing them.
  if (!getRes.ok) {
    throw new Error(`subscribe: contact lookup failed (${getRes.status})`);
  }
  const data = await getRes.json();
  // Anything but an explicit false counts as unsubscribed, so an
  // unexpected response shape can't re-subscribe anyone.
  const unsubscribed = data?.unsubscribed !== false;

  const rawExisting = data?.properties?.source;
  const existing = extractPropertyStringValue(rawExisting);
  if (rawExisting && existing === null) {
    console.warn(
      "subscribe: unrecognized properties.source shape, treating as no history",
      typeof rawExisting,
    );
  }
  if (existing) {
    const set = existing
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (set.indexOf(newSource) === -1) {
      set.push(newSource);
    }
    merged.source = set.join(",");
  }

  if (!newLocale) {
    const storedLocale = requestLocale(
      extractPropertyStringValue(data?.properties?.locale),
    );
    if (storedLocale) merged.locale = storedLocale;
  }
  return { properties: merged, unsubscribed };
}

function createContact(apiKey: string, email: string, contact: MergedContact) {
  return fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: email,
      unsubscribed: contact.unsubscribed ?? false,
      properties: contact.properties,
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

  if (rejectOversizedBody(res, req.body, MAX_BODY_BYTES)) return;

  const requestId = randomUUID();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (rejectOverlongField(res, body, FIELD_MAX)) return;
  if (await writeRateLimited(getSql(), req, res, "subscribe")) return;

  const email = body.email;
  const source = body.source;
  const locale = requestLocale(body.locale);

  if (!isValidEmail(email)) {
    res.statusCode = 400;
    res.json({ error: "Invalid email" });
    return;
  }
  if (!VALID_SOURCES[source]) {
    // A visitor can't choose the source -- each form hard-codes it -- so an
    // unknown one means a form and this list disagree.
    await reportProblem(
      "subscribe.invalid_source",
      "subscribe: a form sent a source this endpoint doesn't accept",
      { source: String(source).slice(0, 100) },
    );
    res.statusCode = 400;
    res.json({ error: "Invalid source" });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("subscribe: missing RESEND_API_KEY env var");
    await reportProblem(
      "subscribe.not_configured",
      "subscribe: RESEND_API_KEY is not set",
    );
    res.statusCode = 500;
    res.json({ error: "Subscribe isn't configured yet" });
    return;
  }

  let contact: MergedContact, resendRes: Response, errBody: string;
  try {
    contact = await mergedContact(apiKey, email, source, locale);
    resendRes = await createContact(apiKey, email, contact);

    if (!resendRes.ok) {
      errBody = await resendRes.text();

      if (
        resendRes.status === 422 &&
        /properties do not exist/i.test(errBody)
      ) {
        // Creating a property that already exists is harmless, so create
        // every one this contact carries rather than parse which was missing.
        for (const key of Object.keys(contact.properties)) {
          await createStringProperty(apiKey, key);
        }
        resendRes = await createContact(apiKey, email, contact);
        if (!resendRes.ok) {
          errBody = await resendRes.text();
          console.error(
            "subscribe: retry after creating property still failed",
            resendRes.status,
            requestId,
          );
          await reportProblem(
            "subscribe.resend_failed",
            `subscribe: Resend refused the contact (${resendRes.status})`,
            { status: resendRes.status, requestId, source },
          );
          res.statusCode = 502;
          res.json({ error: "Couldn't subscribe right now" });
          return;
        }
        res.statusCode = 200;
        res.json({ ok: true });
        return;
      }

      console.error("subscribe: Resend API error", resendRes.status, requestId);
      await reportProblem(
        "subscribe.resend_failed",
        `subscribe: Resend refused the contact (${resendRes.status})`,
        { status: resendRes.status, requestId, source },
      );
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
