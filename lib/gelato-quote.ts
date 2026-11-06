const QUOTE_URL = "https://order.gelatoapis.com/v4/orders:quote";
const USER_AGENT = "TranquiloBot/1.0 (+https://tranquilo.art)";

export interface PrintQuote {
  itemPrice: number;
  delivery: number;
  currency: string;
  minDays: number | null;
  maxDays: number | null;
  madeIn: string | null;
}

interface QuoteAddress {
  city: string;
  postCode: string;
  state?: string;
}

// Gelato prices delivery per country, not per postcode.
const ADDRESSES: Record<string, QuoteAddress> = {
  US: { city: "New York", postCode: "10001", state: "NY" },
  CA: { city: "Toronto", postCode: "M5H 2N2", state: "ON" },
  GB: { city: "London", postCode: "SW1A 1AA" },
  AU: { city: "Sydney", postCode: "2000", state: "NSW" },
  BR: { city: "Belo Horizonte", postCode: "30130-003", state: "MG" },
  AT: { city: "Vienna", postCode: "1010" },
  BE: { city: "Brussels", postCode: "1000" },
  BG: { city: "Sofia", postCode: "1000" },
  HR: { city: "Zagreb", postCode: "10000" },
  CY: { city: "Nicosia", postCode: "1010" },
  CZ: { city: "Prague", postCode: "11000" },
  DK: { city: "Copenhagen", postCode: "1050" },
  EE: { city: "Tallinn", postCode: "10111" },
  FI: { city: "Helsinki", postCode: "00100" },
  FR: { city: "Paris", postCode: "75001" },
  DE: { city: "Berlin", postCode: "10115" },
  GR: { city: "Athens", postCode: "10431" },
  HU: { city: "Budapest", postCode: "1051" },
  IE: { city: "Dublin", postCode: "D02 AF30" },
  IT: { city: "Rome", postCode: "00184" },
  LV: { city: "Riga", postCode: "LV-1050" },
  LT: { city: "Vilnius", postCode: "01108" },
  LU: { city: "Luxembourg", postCode: "1111" },
  MT: { city: "Valletta", postCode: "VLT 1117" },
  NL: { city: "Amsterdam", postCode: "1012 AB" },
  PL: { city: "Warsaw", postCode: "00-001" },
  PT: { city: "Lisbon", postCode: "1100-148" },
  RO: { city: "Bucharest", postCode: "010011" },
  SK: { city: "Bratislava", postCode: "811 01" },
  SI: { city: "Ljubljana", postCode: "1000" },
  ES: { city: "Madrid", postCode: "28013" },
  SE: { city: "Stockholm", postCode: "111 29" },
};

export function quoteAddressFor(country: string): QuoteAddress | null {
  return ADDRESSES[country.toUpperCase()] ?? null;
}

interface QuoteInput {
  productUid: string;
  country: string;
  apiKey: string;
  currency?: string;
  fetchImpl?: typeof fetch;
}

export async function quotePrint({
  productUid,
  country,
  apiKey,
  currency = "USD",
  fetchImpl = fetch,
}: QuoteInput): Promise<PrintQuote | null> {
  const address = quoteAddressFor(country);
  if (!address) return null;
  const response = await fetchImpl(QUOTE_URL, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      orderReferenceId: "quote-only",
      customerReferenceId: "quote-only",
      currency,
      allowMultipleQuotes: true,
      recipient: {
        country: country.toUpperCase(),
        firstName: "Quote",
        lastName: "Only",
        addressLine1: "Main Street 1",
        email: "noreply@example.com",
        city: address.city,
        postCode: address.postCode,
        ...(address.state ? { state: address.state } : {}),
      },
      products: [{ itemReferenceId: "print", productUid, quantity: 1 }],
    }),
  });
  if (!response.ok) throw new Error(`Gelato quote failed: ${response.status}`);
  const data = (await response.json()) as {
    quotes?: {
      productionCountry?: string;
      products?: { price?: number }[];
      shipmentMethods?: {
        price: number | null;
        minDeliveryDays?: number;
        maxDeliveryDays?: number;
      }[];
    }[];
  };
  const quote = data.quotes?.[0];
  const itemPrice = quote?.products?.[0]?.price;
  const priced = (quote?.shipmentMethods ?? []).filter(
    (m) => typeof m.price === "number",
  );
  if (!quote || typeof itemPrice !== "number" || priced.length === 0) {
    return null;
  }
  const cheapest = priced.reduce((a, b) =>
    (b.price as number) < (a.price as number) ? b : a,
  );
  return {
    itemPrice,
    delivery: cheapest.price as number,
    currency,
    minDays: cheapest.minDeliveryDays ?? null,
    maxDays: cheapest.maxDeliveryDays ?? null,
    madeIn: quote.productionCountry ?? null,
  };
}
