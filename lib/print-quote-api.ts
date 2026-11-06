import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TRANQUILO_CONFIG } from "./config.generated.ts";
import type { PrintQuote } from "./gelato-quote.ts";
import type { QuerySql } from "./img-store.ts";
import { quoteRateLimitOrRespond } from "./items-rate-limit.ts";
import { LIVE_ITEMS_PREDICATE } from "./items-sql.ts";
import { markupForRegion, priceQuote } from "./print-pricing.ts";
import { gelatoProductUid, orientationOf } from "./print-products.ts";
import { regionForCountry } from "./print-region.ts";
import { createPrintRules } from "./print-rules.ts";

const rules = createPrintRules(TRANQUILO_CONFIG);
const PRODUCTS = new Set(["mini_print", "poster", "framed", "tote", "mug"]);
const COUNTRY = /^[A-Za-z]{2}$/;
const QUOTE_CURRENCY = TRANQUILO_CONFIG["print.quote_currency"] as Record<
  string,
  string
>;

interface Deps {
  sql: QuerySql | null;
  quote: (args: {
    productUid: string;
    country: string;
    currency: string;
  }) => Promise<PrintQuote | null>;
  apiKey: string | undefined;
}

const scalar = (v: unknown) => (typeof v === "string" ? v : undefined);

function fail(res: VercelResponse, status: number, error: string) {
  res.statusCode = status;
  res.json({ error });
}

export async function handlePrintQuote(
  req: VercelRequest,
  res: VercelResponse,
  { sql, quote, apiKey }: Deps,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "Method not allowed");
  }
  const key = scalar(req.query?.key);
  const product = scalar(req.query?.product);
  const country = scalar(req.query?.country);
  const cut = key ? key.indexOf(":") : -1;
  if (!key || cut <= 0 || cut === key.length - 1) {
    return fail(res, 400, "key must be source:native_id");
  }
  if (!product || !PRODUCTS.has(product)) {
    return fail(res, 400, "unknown product");
  }
  if (!country || !COUNTRY.test(country)) {
    return fail(res, 400, "country must be a two-letter code");
  }

  if (await quoteRateLimitOrRespond(sql, req, res)) return;

  const rows = sql
    ? ((await sql.query(
        `SELECT source, native_id, license, master_width, master_height FROM items WHERE ${LIVE_ITEMS_PREDICATE} AND source = $1 AND native_id = $2`,
        [key.slice(0, cut), key.slice(cut + 1)],
      )) as Record<string, unknown>[])
    : [];
  const item = rows[0] as
    | {
        license: string | null;
        source: string;
        master_width: number | null;
        master_height: number | null;
      }
    | undefined;
  const region = regionForCountry(country);
  if (!item || !rules.printOptionsFor(item, region).includes(product)) {
    return fail(res, 404, "not available");
  }

  const productUid = gelatoProductUid(
    product,
    orientationOf(item.master_width as number, item.master_height as number),
  );
  if (!productUid) return fail(res, 404, "not available");
  if (!apiKey) return fail(res, 500, "Printing isn't configured");

  let cost: PrintQuote | null;
  try {
    cost = await quote({
      productUid,
      country: country.toUpperCase(),
      currency: (region && QUOTE_CURRENCY[region]) || "USD",
    });
  } catch (_err) {
    return fail(res, 502, "Could not get a delivery quote");
  }
  res.setHeader("Cache-Control", "private, no-store");
  if (!cost) {
    res.json({ available: false });
    return;
  }
  res.json({
    available: true,
    ...priceQuote(cost, markupForRegion(region)),
    currency: cost.currency,
    minDays: cost.minDays,
    maxDays: cost.maxDays,
    madeIn: cost.madeIn,
  });
}
