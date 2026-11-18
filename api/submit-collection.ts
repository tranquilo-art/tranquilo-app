// Form submissions via Resend email. Handles collection, feedback, and report forms
// distinguished by body.kind (absent kind = collection). Each email names the
// language the form was sent in, so a reply can be written in it.
// Requires RESEND_API_KEY and SUBMIT_NOTIFY_EMAIL.

import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../lib/db.ts";
import { escapeHtml } from "../lib/html-escape.ts";
import { isValidEmail } from "../lib/is-valid-email.ts";
import { requestLocale } from "../lib/request-locale.ts";
import { reportError, reportProblem } from "../lib/sentry.ts";
import {
  rejectOverlongField,
  rejectOversizedBody,
  writeRateLimited,
} from "../lib/write-guard.ts";

const MAX_BODY_BYTES = 32768;
const COLLECTION_FIELD_MAX = {
  collectionName: 200,
  submitterName: 200,
  submitterEmail: 254,
  collectionLink: 2000,
  licenseType: 100,
  licenseOther: 200,
  licenseVerificationLink: 2000,
  estimatedSize: 100,
  description: 4000,
  locale: 20,
  kind: 20,
  feedbackType: 40,
  email: 254,
  message: 4000,
  context: 300,
  itemSource: 100,
  itemNativeId: 500,
  itemUrl: 2000,
  comment: 2000,
};
const MAX_REPORT_CATEGORIES = 10;

const REQUIRED_FIELDS = [
  "collectionName",
  "submitterName",
  "submitterEmail",
  "collectionLink",
  "licenseType",
  "licenseVerificationLink",
  "description",
];

type FormBody = Record<string, unknown>;
type NotificationRow = [label: string, value: unknown];

// Registered locale or "(not given)" -- never the raw request value.
function languageLine(body: FormBody): string {
  return requestLocale(body.locale) || "(not given)";
}

// Shared by both forms: build the email, send it, map Resend's failure onto a
// response. Everything above the call is per-form.
async function sendNotification(
  res: VercelResponse,
  {
    subject,
    rows,
    text,
    html,
    replyTo,
    heading,
  }: {
    subject: string;
    rows?: NotificationRow[];
    text?: string;
    html?: string;
    replyTo?: string | null;
    heading?: string;
  },
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.SUBMIT_NOTIFY_EMAIL;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";

  if (!apiKey || !notifyEmail) {
    console.error(
      "submit-collection: missing RESEND_API_KEY or SUBMIT_NOTIFY_EMAIL env var",
    );
    await reportProblem(
      "submit.not_configured",
      "submit-collection: RESEND_API_KEY or SUBMIT_NOTIFY_EMAIL is not set",
    );
    res.statusCode = 500;
    res.json({ error: "Submission pipeline isn't configured yet" });
    return;
  }

  // The report notification passes its own text/html directly, since
  // its body doesn't fit the label:value table shape.
  const textBody =
    text !== undefined
      ? text
      : (rows || []).map((r) => `${r[0]}: ${r[1]}`).join("\n");
  const htmlBody =
    html !== undefined
      ? html
      : `<h2>${escapeHtml(heading || "")}</h2><table>${(rows || [])
          .map(
            (r) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#666;">${escapeHtml(
                r[0],
              )}</td><td>${escapeHtml(r[1]).replace(/\n/g, "<br>")}</td></tr>`,
          )
          .join("")}</table>`;

  const payload: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
    reply_to?: string;
  } = {
    from: fromEmail,
    to: [notifyEmail],
    subject: subject,
    text: textBody,
    html: htmlBody,
  };
  // Only set when present -- Resend rejects the whole send on a
  // malformed reply_to.
  if (replyTo) payload.reply_to = replyTo;

  const requestId = randomUUID();
  let resendRes: Response;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resendRes.ok) {
      console.error(
        "submit-collection: Resend API error",
        resendRes.status,
        requestId,
      );
      await reportProblem(
        "submit.resend_failed",
        `submit-collection: Resend refused the email (${resendRes.status})`,
        { status: resendRes.status, requestId },
      );
      res.statusCode = 502;
      res.json({ error: "Couldn't send the submission email" });
      return;
    }

    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    console.error("submit-collection: unexpected error", err);
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "Unexpected server error" });
  }
}

// Only the message is required -- not email, deliberately, so reporting
// a bug never costs someone their anonymity on a product with no
// accounts. Some reports can't be followed up on; that's accepted.
const FEEDBACK_REQUIRED_FIELDS = ["message"];
const FEEDBACK_TYPES = ["Bug", "Feature idea", "Content", "Something else"];
const FEEDBACK_MAX: Record<string, number> = {
  message: 4000,
  context: 300,
  email: 200,
};

async function handleFeedback(
  _req: VercelRequest,
  res: VercelResponse,
  body: FormBody,
): Promise<void> {
  let i: number, field: string;
  for (i = 0; i < FEEDBACK_REQUIRED_FIELDS.length; i++) {
    field = FEEDBACK_REQUIRED_FIELDS[i];
    if (!body[field] || !String(body[field]).trim()) {
      res.statusCode = 400;
      res.json({ error: `Missing required field: ${field}` });
      return;
    }
  }
  // A malformed (not absent) email is worth rejecting -- silently
  // dropping it looks identical to choosing anonymity.
  if (body.email && String(body.email).trim() && !isValidEmail(body.email)) {
    res.statusCode = 400;
    res.json({ error: "Invalid email" });
    return;
  }
  for (const key in FEEDBACK_MAX) {
    if (body[key] && String(body[key]).length > FEEDBACK_MAX[key]) {
      res.statusCode = 400;
      res.json({
        error: `${key} is too long (max ${FEEDBACK_MAX[key]} characters)`,
      });
      return;
    }
  }

  const type =
    typeof body.feedbackType === "string" &&
    FEEDBACK_TYPES.includes(body.feedbackType)
      ? body.feedbackType
      : // Falls back rather than 400s -- an unknown type is our bug, not
        // theirs, and shouldn't lose a written report.
        "Something else";
  const email = body.email ? String(body.email).trim() : "";

  await sendNotification(res, {
    heading: "New Tranquilo feedback",
    subject: `Tranquilo feedback (${type})`,
    replyTo: email || null,
    rows: [
      ["Type", type],
      ["Message", body.message],
      ["Where", (body.context && String(body.context).trim()) || "(not given)"],
      ["Reply to", email || "(anonymous — no reply possible)"],
      ["Language", languageLine(body)],
      [
        "Next step",
        "Log in Signals. Promote to an issue only once corroborated.",
      ],
    ],
  });
}

// A third form folded into this same route -- no storage beyond the
// email, unlike the collection form; a Resend message is a good enough
// record until report volume says otherwise.
const REPORT_CATEGORIES = [
  "There's an issue with image",
  "There's an issue with content",
  "I'm having a technical issue (broken link)",
  "Tell us more",
];
const REPORT_REQUIRED_FIELDS = ["itemSource", "itemNativeId"];
const REPORT_MAX: Record<string, number> = { comment: 2000 };

// "YYYY-MM-DD HH:MM UTC" -- unambiguous across timezones, since this
// lands in an inbox that could be read from any of them.
function reportTimestamp(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

async function handleReport(
  _req: VercelRequest,
  res: VercelResponse,
  body: FormBody,
): Promise<void> {
  let i: number, field: string;
  for (i = 0; i < REPORT_REQUIRED_FIELDS.length; i++) {
    field = REPORT_REQUIRED_FIELDS[i];
    if (!body[field] || !String(body[field]).trim()) {
      res.statusCode = 400;
      res.json({ error: `Missing required field: ${field}` });
      return;
    }
  }
  if (body.comment && String(body.comment).length > REPORT_MAX.comment) {
    res.statusCode = 400;
    res.json({
      error: `comment is too long (max ${REPORT_MAX.comment} characters)`,
    });
    return;
  }

  // Checkboxes, so zero or more; an unrecognised entry is dropped
  // rather than substituted.
  const rawCategories: unknown[] = Array.isArray(body.categories)
    ? body.categories
    : [];
  const categories = rawCategories.filter(
    (c): c is string => typeof c === "string" && REPORT_CATEGORIES.includes(c),
  );
  const comment = body.comment ? String(body.comment).trim() : "";

  // Nothing to act on -- worth a real 400, not a silently "successful"
  // empty report.
  if (!categories.length && !comment) {
    res.statusCode = 400;
    res.json({
      error:
        "Nothing to report -- select at least one option or leave a comment",
    });
    return;
  }

  const itemUrl = body.itemUrl || "(not given)";
  const reportLine = categories.length
    ? categories.join(", ")
    : "(no category selected)";
  const commentLine = comment || "No comment provided";
  const language = languageLine(body);

  await sendNotification(res, {
    subject: `User content report ${reportTimestamp()}`,
    replyTo: null,
    text: `A user made a report at: ${itemUrl}\nReport: ${reportLine}\nComment: ${commentLine}\nLanguage: ${language}`,
    html: `<p>A user made a report at: <a href="${escapeHtml(itemUrl)}">${escapeHtml(itemUrl)}</a></p>
<p>Report: ${escapeHtml(reportLine)}</p>
<p>Comment: ${escapeHtml(commentLine).replace(/\n/g, "<br>")}</p>
<p>Language: ${escapeHtml(language)}</p>`,
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

  const body: FormBody =
    req.body && typeof req.body === "object" ? req.body : {};
  if (rejectOverlongField(res, body, COLLECTION_FIELD_MAX)) return;
  if (
    Array.isArray(body.categories) &&
    body.categories.length > MAX_REPORT_CATEGORIES
  ) {
    res.statusCode = 400;
    res.json({ error: "categories has too many entries" });
    return;
  }
  if (await writeRateLimited(getSql(), req, res, "submit")) return;

  if (body.kind === "feedback") {
    await handleFeedback(req, res, body);
    return;
  }
  if (body.kind === "report") {
    await handleReport(req, res, body);
    return;
  }

  let i: number, field: string;
  for (i = 0; i < REQUIRED_FIELDS.length; i++) {
    field = REQUIRED_FIELDS[i];
    if (!body[field] || !String(body[field]).trim()) {
      res.statusCode = 400;
      res.json({ error: `Missing required field: ${field}` });
      return;
    }
  }
  if (!isValidEmail(body.submitterEmail)) {
    res.statusCode = 400;
    res.json({ error: "Invalid submitter email" });
    return;
  }
  if (body.licenseType === "Other" && !body.licenseOther) {
    res.statusCode = 400;
    res.json({ error: "Missing required field: licenseOther" });
    return;
  }

  const rows: NotificationRow[] = [
    ["Collection name", body.collectionName],
    ["Submitted by", `${body.submitterName} <${body.submitterEmail}>`],
    ["Collection link", body.collectionLink],
    [
      "License type",
      body.licenseType === "Other" ? body.licenseOther : body.licenseType,
    ],
    ["License verification", body.licenseVerificationLink],
    ["Estimated size", body.estimatedSize || "(not given)"],
    ["Description", body.description],
    ["Newsletter opt-in", body.newsletterOptIn ? "YES" : "no"],
    ["Language", languageLine(body)],
  ];

  await sendNotification(res, {
    heading: "New Tranquilo submission",
    subject: `New Tranquilo submission: ${body.collectionName}`,
    replyTo: body.submitterEmail,
    rows: rows,
  });
}
