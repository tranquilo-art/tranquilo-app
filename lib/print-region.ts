import { TRANQUILO_CONFIG } from "./config.generated.ts";
import { createPrintRules } from "./print-rules.ts";

const COUNTRY_CODE = /^[A-Za-z]{2}$/;

export const { regionForCountry } = createPrintRules(TRANQUILO_CONFIG);

export function printRegionFromHeaders(headers: Record<string, unknown>) {
  // vercel dev sends no geolocation header.
  const raw =
    headers["x-vercel-ip-country"] ??
    (process.env.VERCEL_ENV === "development"
      ? process.env.PRINT_REGION_DEV_COUNTRY
      : undefined);
  const country =
    typeof raw === "string" && COUNTRY_CODE.test(raw)
      ? raw.toUpperCase()
      : null;
  return { country, region: regionForCountry(country) };
}
