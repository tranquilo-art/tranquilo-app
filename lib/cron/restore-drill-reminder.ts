// Quarterly reminder that a database restore drill is due. A backup nobody
// has restored is a hypothesis, so the disaster-recovery runbook commits to
// actually restoring one every quarter; this cron is what makes that
// commitment show up in someone's inbox instead of relying on memory.
//
// Emails the maintainer via Resend. Unlike health-check's alert email, a
// failed send is reported as a 500 rather than swallowed: this email is the
// only output, so a silent failure would mean the drill quietly never
// happens. The Sentry cron monitor covers the other silent failure -- the
// schedule itself not firing.
//
// Required env vars: CRON_SECRET, RESEND_API_KEY, and OPS_ALERT_EMAIL or
// SUBMIT_NOTIFY_EMAIL.
import * as Sentry from "@sentry/node";
import { isCronAuthorized } from "../cron-auth.ts";
import type { CronRequest, CronResponse } from "../cron-types.ts";
import { reportError } from "../sentry.ts";

const MONITOR_SLUG = "restore-drill-reminder";
const CRON_SCHEDULE = "11 9 1 1,4,7,10 *";
function monitorConfig() {
  return {
    schedule: { type: "crontab" as const, value: CRON_SCHEDULE },
    checkinMargin: 60,
    maxRuntime: 5,
    timezone: "UTC",
  };
}

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
  if (!isCronAuthorized(req)) {
    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    return;
  }

  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: MONITOR_SLUG, status: "in_progress" },
    monitorConfig(),
  );

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

    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "ok" },
      monitorConfig(),
    );
    await Sentry.flush(2000);

    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureCheckIn(
      { checkInId: checkInId, monitorSlug: MONITOR_SLUG, status: "error" },
      monitorConfig(),
    );
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "restore-drill-reminder failed, see Sentry" });
  }
}
