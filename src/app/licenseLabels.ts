// Shared license slug -> {label, deed link} lookup. Used by
// TranquiloDetailModal.ts (per-item license row) and errorState.ts (the
// 404/outage template), so the two never drift into naming a license
// two different ways.
export const LICENSE_LABELS: Record<string, [string, string | null]> = {
  "cc0": ["CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  "public-domain": ["Public domain", null],
  "public-domain-mark": [
    "Public Domain Mark",
    "https://creativecommons.org/publicdomain/mark/1.0/",
  ],
  "cc-by": ["CC BY", "https://creativecommons.org/licenses/by/4.0/"],
  "cc-by-3.0": ["CC BY 3.0", "https://creativecommons.org/licenses/by/3.0/"],
  "cc-by-4.0": ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  "cc-by-sa": ["CC BY-SA", "https://creativecommons.org/licenses/by-sa/4.0/"],
  "cc-by-sa-3.0": [
    "CC BY-SA 3.0",
    "https://creativecommons.org/licenses/by-sa/3.0/",
  ],
  "cc-by-sa-4.0": [
    "CC BY-SA 4.0",
    "https://creativecommons.org/licenses/by-sa/4.0/",
  ],
  // Taiwan's Open Government Data License 1.0 (npm.py's National Palace
  // Museum adapter) -- not a Creative Commons instrument, so no
  // creativecommons.org deed exists for it. Linked to the license's own
  // authoritative government page instead, the same one npm.py's
  // LICENSE_CHECK gates on and every item's raw `license` field before
  // harmonize's license.canonical rule rewrites it to this slug.
  "open-government-data-license-1.0": [
    "Open Government Data License 1.0",
    "https://data.gov.tw/license",
  ],
};

// Falls through to the raw slug for an unmapped value rather than hiding
// it -- showing something unrecognized beats silently dropping the one
// field that tells someone their rights.
export function licenseLabel(raw: string | null | undefined): {
  label: string;
  deed: string | null;
} {
  const value = (raw ? String(raw) : "").trim();
  if (!value) return { label: "", deed: null };
  const entry = LICENSE_LABELS[value.toLowerCase()];
  return entry
    ? { label: entry[0], deed: entry[1] }
    : { label: value, deed: null };
}
