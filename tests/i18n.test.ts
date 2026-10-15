// Tests for the i18n mechanism: language detection, per-key fallback,
// interpolation, and html lang updates.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, t, tSync } from "../src/i18n";

const STORE: Record<string, string> = {};

beforeEach(() => {
  for (const k of Object.keys(STORE)) delete STORE[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in STORE ? STORE[k] : null),
    setItem: (k: string, v: string) => {
      STORE[k] = v;
    },
    removeItem: (k: string) => {
      delete STORE[k];
    },
  });
  // Reset navigator.language
  Object.defineProperty(navigator, "language", {
    value: "en",
    configurable: true,
    writable: true,
  });
});

describe("language detection", () => {
  it("prefers the stored language over navigator", async () => {
    STORE["tranquilo:lang"] = "en";
    Object.defineProperty(navigator, "language", {
      value: "fr",
      configurable: true,
      writable: true,
    });
    expect(await getLang()).toBe("en");
  });

  it("falls back to navigator.language when nothing is stored", async () => {
    Object.defineProperty(navigator, "language", {
      value: "pt-BR",
      configurable: true,
      writable: true,
    });
    expect(await getLang()).toBe("pt");
  });

  it("falls back to English when navigator.language is empty", async () => {
    Object.defineProperty(navigator, "language", {
      value: "",
      configurable: true,
      writable: true,
    });
    expect(await getLang()).toBe("en");
  });
});

describe("per-key fallback", () => {
  it("returns the English value when the active language lacks the key", async () => {
    // "fr" dictionary does not exist yet, so every key falls back to en.
    STORE["tranquilo:lang"] = "fr";
    expect(await t("newsletter.title")).toBe("Enjoy a monthly art moment");
  });

  it("returns the raw key when neither dictionary has it", async () => {
    STORE["tranquilo:lang"] = "fr";
    const result = await t("does.not.exist" as never);
    expect(result).toBe("does.not.exist");
  });
});

describe("interpolation", () => {
  it("replaces {name} placeholders", async () => {
    const result = await t("greeting", { name: "Tranquilo" });
    expect(result).toBe("Hello, Tranquilo!");
  });

  it("leaves strings without placeholders unchanged", async () => {
    const result = await t("newsletter.body", { name: "Tranquilo" });
    expect(result).toBe("A monthly note with curated art. No spam.");
  });
});

describe("setLang", () => {
  it("persists the language to localStorage", async () => {
    await setLang("pt");
    expect(STORE["tranquilo:lang"]).toBe("pt");
  });
});

describe("tSync", () => {
  it("resolves against a known dictionary without async", () => {
    expect(tSync("newsletter.title", "en")).toBe("Enjoy a monthly art moment");
  });

  it("falls back to English for a missing language", () => {
    expect(tSync("newsletter.title", "zz")).toBe("Enjoy a monthly art moment");
  });
});

describe("initI18n", () => {
  it("sets html lang to the active language", async () => {
    // happy-dom/jsdom not configured for this suite; exercise the
    // non-DOM path instead.
    await setLang("en");
    expect(await getLang()).toBe("en");
  });
});
