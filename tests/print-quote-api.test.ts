import type { VercelRequest, VercelResponse } from "@vercel/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../api/items.ts";
import type { PrintQuote } from "../lib/gelato-quote.ts";
import { priceQuote } from "../lib/print-pricing.ts";
import { handlePrintQuote } from "../lib/print-quote-api.ts";

const ITEM = {
  source: "met",
  native_id: "123",
  license: "cc0",
  master_width: 3192,
  master_height: 4000,
};

function fakeSql(item: Record<string, unknown> | null, allowed = true) {
  const queries: string[] = [];
  return {
    queries,
    async query(text: string) {
      queries.push(text);
      if (text.includes("visitor_fetch_state")) {
        return allowed ? [{ tokens: 5 }] : [];
      }
      if (text.includes("FROM items")) return item ? [item] : [];
      return [];
    },
  };
}

function mockRes() {
  return {
    statusCode: 200,
    body: {} as Record<string, unknown>,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    json(payload: Record<string, unknown>) {
      this.body = payload;
      return this;
    },
  };
}

const GELATO = {
  itemPrice: 12.13,
  delivery: 4.9,
  currency: "USD",
  minDays: 5,
  maxDays: 9,
  madeIn: "US",
};

async function call(
  query: Record<string, string>,
  opts: {
    item?: Record<string, unknown> | null;
    allowed?: boolean;
    quote?: (args: {
      productUid: string;
      country: string;
      currency: string;
    }) => Promise<PrintQuote | null>;
    apiKey?: string | undefined;
  } = {},
) {
  const res = mockRes();
  const calls: { productUid: string; country: string; currency: string }[] = [];
  const quote =
    opts.quote ??
    (async (args: {
      productUid: string;
      country: string;
      currency: string;
    }) => {
      calls.push(args);
      return GELATO;
    });
  await handlePrintQuote(
    {
      method: "GET",
      query,
      headers: { "x-forwarded-for": "203.0.113.7" },
    } as unknown as VercelRequest,
    res as unknown as VercelResponse,
    {
      sql: fakeSql(opts.item === undefined ? ITEM : opts.item, opts.allowed),
      quote,
      apiKey: "apiKey" in opts ? opts.apiKey : "k",
    },
  );
  return { res, calls };
}

const GOOD = { key: "met:123", product: "poster", country: "US" };

let savedSecret: string | undefined;
beforeAll(() => {
  savedSecret = process.env.ITEMS_CURSOR_SECRET;
  process.env.ITEMS_CURSOR_SECRET = "test-secret";
});
afterAll(() => {
  if (savedSecret === undefined) delete process.env.ITEMS_CURSOR_SECRET;
  else process.env.ITEMS_CURSOR_SECRET = savedSecret;
});

describe("?shape=print_quote", () => {
  it("quotes a sellable artwork in the buyer's country", async () => {
    const { res, calls } = await call(GOOD);
    expect(res.statusCode).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.total).toBeGreaterThan(17.03);
    expect(res.body.delivery).toBe(4.9);
    expect(res.body.currency).toBe("USD");
    expect(res.body.minDays).toBe(5);
    expect(calls[0].country).toBe("US");
    expect(calls[0].productUid).toMatch(/_ver$/);
  });

  it("quotes Brazil in reais and everywhere else in dollars", async () => {
    const seen: string[] = [];
    const quote = async (args: { currency: string }) => {
      seen.push(args.currency);
      return GELATO;
    };
    await call({ ...GOOD, product: "mug", country: "BR" }, { quote });
    await call(GOOD, { quote });
    expect(seen).toEqual(["BRL", "USD"]);
  });

  it("prices Brazil at a 5% card fee and other countries at 7%", async () => {
    const br = await call({ ...GOOD, product: "mug", country: "BR" });
    const us = await call(GOOD);
    expect(br.res.body.total).toBe(
      priceQuote(GELATO, { margin: 0.3, cardFee: 0.05 }).total,
    );
    expect(us.res.body.total).toBe(
      priceQuote(GELATO, { margin: 0.3, cardFee: 0.07 }).total,
    );
  });

  it("picks the landscape product for a wide artwork", async () => {
    const { calls } = await call(GOOD, {
      item: { ...ITEM, master_width: 4000, master_height: 3000 },
    });
    expect(calls[0].productUid).toMatch(/_hor$/);
  });

  it("rejects a malformed key, product or country", async () => {
    for (const bad of [
      { ...GOOD, key: "nocolon" },
      { ...GOOD, key: undefined },
      { ...GOOD, product: "canvas" },
      { ...GOOD, product: undefined },
      { ...GOOD, country: "USA" },
      { ...GOOD, country: undefined },
    ]) {
      const { res } = await call(bad as Record<string, string>);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it("refuses an artwork that may not be sold", async () => {
    const { res, calls } = await call(GOOD, {
      item: { ...ITEM, license: "cc-by-4.0" },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses an artwork that is not in the catalogue", async () => {
    const { res } = await call(GOOD, { item: null });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a product the region does not offer", async () => {
    const { res, calls } = await call({
      ...GOOD,
      product: "mini_print",
      country: "BR",
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses a product the image is too small for", async () => {
    const { res } = await call(GOOD, {
      item: { ...ITEM, master_width: 1600, master_height: 2000 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a country outside the launch regions", async () => {
    const { res } = await call({ ...GOOD, country: "JP" });
    expect(res.statusCode).toBe(404);
  });

  it("reports a product Gelato cannot deliver there as unavailable", async () => {
    const { res } = await call(GOOD, { quote: async () => null });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ available: false });
  });

  it("fails with a gateway error when Gelato errors", async () => {
    const { res } = await call(GOOD, {
      quote: async () => {
        throw new Error("boom");
      },
    });
    expect(res.statusCode).toBe(502);
  });

  it("fails when the Gelato key is not configured", async () => {
    const { res } = await call(GOOD, { apiKey: undefined });
    expect(res.statusCode).toBe(500);
  });

  it("is rate limited per visitor", async () => {
    const { res, calls } = await call(GOOD, { allowed: false });
    expect(res.statusCode).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("allows only GET", async () => {
    const res = mockRes();
    await handlePrintQuote(
      { method: "POST", query: GOOD, headers: {} } as unknown as VercelRequest,
      res as unknown as VercelResponse,
      {
        sql: fakeSql(ITEM),
        quote: async () => GELATO,
        apiKey: "k",
      },
    );
    expect(res.statusCode).toBe(405);
  });
});

describe("the print_quote shape on /api/items", () => {
  it("is dispatched, so a bad request is a 400 rather than a catalogue error", async () => {
    const res = mockRes();
    await handler(
      {
        method: "GET",
        query: { shape: "print_quote" },
        headers: {},
      } as unknown as VercelRequest,
      res as unknown as VercelResponse,
    );
    expect(res.statusCode).toBe(400);
  });
});
