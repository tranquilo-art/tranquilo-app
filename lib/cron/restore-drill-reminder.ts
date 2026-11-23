// Quarterly reminder that a database restore drill is due. A backup nobody
// has restored is a hypothesis, so the disaster-recovery runbook commits to
// actually restoring one every quarter; this cron is what makes that
// commitment show up in someone's inbox instead of relying on memory.
//
// Emails the maintainer via Resend. Unlike health-check's alert email, a
// failed send is reported as a 500 rather than swallowed: this email is the
// only output, so a silent failure would mean the drill quietly never
// happens. Has no Sentry cron monitor: monitors are a billed quota, and a
// missed quarterly reminder is cheap to notice.
//
// Required env vars: CRON_SECRET, RESEND_API_KEY, and OPS_ALERT_EMAIL or
// SUBMIT_NOTIFY_EMAIL.
import type { CronRequest, CronResponse } from "../cron-types.ts";
import { reportError } from "../sentry.ts";

const SUBJECT = "Tranquilo: quarterly restore drill is due";

const BODY =
  "Time for the quarterly restore drill -- verifying the restore path, " +
  "because a backup nobody has restored is a hypothesis. Roughly 20 minutes:\n\n" +
  "1. Create a throwaway Neon branch (free, instant).\n" +
  "2. Point DATABASE_URL at it and restore the latest backup into it, " +
  "following the disaster-recovery runbook.\n" +
  "3. Check the row count matches live, and spot-check one item with " +
  "cast / cast_context / storyline_ids populated.\n" +
  "4. Delete the branch.\n";

export default async function handler(req: CronRequest, res: CronResponse) {
  const auth = req.headers?.authorization || "";
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    return;
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    const notifyEmail =
      process.env.OPS_ALERT_EMAIL || process.env.SUBMIT_NOTIFY_EMAIL;
    const fromEmail =
      process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";
    if (!apiKey || !notifyEmail) {
      throw new Error("Email not configured (RESEND_API_KEY / notify address)");
    }

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: SUBJECT,
        text: BODY,
      }),
    });
    if (!resp.ok) throw new Error(`Resend responded ${resp.status}`);

    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "restore-drill-reminder failed, see Sentry" });
  }
}
