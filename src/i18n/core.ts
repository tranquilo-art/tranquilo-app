// Pure locale logic: no window, document, or storage access, and no module
// state. Everything is passed in, which keeps it unit-testable and lets the
// same code run at build time (static-page generation) and on the server.
// The browser-bound layer that remembers the active locale is index.ts.
import { DEFAULT_LOCALE, type LocaleInfo } from "./locales.ts";

type Lookupable = Readonly<Record<string, string | undefined>>;

/** Matches the {name} placeholders used by translations and interpolation. */
export const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

function canonical(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    // Not a valid BCP-47 tag (empty, or junk from a stored value).
    return undefined;
  }
}

function baseLanguage(tag: string): string {
  return tag.split("-")[0].toLowerCase();
}

/**
 * The first of `requested` (in the browser's order of preference) that one
 * of `locales` can serve: an exact match, else any locale sharing its base
 * language -- a pt-PT reader is better served by pt-BR than by English.
 */
export function matchLocale(
  requested: readonly string[],
  locales: readonly LocaleInfo[],
): string | undefined {
  for (const raw of requested) {
    const tag = canonical(raw);
    if (!tag) continue;
    const exact = locales.find(
      (l) => l.code.toLowerCase() === tag.toLowerCase(),
    );
    if (exact) return exact.code;
    const base = baseLanguage(tag);
    const sameLanguage = locales.find((l) => baseLanguage(l.code) === base);
    if (sameLanguage) return sameLanguage.code;
  }
  return undefined;
}

/**
 * Which locale to show. An explicit stored choice wins, and may name a
 * draft locale -- that's how reviewers reach one. Otherwise only shipped
 * locales are matched against the browser's languages, so nobody is put on
 * an unfinished translation automatically.
 */
export function resolveLocale(opts: {
  stored: string | null;
  browser: readonly string[];
  locales: readonly LocaleInfo[];
}): string {
  const { stored, browser, locales } = opts;
  if (stored) {
    const tag = canonical(stored);
    const chosen = tag && locales.find((l) => l.code === tag);
    if (chosen) return chosen.code;
  }
  const shipped = locales.filter((l) => l.status === "shipped");
  return matchLocale(browser, shipped) ?? DEFAULT_LOCALE;
}

/** Where a missing key is looked up next: region -> base language -> English. */
export function fallbackChain(
  locale: string,
  available: ReadonlySet<string>,
): string[] {
  const candidates = [locale, baseLanguage(locale), DEFAULT_LOCALE];
  return [...new Set(candidates)].filter((c) => available.has(c));
}

/**
 * The first non-empty value for `key` along `chain`. Falls back per key, so
 * a half-translated dictionary still renders. If nothing has the key, the
 * key itself is returned -- visibly wrong rather than silently blank.
 */
export function lookup(
  key: string,
  chain: readonly string[],
  dictionaries: Readonly<Record<string, Lookupable>>,
): string {
  for (const locale of chain) {
    const value = dictionaries[locale]?.[key];
    if (value) return value;
  }
  return key;
}

/** Fills {name} placeholders. Unknown placeholders are left as written. */
export function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  // A replacer function, not a replacement string, so "$&"-style patterns
  // in a value are inserted literally.
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/** Escapes text for insertion into HTML, attributes included. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The plural sibling key for `count` under `locale`'s CLDR rules. */
export function pluralKey(base: string, count: number, locale: string): string {
  return `${base}.${new Intl.PluralRules(locale).select(count)}`;
}
