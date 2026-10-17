import { describe, expect, it } from "vitest";
import { PLACEHOLDER_PATTERN } from "../src/i18n/core";
import { DICTIONARIES } from "../src/i18n/dictionaries";
import { en } from "../src/i18n/en";
import { LOCALES, type LocaleInfo } from "../src/i18n/locales";

type Dictionary = Readonly<Record<string, string | undefined>>;

interface LocaleGap {
  key: string;
  missingPlaceholders: string[];
  extraPlaceholders: string[];
}

const NON_ENGLISH_LOCALES: readonly LocaleInfo[] = LOCALES.filter(
  (locale) => locale.code !== "en",
);

function dictionaryFor(locale: LocaleInfo): Dictionary {
  return DICTIONARIES[locale.code as keyof typeof DICTIONARIES];
}

function placeholders(value: string): Set<string> {
  return new Set(
    Array.from(
      value.matchAll(new RegExp(PLACEHOLDER_PATTERN)),
      (match) => match[1],
    ),
  );
}

function findGaps(english: Dictionary, translated: Dictionary): LocaleGap[] {
  return Object.keys(english).flatMap((key) => {
    const translation = translated[key];
    if (!translation) {
      return [{ key, missingPlaceholders: [], extraPlaceholders: [] }];
    }

    const expected = placeholders(english[key] ?? "");
    const actual = placeholders(translation);
    const missingPlaceholders = [...expected]
      .filter((name) => !actual.has(name))
      .sort();
    const extraPlaceholders = [...actual]
      .filter((name) => !expected.has(name))
      .sort();
    return missingPlaceholders.length || extraPlaceholders.length
      ? [{ key, missingPlaceholders, extraPlaceholders }]
      : [];
  });
}

function describeGap({
  key,
  missingPlaceholders,
  extraPlaceholders,
}: LocaleGap): string {
  const details = [
    missingPlaceholders.length &&
      `missing {${missingPlaceholders.join("}, {")}}`,
    extraPlaceholders.length &&
      `unexpected {${extraPlaceholders.join("}, {")}}`,
  ].filter(Boolean);
  return details.length ? `${key} (${details.join(", ")})` : key;
}

function checkLocale(
  locale: LocaleInfo,
  english: Dictionary,
  translated: Dictionary,
): LocaleGap[] {
  const gaps = findGaps(english, translated);
  if (locale.status === "shipped" && gaps.length > 0) {
    throw new Error(
      `${locale.code}: ${gaps.length} translation gap(s): ${gaps.map(describeGap).join(", ")}`,
    );
  }
  return gaps;
}

function draftGapTodoTitles(
  locale: LocaleInfo,
  english: Dictionary,
  translated: Dictionary,
): string[] {
  if (locale.status !== "draft") return [];
  return findGaps(english, translated).map(
    (gap) => `${locale.code}: translation gap — ${describeGap(gap)}`,
  );
}

const draftGapTodos = NON_ENGLISH_LOCALES.flatMap((locale) =>
  draftGapTodoTitles(locale, en, dictionaryFor(locale)),
);

describe("translation completeness", () => {
  for (const title of draftGapTodos) {
    it.todo(title);
  }

  it.each(NON_ENGLISH_LOCALES)("$code locale matches English", (locale) => {
    const gaps = checkLocale(locale, en, dictionaryFor(locale));
    if (locale.status === "shipped") {
      expect(gaps).toEqual([]);
    }
  });

  it("treats empty translations as missing", () => {
    expect(findGaps({ greeting: "Hello" }, { greeting: "" })).toEqual([
      {
        key: "greeting",
        missingPlaceholders: [],
        extraPlaceholders: [],
      },
    ]);
  });

  it("detects missing keys and mismatched placeholders", () => {
    const gaps = findGaps(
      { greeting: "Hello {name}", count: "{count} works" },
      { greeting: "Bonjour {nom}" },
    );

    expect(gaps.map(describeGap)).toEqual([
      "greeting (missing {name}, unexpected {nom})",
      "count",
    ]);
    expect(() =>
      checkLocale(
        {
          code: "fr",
          nativeName: "Français",
          dir: "ltr",
          status: "shipped",
        },
        { greeting: "Hello {name}", count: "{count} works" },
        { greeting: "Bonjour {nom}" },
      ),
    ).toThrow(/fr: 2 translation gap\(s\)/);
  });

  it("uses visible TODOs for draft locale gaps", () => {
    expect(
      draftGapTodoTitles(
        {
          code: "fr",
          nativeName: "Français",
          dir: "ltr",
          status: "draft",
        },
        { greeting: "Hello {name}", count: "{count} works" },
        { greeting: "Bonjour" },
      ),
    ).toEqual([
      "fr: translation gap — greeting (missing {name})",
      "fr: translation gap — count",
    ]);
  });

  it("accepts the same placeholder names in a different order", () => {
    expect(
      findGaps(
        { greeting: "Hello {name}, you have {count} messages" },
        { greeting: "Bonjour {count} messages pour {name}" },
      ),
    ).toEqual([]);
  });
});
