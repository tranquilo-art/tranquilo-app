import type { VercelRequest, VercelResponse } from "@vercel/node";

type RouteModule = {
  default: (req: VercelRequest, res: VercelResponse) => unknown;
};

interface Route {
  load: () => Promise<RouteModule>;
  query?: (req: VercelRequest) => Record<string, string>;
}

function firstValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function pageSlug(prefix: string, ...params: string[]): Route["query"] {
  return (req) => {
    const value = params
      .map((name) => firstValue(req.query[name]))
      .find(Boolean);
    return { slug: `${prefix}${value ?? ""}` };
  };
}

const storylinePage: Route = {
  load: () => import("./v/[slug].ts"),
  query: pageSlug("s-", "id", "slug"),
};

const volunteerRedirect: Route = {
  load: async () => ({
    default: (_req, res) => res.redirect(307, "/pages/get-involved.html"),
  }),
};

const routes = new Map<string, Route>(
  Object.entries({
    "GET /api/items": { load: () => import("./items.ts") },
    "GET /v1/items": {
      load: () => import("./items.ts"),
      query: () => ({ audience: "keyed" }),
    },
    "POST /api/submit-collection": {
      load: () => import("./submit-collection.ts"),
    },
    "POST /api/subscribe": { load: () => import("./subscribe.ts") },
    "POST /api/track": { load: () => import("./track.ts") },
    "POST /api/webhooks/resend": { load: () => import("./webhooks/resend.ts") },
    "POST /api/webhooks/patreon": {
      load: () => import("./webhooks/patreon.ts"),
    },
    "GET /sitemap.xml": { load: () => import("./sitemap.ts") },
    "GET /v/{slug}": { load: () => import("./v/[slug].ts") },
    "GET /s/{id}": storylinePage,
    "GET /s/{slug}": storylinePage,
    "GET /discover": {
      load: () => import("./v/[slug].ts"),
      query: () => ({ slug: "discover" }),
    },
    "GET /category/{slug}": {
      load: () => import("./v/[slug].ts"),
      query: pageSlug("category-", "slug", "id"),
    },
    "GET /shelf/{id}": {
      load: () => import("./v/[slug].ts"),
      query: pageSlug("shelf-", "id", "slug"),
    },
    "GET /img/{source}/{id}/{tier}": {
      load: () => import("./img/[source]/[id]/[tier].ts"),
    },
    "GET /og/{slug}.png": { load: () => import("./og/[slug].ts") },
    "GET /pages/volunteer": volunteerRedirect,
    "GET /pages/volunteer.html": volunteerRedirect,
  } satisfies Record<string, Route>),
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = routes.get(`${req.method} ${req.query.path}`);

  if (route) {
    const mod = await route.load();
    if (route.query) Object.assign(req.query, route.query(req));
    return await mod.default(req, res);
  }

  return res.status(404).json({ error: "Not found" });
}
