// Lightweight, framework-free i18n. One dictionary per language lives in
// src/i18n/<lang>.ts; the active language is chosen at runtime from
// localStorage (falling back to navigator.language, then "en").
//
// Lookup is per-key: a missing translation in the active language falls back
// to English rather than failing the whole string, so a half-translated
// dictionary still renders.

import { en } from "./en";

const STORAGE_KEY = "tranquilo:lang";
const FALLBACK = "en";

const dictionaries: Record<string, Record<string, string>> = {
  en,
};

// Lazy-loaded so adding a new language never forces a code path that must
// import it eagerly.
async function loadDictionary(lang: string): Promise<Record<string, string>> {
  if (dictionaries[lang]) return dictionaries[lang];
  try {
    const mod = await import(`./${lang}.ts`);
    dictionaries[lang] = (mod as { default: Record<string, string> }).default;
    return dictionaries[lang];
  } catch {
    return {};
  }
}

function readStoredLang(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function detectBrowserLang(): string {
  if (typeof navigator === "undefined") return FALLBACK;
  const navLang = navigator.language;
  if (navLang) {
    const base = navLang.split("-")[0]?.toLowerCase();
    if (base) return base;
  }
  const languages = (navigator as unknown as { languages?: string[] })
    .languages;
  const first = languages?.[0];
  if (first) {
    const base = first.split("-")[0]?.toLowerCase();
    if (base) return base;
  }
  return FALLBACK;
}

export async function getLang(): Promise<string> {
  const stored = readStoredLang();
  if (stored) return stored;
  return detectBrowserLang();
}

export async function setLang(lang: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage unavailable — in-memory only.
  }
  await loadDictionary(lang);
  updateHtmlLang(lang);
}

function updateHtmlLang(lang: string): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (el && el.getAttribute("lang") !== lang) el.setAttribute("lang", lang);
}

// Resolve a single key against the active language, falling back to English
// per key. Returns the raw key (with dots) when neither dictionary has it,
// so missing strings are obvious in dev rather than silent.
export async function t(
  key: keyof typeof en,
  params?: Record<string, string | number>,
): Promise<string> {
  const lang = await getLang();
  const dict = (await loadDictionary(lang)) ?? {};
  let value = dict[key] ?? en[key] ?? String(key);
  if (params) {
    for (const [name, val] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(val));
    }
  }
  return value;
}

// Sync helper for callers that already have the dictionary loaded (e.g. the
// initial render in app.ts, after an await on getLang()).
export function tSync(
  key: keyof typeof en,
  lang: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[lang] ?? en;
  let value = dict[key] ?? en[key] ?? String(key);
  if (params) {
    for (const [name, val] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, "g"), String(val));
    }
  }
  return value;
}

export async function initI18n(): Promise<void> {
  const lang = await getLang();
  await loadDictionary(lang);
  updateHtmlLang(lang);
}

export type { TranslationKey } from "./en";
export { en };
