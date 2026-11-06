import { createPrintRules, type PrintItem } from "../../lib/print-rules";
import { TRANQUILO_CONFIG } from "../data/config.generated";

export type PrintProduct = "mini_print" | "poster" | "framed" | "tote" | "mug";

const rules = createPrintRules(TRANQUILO_CONFIG);

const IMPORT_TAX_REGIONS: string[] = (
  TRANQUILO_CONFIG["print.import_tax"].buyer_pays as string
)
  .split(",")
  .map((r) => r.trim());

export const PRINT_COUNTRIES: string[] = rules.countries;

export const regionForCountry = (country: string): string | null =>
  rules.regionForCountry(country);

export function printOptionsFor(
  item: PrintItem,
  region: string | null,
): PrintProduct[] {
  return rules.printOptionsFor(item, region) as PrintProduct[];
}

export function importTaxApplies(region: string | null): boolean {
  return region !== null && IMPORT_TAX_REGIONS.includes(region);
}

export function hasMasterSize(item: PrintItem): boolean {
  return Boolean(item.master_width && item.master_height);
}

export function printLinkEnabled(search: string): boolean {
  return (
    TRANQUILO_CONFIG.print.link_enabled ||
    new URLSearchParams(search).get("print") === "preview"
  );
}
