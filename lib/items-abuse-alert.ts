// Real-time alerts for a visitor reading /api/items abnormally. Called from
// lib/items-rate-limit.ts at the moment a threshold is crossed; the daily
// digest in items-budget-alerts.ts covers what this misses.
//
// The visitor key is a daily hash with no address, so the email points at
// Vercel's firewall traffic view, where the address can be found and blocked.
import { TRANQUILO_CONFIG } from "./config.generated.ts";
import type { QuerySql } from "./img-store.ts";

const alerts = TRANQUILO_CONFIG.items_budget_alerts;
export const VISITOR_DENIED_COST_MIN = alerts.visitor_denied_cost_min;
export const VISITORS_DENIED_MIN = alerts.visitors_denied_min;
export const VISITOR_DAILY_ITEMS_MIN = alerts.visitor_daily_items_min;
export const VISITOR_ACTIVE_HOURS_MIN = alerts.visitor_active_hours_min;
export const VISITOR_ACTIVE_MIN_ITEMS = alerts.visitor_active_min_items;
export const ALERT_EMAILS_PER_HOUR = alerts.alert_emails_per_hour;

export const FIREWALL_URL = "https://vercel.com/loveycakes/artscroll/firewall";

// Below this a visitor cannot yet qualify under either volume rule.
export const VOLUME_CHECK_FLOOR = Math.min(
  VISITOR_DAILY_ITEMS_MIN,
  VISITOR_ACTIVE_MIN_ITEMS,
);

const EMAIL_TIMEOUT_MS = 3000;

export interface HeavyReader {
  spent: number;
  hoursActive: number;
}

// Sets flagged_at and returns the visitor only for the single call that finds
// them past a threshold; every later call matches nothing.
export async function flagHeavyReader(
  sql: QuerySql,
  visitor: string,
): Promise<HeavyReader | null> {
  try {
    const rows = (await sql.query(
      "UPDATE visitor_fetch_state SET flagged_at = now() " +
        " WHERE ip = $1 AND flagged_at IS NULL " +
        "   AND (spent >= $2 OR (spent >= $3 AND now() - first_seen >= make_interval(hours => $4::int))) " +
        " RETURNING spent, EXTRACT(EPOCH FROM (now() - first_seen)) / 3600 AS hours",
      [
        `items:${visitor}`,
        VISITOR_DAILY_ITEMS_MIN,
        VISITOR_ACTIVE_MIN_ITEMS,
        VISITOR_ACTIVE_HOURS_MIN,
      ],
    )) as { spent: string | number; hours: string | number }[];
    if (!rows.length) return null;
    return {
      spent: Number(rows[0].spent),
      hoursActive: Number(rows[0].hours),
    };
  } catch (_err) {
    return null;
  }
}

const HOW_TO_BLOCK =
  `The visitor key carries no address. To block: open ${FIREWALL_URL}, ` +
  `look at traffic to /api/items for the address with the most requests, ` +
  `and add a deny rule for it.`;

export function heavyReaderMessage(reader: HeavyReader) {
  return {
    subject: "Tranquilo: a visitor is reading /api/items heavily",
    text:
      `A visitor has been served ${reader.spent} items from /api/items today ` +
      `and has been active for ${reader.hoursActive.toFixed(1)} hours. ` +
      `Alert lines: ${VISITOR_DAILY_ITEMS_MIN}+ items in a day, or ` +
      `${VISITOR_ACTIVE_MIN_ITEMS}+ over ${VISITOR_ACTIVE_HOURS_MIN}+ hours.\n\n` +
      HOW_TO_BLOCK,
  };
}

export function repeatedlyRefusedMessage(deniedCost: number) {
  return {
    subject: "Tranquilo: a visitor keeps hitting the /api/items limit",
    text:
      `A visitor has been refused ${deniedCost} items on /api/items today ` +
      `(alert line: ${VISITOR_DENIED_COST_MIN}). They are past the budget and ` +
      `still asking.\n\n` +
      HOW_TO_BLOCK,
  };
}

// Best effort and bounded: it runs inside a request, so it must neither
// throw nor hold the response for long.
export async function sendOpsEmail(
  subject: string,
  text: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail =
    process.env.OPS_ALERT_EMAIL || process.env.SUBMIT_NOTIFY_EMAIL;
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "Tranquilo <onboarding@resend.dev>";
  if (!apiKey || !notifyEmail) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
  } catch (_err) {
    // The daily digest still reports the visitor.
  }
}
