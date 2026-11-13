import type { VercelRequest, VercelResponse } from '@vercel/node';

const routes: Record<string, () => Promise<{ default: (req: VercelRequest, res: VercelResponse) => unknown }>> = {
  "GET /api/items": () => import("./items.ts"),
  "POST /api/submit-collection": () => import("./submit-collection.ts"),
  "POST /api/subscribe": () => import("./subscribe.ts"),
  "POST /api/track": () => import("./track.ts"),
  "POST /api/webhooks/resend": () => import("./webhooks/resend.ts"),
  "POST /api/webhooks/patreon": () => import("./webhooks/patreon.ts"),
  "GET /sitemap.xml": () => import("./sitemap.ts"),
  "GET /v/{slug}": () => import("./v/[slug].ts"),
  "GET /s/{slug}": () => import("./v/[slug].ts"),
  "GET /img/{source}/{id}/{tier}": () => import("./img/[source]/[id]/[tier].ts"),
  "GET /og/{slug}.png": () => import("./og/[slug].ts"),
/*
  "GET /__ping": () => Promise.resolve({
    default: async (req, res) => res.status(200).json({ ok: true })
  }),
  "GET /__db": () => Promise.resolve({
    default: async (req, res) => {
      const started = Date.now();
      const { getSql } = await import("../lib/db.ts");
      const sql = getSql();
      if (!sql) return res.status(500).json({ error: "no DATABASE_URL" });
      try {
        const rows = await Promise.race([
          sql.query("select 1 as ok"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout after 5s")), 5000)),
        ]);
        return res.status(200).json({ rows, ms: Date.now() - started });
      } catch (error) {
        return res.status(500).json({ error: String(error), ms: Date.now() - started });
      }
    }
  }),
  "GET /__probe": () => Promise.resolve({
    default: async (req, res) => {
      const marks: string[] = [];
      const started = Date.now();
      const step = async (name: string, run: () => Promise<unknown>) => {
        const result = await Promise.race([
          run().then(() => "ok", (error) => `error: ${String(error)}`),
          new Promise((resolve) => setTimeout(() => resolve("timeout"), 3000)),
        ]);
        marks.push(`${name}: ${result} @${Date.now() - started}ms`);
      };
      const { getSql } = await import("../lib/db.ts");
      const { LIVE_ITEMS_WHERE } = await import("../lib/items-sql.ts");
      await step("count", async () => {
        const rows = await getSql()!.query(`SELECT count(*) AS n FROM items ${LIVE_ITEMS_WHERE}`);
        marks.push(`rows: ${JSON.stringify(rows)}`);
      });
      await step("sentry import", () => import("../lib/sentry.ts"));
      await step("hreflang import", () => import("../lib/sitemap-hreflang.ts"));
      return res.status(200).json({ marks });
    }
  }),
  */
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const script = routes[`${req.method} ${req.query.path}`];

  if (script) {
    const mod = await script();
    return await mod.default(req, res);
  }

  return res.status(404)
    .json({ error: "Not found" });
}
