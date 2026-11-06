import { describe, expect, it } from "vitest";
import { quoteAddressFor, quotePrint } from "../lib/gelato-quote.ts";

function quoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    quotes: [
      {
        productionCountry: "DE",
        products: [{ price: 12.13 }],
        shipmentMethods: [
          {
            name: "Standard",
            price: 6.5,
            minDeliveryDays: 5,
            maxDeliveryDays: 9,
          },
          {
            name: "Express",
            price: 14.2,
            minDeliveryDays: 2,
            maxDeliveryDays: 3,
          },
        ],
        ...overrides,
      },
    ],
  };
}

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const base = { productUid: "mug_uid", country: "BR", apiKey: "k" };

describe("quoting a print", () => {
  it("returns the item price and the cheapest delivery", async () => {
    const { impl } = fakeFetch(quoteResponse());
    const quote = await quotePrint({ ...base, fetchImpl: impl });
    expect(quote).toEqual({
      itemPrice: 12.13,
      delivery: 6.5,
      currency: "USD",
      minDays: 5,
      maxDays: 9,
      madeIn: "DE",
    });
  });

  it("is unavailable when no delivery method has a price", async () => {
    const { impl } = fakeFetch(
      quoteResponse({
        shipmentMethods: [{ name: "x", price: null, minDeliveryDays: 1 }],
      }),
    );
    expect(await quotePrint({ ...base, fetchImpl: impl })).toBeNull();
  });

  it("is unavailable when Gelato returns no quote", async () => {
    const { impl } = fakeFetch({ quotes: [] });
    expect(await quotePrint({ ...base, fetchImpl: impl })).toBeNull();
  });

  it("sends the key, an identifying user agent and a country-level address", async () => {
    const { impl, calls } = fakeFetch(quoteResponse());
    await quotePrint({ ...base, fetchImpl: impl });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("k");
    expect(headers["User-Agent"]).toMatch(/^TranquiloBot\//);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.recipient.country).toBe("BR");
    expect(body.products[0].productUid).toBe("mug_uid");
    expect(body.products[0].quantity).toBe(1);
  });

  it("asks Gelato for the currency it is given", async () => {
    const { impl, calls } = fakeFetch(quoteResponse());
    const quote = await quotePrint({
      ...base,
      currency: "BRL",
      fetchImpl: impl,
    });
    expect(JSON.parse(String(calls[0].init.body)).currency).toBe("BRL");
    expect(quote?.currency).toBe("BRL");
  });

  it("quotes in US dollars unless told otherwise", async () => {
    const { impl, calls } = fakeFetch(quoteResponse());
    await quotePrint({ ...base, fetchImpl: impl });
    expect(JSON.parse(String(calls[0].init.body)).currency).toBe("USD");
  });

  it("throws when Gelato errors, so a failure is not read as unavailable", async () => {
    const { impl } = fakeFetch({ message: "boom" }, 500);
    await expect(quotePrint({ ...base, fetchImpl: impl })).rejects.toThrow();
  });
});

describe("the representative address for a country", () => {
  it("exists for every launch country", async () => {
    const { TRANQUILO_CONFIG } = await import("../lib/config.generated.ts");
    const regions = TRANQUILO_CONFIG["print.regions"] as Record<string, string>;
    const countries = Object.values(regions).flatMap((codes) =>
      codes.split(",").map((c) => c.trim()),
    );
    for (const code of countries) {
      expect(quoteAddressFor(code), code).not.toBeNull();
    }
  });

  it("is absent outside the launch countries", () => {
    expect(quoteAddressFor("JP")).toBeNull();
    expect(quoteAddressFor("")).toBeNull();
  });
});
