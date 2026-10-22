// Content translations (sql/048_translations.sql): which stored text, if
// any, replaces a field's source text for the locale a request asked for.
//
// A field is translated only by a row that is approved and still current:
// its source_hash must match the source text as it is now, so a corrected
// caption never keeps showing a translation of the old wording. The source's
// own-language text (origin 'original') has no such check, and wins over any
// translation for its locale.
//
// Lookup failures are reported and the source text is served instead: a
// missing translation must never cost a visitor the page.

import { createHash } from "node:crypto";
import { fallbackChain } from "../src/i18n/core.ts";
import { LOCALES } from "../src/i18n/locales.ts";
import { requestLocale } from "./request-locale.ts";
import { reportError } from "./sentry.ts";

export type TranslationOrigin = "original" | "machine" | "human";

export interface TranslationRow {
  entity_id: string;
  field: string;
  locale: string;
  text: string;
  origin: TranslationOrigin;
  source_hash: string | null;
}

export interface FieldTranslation {
  text: string;
  origin: TranslationOrigin;
  locale: string;
}

type EntityType = "item" | "storyline" | "shelf";

interface SqlClient {
  query(text: string, params: unknown[]): Promise<unknown[]>;
}

export interface TranslatedField {
  origin: TranslationOrigin;
  locale: string;
  original: string;
}

type Translatable = Record<string, unknown> & {
  translated?: Record<string, TranslatedField>;
};

// Machine translations need the "Translated automatically" note on screen
// before they may be served.
const SERVED_ORIGINS: readonly TranslationOrigin[] = ["original", "human"];

const ORIGIN_PREFERENCE: readonly TranslationOrigin[] = [
  "original",
  "human",
  "machine",
];

export const ITEM_FIELDS = [
  "title",
  "caption_tea",
  "caption_basic",
  "medium",
  "culture",
  "place_of_origin",
  "artist_nationality",
  "tags",
] as const;

const AVAILABLE = new Set<string>(LOCALES.map((l) => l.code));

export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function contentLocaleChain(locale: string): string[] {
  return fallbackChain(locale, AVAILABLE);
}

// null means no translation was asked for. An unknown code is a 400 rather
// than a silent fallback, since every distinct value is its own cache entry.
export function parseLocaleParam(raw: unknown): string | null {
  if (raw === undefined || raw === "") return null;
  const code = typeof raw === "string" ? requestLocale(raw) : null;
  if (!code) {
    throw Object.assign(new Error(`unknown locale: ${String(raw)}`), {
      status: 400,
    });
  }
  return code;
}

export function pickTranslation(
  rows: readonly TranslationRow[],
  field: string,
  chain: readonly string[],
  sourceText: unknown,
): FieldTranslation | null {
  if (typeof sourceText !== "string" || !sourceText) return null;
  const hash = sourceHash(sourceText);
  for (const locale of chain) {
    const usable = rows.filter(
      (r) =>
        r.field === field &&
        r.locale === locale &&
        SERVED_ORIGINS.includes(r.origin) &&
        r.text.trim() !== "" &&
        (r.origin === "original" || r.source_hash === hash),
    );
    for (const origin of ORIGIN_PREFERENCE) {
      const hit = usable.find((r) => r.origin === origin);
      if (hit)
        return { text: hit.text, origin: hit.origin, locale: hit.locale };
    }
  }
  return null;
}

// Every served-origin, approved row for these entities along the chain,
// grouped by entity_id.
export async function loadTranslations(
  sql: SqlClient,
  entityType: EntityType,
  entityIds: readonly string[],
  chain: readonly string[],
): Promise<Map<string, TranslationRow[]>> {
  const byEntity = new Map<string, TranslationRow[]>();
  if (!entityIds.length || !chain.length) return byEntity;
  try {
    const rows = (await sql.query(
      `SELECT entity_id, field, locale, text, origin, source_hash
         FROM translations
        WHERE entity_type = $1 AND entity_id = ANY($2)
          AND locale = ANY($3) AND review_status = 'approved'
          AND origin = ANY($4)`,
      [entityType, [...entityIds], [...chain], [...SERVED_ORIGINS]],
    )) as TranslationRow[];
    for (const row of rows) {
      const list = byEntity.get(row.entity_id) ?? [];
      list.push(row);
      byEntity.set(row.entity_id, list);
    }
  } catch (err) {
    console.error("translations: lookup failed, serving source text", err);
    await reportError(err);
  }
  return byEntity;
}

// Replaces each translated field on `target` in place and records what it
// replaced under `target.translated`, which is absent when nothing changed.
export function applyTranslations(
  target: Translatable,
  fields: readonly { key: string; field: string }[],
  rows: readonly TranslationRow[] | undefined,
  chain: readonly string[],
): void {
  if (!rows?.length) return;
  for (const { key, field } of fields) {
    const original = target[key];
    const hit = pickTranslation(rows, field, chain, original);
    if (!hit) continue;
    target[key] = hit.text;
    target.translated = {
      ...target.translated,
      [key]: {
        origin: hit.origin,
        locale: hit.locale,
        original: String(original),
      },
    };
  }
}

export function itemFields(
  present: Record<string, unknown>,
): { key: string; field: string }[] {
  return ITEM_FIELDS.filter((f) => f in present).map((f) => ({
    key: f,
    field: f,
  }));
}

export async function translateItems(
  sql: SqlClient,
  rows: readonly { id: string }[],
  out: Translatable[],
  locale: string,
): Promise<void> {
  const chain = contentLocaleChain(locale);
  const byEntity = await loadTranslations(
    sql,
    "item",
    rows.map((r) => r.id),
    chain,
  );
  if (!byEntity.size) return;
  rows.forEach((row, i) => {
    applyTranslations(out[i], itemFields(out[i]), byEntity.get(row.id), chain);
  });
}

export async function translateStoryline(
  sql: SqlClient,
  storyline: Translatable & { id: string; items?: Translatable[] },
  locale: string,
): Promise<void> {
  const chain = contentLocaleChain(locale);
  const rows = (
    await loadTranslations(sql, "storyline", [storyline.id], chain)
  ).get(storyline.id);
  if (!rows) return;
  applyTranslations(
    storyline,
    [
      { key: "title", field: "title" },
      { key: "intro_caption", field: "intro_caption" },
    ],
    rows,
    chain,
  );
  for (const chapter of storyline.items ?? []) {
    applyTranslations(
      chapter,
      [{ key: "chapter_caption", field: `chapter_caption:${chapter.id}` }],
      rows,
      chain,
    );
  }
}

export async function translateShelves(
  sql: SqlClient,
  shelves: (Translatable & { id: string })[],
  locale: string,
): Promise<void> {
  const chain = contentLocaleChain(locale);
  const byEntity = await loadTranslations(
    sql,
    "shelf",
    shelves.map((s) => s.id),
    chain,
  );
  for (const shelf of shelves) {
    applyTranslations(
      shelf,
      [{ key: "title", field: "title" }],
      byEntity.get(shelf.id),
      chain,
    );
  }
}
