export type PrintQuoteResult =
  | { available: false }
  | {
      available: true;
      total: number;
      item: number;
      delivery: number;
      currency: string;
      minDays: number | null;
      maxDays: number | null;
      madeIn: string | null;
    };
