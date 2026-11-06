import { describe, expect, it } from "vitest";
import { markupForRegion, priceQuote } from "../lib/print-pricing.ts";

const quote = { itemPrice: 12.13, delivery: 4.9 };

describe("pricing a print from its Gelato cost", () => {
  it("adds the margin and card fee on top of item plus delivery", () => {
    const priced = priceQuote(quote, { margin: 0.3, cardFee: 0.05 });
    expect(priced.total).toBeCloseTo((12.13 + 4.9) / 0.65, 1);
  });

  it("keeps delivery at cost and puts the markup in the item price", () => {
    const priced = priceQuote(quote, { margin: 0.3, cardFee: 0.05 });
    expect(priced.delivery).toBe(4.9);
    expect(priced.item + priced.delivery).toBeCloseTo(priced.total, 2);
  });

  it("rounds the total up to a whole cent", () => {
    const priced = priceQuote(
      { itemPrice: 10, delivery: 5 },
      { margin: 0.3, cardFee: 0.05 },
    );
    expect(priced.total).toBe(23.08);
  });

  it("never returns a total below the Gelato cost", () => {
    const priced = priceQuote(quote, { margin: 0, cardFee: 0 });
    expect(priced.total).toBeGreaterThanOrEqual(17.03);
  });

  it("refuses a markup that leaves nothing to divide by", () => {
    expect(() => priceQuote(quote, { margin: 0.6, cardFee: 0.4 })).toThrow();
  });
});

describe("the markup for a region", () => {
  it("keeps a 30% margin everywhere", () => {
    for (const region of ["br", "us", "uk", "eu", "ca", "au", null]) {
      expect(markupForRegion(region).margin).toBe(0.3);
    }
  });

  it("budgets a 5% card fee for Brazil and 7% elsewhere", () => {
    expect(markupForRegion("br").cardFee).toBe(0.05);
    for (const region of ["us", "uk", "eu", "ca", "au", null]) {
      expect(markupForRegion(region).cardFee).toBe(0.07);
    }
  });
});
