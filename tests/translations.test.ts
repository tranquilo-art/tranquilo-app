// Field-level translation choice: which stored translation, if any, replaces
// a field's source text for a requested locale. Pure logic, no database.
import { describe, expect, it } from "vitest";
import {
  contentLocaleChain,
  parseLocaleParam,
  pickTranslation,
  sourceHash,
  type TranslationRow,
} from "../lib/translations.ts";

const TITLE = "Self-portrait";
const TITLE_HASH =
  "a3b899b53f7a5e7ce3885d463f72b01ba371061e91fbb0d4cfc3a75da78201cd";

function row(over: Partial<TranslationRow>): TranslationRow {
  return {
    entity_id: "met:1",
    field: "title",
    locale: "pt-BR",
    text: "Autorretrato",
    origin: "human",
    source_hash: TITLE_HASH,
    ...over,
  };
}

describe("sourceHash", () => {
  it("is the hex SHA-256 of the UTF-8 text, so other tools can compute it", () => {
    expect(sourceHash(TITLE)).toBe(TITLE_HASH);
    expect(sourceHash("Retrato à beira-mar")).toBe(
      "63c636039803f03b088941a16098219d1b092b6186a3771e30e63bf40106bf2a",
    );
  });
});

describe("contentLocaleChain", () => {
  it("tries the requested locale before English", () => {
    expect(contentLocaleChain("pt-BR")).toEqual(["pt-BR", "en"]);
  });

  it("is just English for an English request", () => {
    expect(contentLocaleChain("en")).toEqual(["en"]);
  });
});

describe("parseLocaleParam", () => {
  it("returns null when no locale was asked for", () => {
    expect(parseLocaleParam(undefined)).toBeNull();
    expect(parseLocaleParam("")).toBeNull();
  });

  it("normalises a known code", () => {
    expect(parseLocaleParam("pt-br")).toBe("pt-BR");
  });

  it("rejects an unknown code as the caller's mistake", () => {
    expect(() => parseLocaleParam("xx-YY")).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("rejects a repeated parameter", () => {
    expect(() => parseLocaleParam(["en", "pt-BR"])).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe("pickTranslation", () => {
  const chain = ["pt-BR", "en"];

  it("uses a current translation for the requested locale", () => {
    expect(pickTranslation([row({})], "title", chain, TITLE)).toEqual({
      text: "Autorretrato",
      origin: "human",
      locale: "pt-BR",
    });
  });

  it("ignores a translation of older source text", () => {
    const stale = row({ source_hash: sourceHash("Self portrait") });
    expect(pickTranslation([stale], "title", chain, TITLE)).toBeNull();
  });

  it("keeps a source's own-language text even after the source text changes", () => {
    const own = row({
      origin: "original",
      source_hash: null,
      text: "Auto-retrato",
    });
    expect(pickTranslation([own], "title", chain, "Self portrait")?.text).toBe(
      "Auto-retrato",
    );
  });

  it("prefers the source's own-language text over a translation", () => {
    const rows = [
      row({ text: "Autorretrato" }),
      row({ origin: "original", source_hash: null, text: "Auto-retrato" }),
    ];
    expect(pickTranslation(rows, "title", chain, TITLE)?.text).toBe(
      "Auto-retrato",
    );
  });

  it("does not serve machine translations yet", () => {
    expect(
      pickTranslation([row({ origin: "machine" })], "title", chain, TITLE),
    ).toBeNull();
  });

  it("falls back along the chain", () => {
    const english = row({ locale: "en", text: "Self-Portrait (English)" });
    expect(pickTranslation([english], "title", chain, TITLE)?.locale).toBe(
      "en",
    );
  });

  it("only considers the field asked about", () => {
    expect(
      pickTranslation([row({ field: "medium" })], "title", chain, TITLE),
    ).toBeNull();
  });

  it("never replaces text with an empty translation", () => {
    expect(
      pickTranslation([row({ text: "  " })], "title", chain, TITLE),
    ).toBeNull();
  });

  it("has nothing to translate when the source field is empty", () => {
    expect(pickTranslation([row({})], "title", chain, "")).toBeNull();
    expect(pickTranslation([row({})], "title", chain, null)).toBeNull();
  });
});
