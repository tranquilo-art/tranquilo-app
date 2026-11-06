import { TRANQUILO_CONFIG } from "./config.generated.ts";

interface Markup {
  margin: number;
  cardFee: number;
}

const MARGIN = Number(TRANQUILO_CONFIG["print.pricing"].margin);
const CARD_FEES = TRANQUILO_CONFIG["print.card_fee"] as Record<string, number>;

export function markupForRegion(region: string | null): Markup {
  return {
    margin: MARGIN,
    cardFee: Number((region && CARD_FEES[region]) ?? CARD_FEES.default),
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function priceQuote(
  cost: { itemPrice: number; delivery: number },
  { margin, cardFee }: Markup,
) {
  const keep = 1 - margin - cardFee;
  if (keep <= 0) throw new Error("print pricing markup leaves no revenue");
  const gelatoCost = cost.itemPrice + cost.delivery;
  const total = Math.max(
    gelatoCost,
    Math.ceil((gelatoCost / keep) * 100) / 100,
  );
  return {
    total: cents(total),
    delivery: cost.delivery,
    item: cents(total - cost.delivery),
  };
}
