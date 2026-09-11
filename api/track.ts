// Durable store for app.ts's trackEvent() calls -- Vercel Hobby only
// keeps runtime logs for 1 hour, not enough to see trends across a
// multi-day window.
//
// Writes into `analytics_events` in Neon (sql/002_analytics_events.sql)
// via @neondatabase/serverless's HTTP driver, not a pooled `pg` client
// -- a TCP pool per invocation is the connection-exhaustion problem
// serverless + Postgres is known for.
//
// Required env var: DATABASE_URL.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSql } from "../lib/db.ts";
import { reportError } from "../lib/sentry.ts";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const eventName = body.event_name;
  const props = body.props && typeof body.props === "object" ? body.props : {};

  if (!eventName || typeof eventName !== "string") {
    res.statusCode = 400;
    res.json({ error: "event_name is required" });
    return;
  }

  const client = getSql();
  if (!client) {
    console.error("track: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Analytics store isn't configured yet" });
    return;
  }

  try {
    await client(
      "INSERT INTO analytics_events (event_name, props) VALUES ($1, $2)",
      [eventName, JSON.stringify(props)],
    );
    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    // The client fires this fire-and-forget and ignores the response.
    console.error("track: insert failed", err);
    await reportError(err);
    res.statusCode = 500;
    res.json({ error: "Insert failed" });
  }
}
