// Automated monthly/quarterly analytics summary, posted to a Linear
// document. Two Vercel Cron entries hit this same path with a
// different `days`/`label` query param rather than two functions.
//
// Every event in analytics_events is already fully anonymous by
// construction (event_name + props JSONB + created_at only) and
// already excludes dev/team traffic upstream.
//
// Required env vars:
//   DATABASE_URL
//   CRON_SECRET     -- Vercel sends it back as `Authorization: Bearer
//                       <value>` on a configured cron path, proving the
//                       request came from Vercel's dispatcher.
//   LINEAR_API_KEY  -- sent as a bare Authorization header (no "Bearer"
//                       prefix) to api.linear.app/graphql.

import * as Sentry from "@sentry/node";
import { getSql } from "../db.ts";
import { reportError } from "../sentry.ts";
import * as sourceHealth from "../source-health.ts";
import { imageFetchHeaders } from "../source-identity.ts";

const LINEAR_DOC_ID = "2c5a75f9-7ad3-448b-a942-ee84779f3af9"; // "Analytics Reports" doc

const SOURCES = ["met", "smithsonian", "cleveland", "commons", "europeana"];
const IMAGE_FETCH_TIMEOUT_MS = 15000;

function mdTable(rows: any[], headers: any[]) {
  if (!rows.length) return "_(none)_\n";
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];
  rows.forEach((r: any) => {
    lines.push(
      `| ${r.map((v: any) => (v === null || v === undefined ? "" : String(v))).join(" | ")} |`,
    );
  });
  return `${lines.join("\n")}\n`;
}

// Pure and DB-free, unit-testable without mocking `client`. Rule-based
// rather than an LLM summary -- every sentence restates a computed
// number, since a wrong "pattern" asserted with confidence is worse
// than no narrative.
//
// MIN_PRIOR_SAMPLE: below this, a percentage swing is noise (5 events
// becoming 10 reads as "+100%" and means nothing).
const MIN_PRIOR_SAMPLE = 20;
// A swing smaller than this reads as "held steady".
const NOTABLE_PCT = 15;

function pctChange(cur: any, prev: any) {
  if (prev === 0) return cur === 0 ? 0 : null; // null: "undefined", not "infinite"
  return ((cur - prev) / prev) * 100;
}

function describeChange(pct: any) {
  if (pct === null) return "new this period (none in the previous one)";
  const rounded = Math.round(pct);
  if (Math.abs(rounded) < NOTABLE_PCT)
    return `held roughly steady (${rounded >= 0 ? "+" : ""}${rounded}%)`;
  return `${rounded > 0 ? `up ${rounded}%` : `down ${Math.abs(rounded)}%`} from the previous period`;
}

function countsByKey(rows: any[], keyField: any) {
  const out: any = {};
  rows.forEach((r: any) => {
    out[r[keyField]] = Number(r.n);
  });
  return out;
}

function buildPatternsNarrative(current: any, previous: any) {
  const curTotal = Number(current.total.count);
  const prevTotal = Number(previous.total.count);
  const lines = [];

  if (prevTotal < MIN_PRIOR_SAMPLE) {
    lines.push(
      `Not enough prior-period data yet to compare trends (${
        prevTotal
      } event(s) in the previous period, under the ${MIN_PRIOR_SAMPLE}-event threshold this needs). ` +
        `This period recorded ${curTotal} total event(s). Trend comparisons start from the next report.`,
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `Total engagement ${describeChange(
      pctChange(curTotal, prevTotal),
    )} (${curTotal} vs ${prevTotal} event(s) the previous period).`,
  );

  const curByType = countsByKey(current.byType, "event_name");
  const prevByType = countsByKey(previous.byType, "event_name");
  const typeNames = Object.keys(Object.assign({}, curByType, prevByType));
  const movers = typeNames
    .map((name: any) => {
      const cur = curByType[name] || 0,
        prev = prevByType[name] || 0;
      return {
        name: name,
        cur: cur,
        prev: prev,
        delta: cur - prev,
        combined: cur + prev,
      };
    })
    // Same noise floor as MIN_PRIOR_SAMPLE, scaled down per event type.
    .filter((m: any) => m.combined >= 5 && m.delta !== 0)
    .sort((a: any, b: any) => b.delta - a.delta);

  if (movers.length) {
    const gainer = movers[0];
    if (gainer.delta > 0) {
      lines.push(
        `\`${gainer.name}\` grew the most: ${gainer.cur} vs ${gainer.prev} (${describeChange(
          pctChange(gainer.cur, gainer.prev),
        )}).`,
      );
    }
    const decliner = movers[movers.length - 1];
    if (decliner.delta < 0 && decliner.name !== gainer.name) {
      lines.push(
        `\`${decliner.name}\` fell the most: ${decliner.cur} vs ${decliner.prev} (${describeChange(
          pctChange(decliner.cur, decliner.prev),
        )}).`,
      );
    }
  }

  const curByCat = countsByKey(current.byCategory, "category");
  const prevByCat = countsByKey(previous.byCategory, "category");
  const catNames = Object.keys(Object.assign({}, curByCat, prevByCat));
  const catMovers = catNames
    .map((name: any) => {
      const cur = curByCat[name] || 0,
        prev = prevByCat[name] || 0;
      return {
        name: name,
        cur: cur,
        prev: prev,
        delta: cur - prev,
        combined: cur + prev,
      };
    })
    .filter((m: any) => m.combined >= 5 && m.delta !== 0)
    .sort((a: any, b: any) => Math.abs(b.delta) - Math.abs(a.delta));

  if (catMovers.length) {
    const topCat = catMovers[0];
    lines.push(
      `Category filter clicks on **${topCat.name}** ${describeChange(
        pctChange(topCat.cur, topCat.prev),
      )} (${topCat.cur} vs ${topCat.prev}).`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function getDatabaseSizeMB(client: any) {
  const rows = await client.query(
    "SELECT pg_database_size(current_database()) AS bytes",
  );
  return Math.round(Number(rows[0].bytes) / 1024 / 1024);
}

// Same technique health-check.ts uses, but keeps the raw millisecond
// timing instead of collapsing to pass/fail -- this needs "is it
// trending slower", not just "is it down".
async function sampleSourceLatency(client: any) {
  const results: any[] = [];
  const held = await sourceHealth.heldSourceSet(client, SOURCES);
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i];
    if (held[source]) {
      results.push([source, `skipped -- ${held[source]}`, null]);
      continue;
    }
    const rows = await client.query(
      "SELECT img FROM items WHERE source = $1 ORDER BY random() LIMIT 2",
      [source],
    );
    for (let j = 0; j < rows.length; j++) {
      const url = rows[j].img;
      if (!url) continue;
      const started = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, IMAGE_FETCH_TIMEOUT_MS);
        const resp = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: imageFetchHeaders(source),
        });
        clearTimeout(timeoutId);
        results.push([
          source,
          resp.ok ? "ok" : `HTTP ${resp.status}`,
          Date.now() - started,
        ]);
      } catch (err) {
        results.push([
          source,
          (err as any).name === "AbortError" ? "timed out" : "failed",
          Date.now() - started,
        ]);
      }
    }
  }
  return results;
}

async function buildReportMarkdown(client: any, days: any, label: any) {
  const interval = `${days} days`;

  const dbSizeMB = await getDatabaseSizeMB(client);
  const latencySamples = await sampleSourceLatency(client);

  // Page loads alongside raw count -- one client once produced 10,476
  // of these, which a raw count alone would present as visitor impact.
  const imageFailuresBySource = await client.query(
    "SELECT props->>'source' AS source, count(*) AS n, " +
      "count(DISTINCT coalesce(props->>'page_load', 'legacy')) AS page_loads " +
      "FROM analytics_events " +
      "WHERE event_name = 'image_load_failed' AND created_at >= now() - $1::interval GROUP BY 1 ORDER BY n DESC",
    [interval],
  );

  const totalRows = await client.query(
    "SELECT count(*), min(created_at), max(created_at) FROM analytics_events WHERE created_at >= now() - $1::interval",
    [interval],
  );
  const total = totalRows[0];

  const byType = await client.query(
    "SELECT event_name, count(*) AS n FROM analytics_events WHERE created_at >= now() - $1::interval GROUP BY event_name ORDER BY n DESC",
    [interval],
  );

  const byCategory = await client.query(
    "SELECT props->>'category' AS category, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'category_filter' AND created_at >= now() - $1::interval GROUP BY 1 ORDER BY n DESC",
    [interval],
  );

  // Compared against the immediately preceding period of the same
  // length -- a monthly report compares trailing 30 vs. the 30 before.
  const prevTotalRows = await client.query(
    "SELECT count(*) FROM analytics_events WHERE created_at >= now() - $1::interval * 2 AND created_at < now() - $1::interval",
    [interval],
  );
  const prevTotal = prevTotalRows[0];
  const prevByType = await client.query(
    "SELECT event_name, count(*) AS n FROM analytics_events " +
      "WHERE created_at >= now() - $1::interval * 2 AND created_at < now() - $1::interval GROUP BY event_name",
    [interval],
  );
  const prevByCategory = await client.query(
    "SELECT props->>'category' AS category, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'category_filter' AND created_at >= now() - $1::interval * 2 " +
      "AND created_at < now() - $1::interval GROUP BY 1",
    [interval],
  );

  const musicToggle = await client.query(
    "SELECT props->>'on' AS on, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'music_toggle' AND created_at >= now() - $1::interval GROUP BY 1 ORDER BY 1 DESC",
    [interval],
  );

  const discoverOpens = await client.query(
    "SELECT count(*) AS n FROM analytics_events WHERE event_name = 'discover_open' AND created_at >= now() - $1::interval",
    [interval],
  );

  // Collections are anonymous localStorage with no visitor id, so
  // "average collection size" can't be reconstructed from existing
  // events -- collection_view_open reports collectionCount() at the
  // moment someone opens the view, answering both opens and avg size
  // from one event (forward-looking only).
  const collectionViews = await client.query(
    "SELECT count(*) AS n, avg((props->>'count')::numeric) AS avg_count FROM analytics_events " +
      "WHERE event_name = 'collection_view_open' AND created_at >= now() - $1::interval",
    [interval],
  );

  const mostShared = await client.query(
    "SELECT i.title, i.artist, i.source, count(*) AS shares FROM analytics_events ae " +
      "JOIN items i ON i.source = ae.props->>'source' AND i.native_id = ae.props->>'id' " +
      "WHERE ae.event_name = 'share_click' AND ae.created_at >= now() - $1::interval " +
      "GROUP BY i.title, i.artist, i.source ORDER BY shares DESC LIMIT 10",
    [interval],
  );

  const storylineOpens = await client.query(
    "SELECT props->>'storyline_id' AS storyline_id, count(*) AS opens FROM analytics_events " +
      "WHERE event_name = 'storyline_open' AND created_at >= now() - $1::interval GROUP BY 1",
    [interval],
  );
  const storylineChapters = await client.query(
    "SELECT props->>'storyline_id' AS storyline_id, " +
      "count(*) FILTER (WHERE (props->>'position')::int = 1) AS reached_ch1, " +
      "count(DISTINCT props->>'position') AS distinct_chapters_seen " +
      "FROM analytics_events WHERE event_name = 'storyline_chapter_view' AND created_at >= now() - $1::interval GROUP BY 1",
    [interval],
  );
  const opensById: any = {};
  storylineOpens.forEach((r: any) => {
    opensById[r.storyline_id] = r.opens;
  });
  const storylineRows = storylineChapters.map((r: any) => [
    r.storyline_id,
    opensById[r.storyline_id] || 0,
    r.reached_ch1,
    r.distinct_chapters_seen,
  ]);

  const search = await client.query(
    "SELECT event_name, count(*) AS n FROM analytics_events " +
      "WHERE event_name IN ('search_submit', 'search_zero_results') AND created_at >= now() - $1::interval GROUP BY event_name",
    [interval],
  );

  // Grouped case-insensitively so "shakespeare" and "Shakespeare" don't
  // split one term's count; min() picks one representative spelling.
  const topSearchTerms = await client.query(
    "SELECT min(props->>'query') AS term, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'search_submit' AND coalesce(props->>'query', '') != '' " +
      "AND created_at >= now() - $1::interval GROUP BY lower(trim(props->>'query')) ORDER BY n DESC LIMIT 20",
    [interval],
  );
  // The zero-result half is the most direct signal for what to acquire
  // more of -- what visitors wanted and the catalogue couldn't show.
  const topZeroResultTerms = await client.query(
    "SELECT min(props->>'query') AS term, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'search_zero_results' AND coalesce(props->>'query', '') != '' " +
      "AND created_at >= now() - $1::interval GROUP BY lower(trim(props->>'query')) ORDER BY n DESC LIMIT 20",
    [interval],
  );

  const detailByTea = await client.query(
    "SELECT props->>'tea_voice_status' AS status, count(*) AS n FROM analytics_events " +
      "WHERE event_name = 'detail_view' AND created_at >= now() - $1::interval GROUP BY 1 ORDER BY n DESC",
    [interval],
  );

  const now = new Date();
  const heading = `${label} Report — ${now.toISOString().slice(0, 10)} (trailing ${days} days)`;

  let md = `## ${heading}\n\n`;
  md += `**Patterns this period**\n\n${buildPatternsNarrative(
    { total: total, byType: byType, byCategory: byCategory },
    { total: prevTotal, byType: prevByType, byCategory: prevByCategory },
  )}\n`;
  md += `**Neon database size:** ${dbSizeMB}MB (of 500MB free-tier cap)\n\n`;
  md += `**Per-source image reachability (live sample, this run)**\n\n${mdTable(
    latencySamples.map((r: any) => [r[0], r[1], `${r[2]}ms`]),
    ["source", "result", "latency"],
  )}\n`;
  md += `**image_load_failed events, by source (trailing ${days} days)**\n\n${mdTable(
    imageFailuresBySource.map((r: any) => [r.source, r.n, r.page_loads]),
    ["source", "count", "page loads"],
  )}\n`;
  md += `${total.count} total event(s)${total.count > 0 ? `, ${total.min} to ${total.max}` : ""}\n\n`;
  md += `**Events by type**\n\n${mdTable(
    byType.map((r: any) => [r.event_name, r.n]),
    ["event_name", "count"],
  )}\n`;
  md += `**Category filter clicks, by category**\n\n${mdTable(
    byCategory.map((r: any) => [r.category, r.n]),
    ["category", "count"],
  )}\n`;
  md += `**Music toggle**\n\n${mdTable(
    musicToggle.map((r: any) => [r.on, r.n]),
    ["on", "count"],
  )}\n`;
  md += `**Discover (Explore) opens:** ${discoverOpens[0].n}\n\n`;
  md += `**My Collection opens:** ${
    collectionViews[0].n
  } (avg size at time of viewing: ${
    collectionViews[0].avg_count === null
      ? "n/a"
      : Number(collectionViews[0].avg_count).toFixed(1)
  } item(s))\n\n`;
  md += `**Most-shared artwork (top 10)**\n\n${mdTable(
    mostShared.map((r: any) => [r.title, r.artist, r.source, r.shares]),
    ["title", "artist", "source", "shares"],
  )}\n`;
  md += `**Storyline engagement (opens vs. chapters reached)**\n\n${mdTable(storylineRows, ["storyline_id", "opens", "reached_ch1", "distinct_chapters_seen"])}\n`;
  md += `**Search**\n\n${mdTable(
    search.map((r: any) => [r.event_name, r.n]),
    ["event_name", "count"],
  )}\n`;
  md += `**Top search terms**\n\n${mdTable(
    topSearchTerms.map((r: any) => [r.term, r.n]),
    ["term", "count"],
  )}\n`;
  md += `**Top zero-result search terms** (wanted, not found -- a signal for what to acquire)\n\n${mdTable(
    topZeroResultTerms.map((r: any) => [r.term, r.n]),
    ["term", "count"],
  )}\n`;
  md += `**Detail views, by Tea Voice status**\n\n${mdTable(
    detailByTea.map((r: any) => [r.status, r.n]),
    ["tea_voice_status", "count"],
  )}\n`;
  // Rides the quarterly report rather than a new cron -- api/ sits at
  // Vercel Hobby's 12-function cap.
  if (label === "Quarterly") {
    md +=
      "### Quarterly restore drill is due\n\n" +
      "Verifying the restore path every quarter, because a backup nobody " +
      "has restored is a hypothesis. Roughly 20 minutes:\n\n" +
      "1. Create a throwaway Neon branch (free, instant).\n" +
      "2. Point `DATABASE_URL` at it and run " +
      "`scripts/restore_from_backup.py --commit` against the latest backup.\n" +
      "3. Check the row count matches live, and spot-check one item with " +
      "`cast` / `cast_context` / `storyline_ids` populated.\n" +
      "4. Delete the branch.\n\n";
  }
  md += "---\n";
  return md;
}

async function linearGraphQL(query: any, variables?: any) {
  const resp = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.LINEAR_API_KEY || "",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json();
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function appendToLinearDoc(newSection: any) {
  const current = await linearGraphQL(
    "query($id: String!) { document(id: $id) { content } }",
    { id: LINEAR_DOC_ID },
  );
  const updatedContent = `${current.document.content}\n${newSection}`;
  await linearGraphQL(
    "mutation($id: String!, $content: String!) { documentUpdate(id: $id, input: { content: $content }) { success } }",
    { id: LINEAR_DOC_ID, content: updatedContent },
  );
}

// Two monitor slugs, not one: a single slug would let three monthly
// successes keep it green while the quarterly silently never fired.
// Keyed off the same `label` param the report uses, so the monitor and
// the report can't disagree about which run this is.
const MONITORS: any = {
  Monthly: { slug: "analytics-report-monthly", schedule: "7 9 1 * *" },
  Quarterly: {
    slug: "analytics-report-quarterly",
    schedule: "11 9 1 1,4,7,10 *",
  },
};

function monitorFor(label: any) {
  const m = MONITORS[label];
  if (!m) return null; // an unrecognised label is a manual run, not a cron
  return {
    slug: m.slug,
    config: {
      schedule: { type: "crontab" as const, value: m.schedule },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: "UTC",
    },
  };
}

export default async function handler(req: any, res: any) {
  const auth = req.headers.authorization || "";
  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    res.statusCode = 401;
    res.json({ error: "Unauthorized" });
    return;
  }

  // Permanent, not a debug hack -- confirms LINEAR_API_KEY authenticates
  // without waiting on the next scheduled run to find out. Same
  // CRON_SECRET auth, no report generation or doc posting.
  if (req.query.healthcheck) {
    if (!process.env.LINEAR_API_KEY) {
      res.statusCode = 200;
      res.json({ ok: false, reason: "LINEAR_API_KEY not set" });
      return;
    }
    try {
      await linearGraphQL("query { viewer { id } }");
      res.statusCode = 200;
      res.json({ ok: true });
    } catch (_err) {
      res.statusCode = 200;
      res.json({ ok: false, reason: "Linear API rejected the configured key" });
    }
    return;
  }

  const days = parseInt(req.query.days, 10) || 30;
  const label = req.query.label || "Report";

  // A manual run with no recognised label gets no monitor -- checking
  // in against a schedule it isn't on would make Sentry expect runs
  // that never come.
  const monitor = monitorFor(label);
  const checkInId = monitor
    ? Sentry.captureCheckIn(
        { monitorSlug: monitor.slug, status: "in_progress" },
        monitor.config,
      )
    : null;

  function checkIn(status: any) {
    if (monitor && checkInId) {
      Sentry.captureCheckIn(
        { checkInId: checkInId, monitorSlug: monitor.slug, status: status },
        monitor.config,
      );
    }
  }

  const client = getSql();
  if (!client) {
    console.error("analytics-report: missing DATABASE_URL env var");
    res.statusCode = 500;
    res.json({ error: "Database isn't configured" });
    return;
  }
  if (!process.env.LINEAR_API_KEY) {
    console.error("analytics-report: missing LINEAR_API_KEY env var");
    res.statusCode = 500;
    res.json({ error: "Linear isn't configured" });
    return;
  }

  try {
    const section = await buildReportMarkdown(client, days, label);
    await appendToLinearDoc(section);
    // Flushed before the response, not merely before returning --
    // Sentry's transport freezes with the function once the platform
    // has the response.
    checkIn("ok");
    await Sentry.flush(2000);
    res.statusCode = 200;
    res.json({ ok: true });
  } catch (err) {
    console.error("analytics-report: failed", err);
    await reportError(err);
    checkIn("error");
    res.statusCode = 500;
    res.json({ error: "Report generation or posting failed" });
  }
}

// Exposed for tests -- pure, DB-free logic.
export { buildPatternsNarrative, sampleSourceLatency };
