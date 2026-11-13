import Bun from "bun";
import type { VercelRequest, VercelResponse } from '@vercel/node';

const routes: Record<string, string> = {
    "GET /api/items": "./api/items.ts",
    "POST /api/submit-collection": "./api/submit-collection.ts",
    "POST /api/subscribe": "./api/subscribe.ts",
    "POST /api/track": "./api/track.ts",
    "POST /api/webhooks/resend": "./api/webhooks/resend.ts",
    "POST /api/webhooks/patreon": "./api/webhooks/patreon.ts",
    "GET /sitemap.xml": "./api/sitemap.ts",
    "GET /v/{slug}": "./api/v/[slug].ts",
    "GET /s/{slug}": "./api/v/[slug].ts",
    "GET /img/{source}/{id}/{tier}": "./api/img/[source]/[id]/[tier].ts",
    "GET /og/{slug}.png": "./api/og/[slug].ts",
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { query, method } = req;
    const script = routes[`${method} ${query.path}`];
    if (script) {
        const mod = await import(script);
        mod.default(req, res);
    } else {
        res.status(404).json({ error: "Not found" });
    }
}
