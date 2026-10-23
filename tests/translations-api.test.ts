// /api/items with ?locale=: approved, current translations replace source
// text field by field, against real Postgres (PGlite). Without a locale, or
// without any matching rows, responses are exactly what they were before.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sourceHash } from "../lib/translations.ts";
import { makeSql } from "./helpers/pg.ts";

const db = vi.hoisted(() => ({ sql: null as any }));
vi.mock("../lib/db.ts", () => ({ getSql: () => db.sql }));
vi.mock("../lib/sentry.ts", () => ({ Sentry: {}, reportError: vi.fn() }));

const { default: handler } = await import("../api/items.ts");

const SCHEMA = [
  "001_items_schema.sql",
  "003_items_harmonization.sql",
  "019_storylines.sql",
  "021_shelves.sql",
];

function mockRes(): any {
  return {
    statusCode: 200,
    body: null,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

async function get(query: Record<string, unknown>) {
  const res = mockRes();
  await handler({ method: "GET", query } as any, res);
  return res;
}

function insert(sql: any, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  return sql.query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols
      .map((_, i) => `$${i + 1}`)
      .join(", ")})`,
    cols.map((c) => row[c]),
  );
}

function translation(over: Record<string, unknown>) {
  return {
    entity_type: "item",
    entity_id: "met:1",
    locale: "pt-BR",
    field: "title",
    text: "Autorretrato",
    origin: "human",
    review_status: "approved",
    source_hash: sourceHash("Self-portrait"),
    ...over,
  };
}

let withTable: any;
let withoutTable: any;

beforeAll(async () => {
  withTable = await makeSql([...SCHEMA, "048_translations.sql"]);
  withoutTable = await makeSql(SCHEMA);
  for (const sql of [withTable, withoutTable]) {
    await insert(sql, "items", {
      id: "met:1",
      source: "met",
      native_id: "1",
      title: "Self-portrait",
      medium: "Oil on canvas",
      category: "Paintings & Portraits",
    });
    await insert(sql, "items", {
      id: "met:2",
      source: "met",
      native_id: "2",
      title: "Harbour",
      medium: "Etching",
      category: "Works on Paper",
    });
    await insert(sql, "storylines", {
      id: "harbours",
      title: "Harbours",
      type: "theme",
      tier: "structural",
      cover_item_id: "2",
      intro_caption: "Ports and ships.",
      items: JSON.stringify([
        { id: "2", position: 1, chapter_caption: "A busy quay." },
      ]),
    });
    await insert(sql, "shelves", {
      id: "quiet",
      title: "Quiet rooms",
      type: "hero",
      position: 1,
      item_ids: JSON.stringify(["1"]),
    });
  }
  const s = withTable;
  await insert(s, "translations", translation({}));
  await insert(
    s,
    "translations",
    translation({
      field: "medium",
      text: "Óleo sobre tela (pendente)",
      review_status: "pending",
      source_hash: sourceHash("Oil on canvas"),
    }),
  );
  await insert(
    s,
    "translations",
    translation({
      entity_id: "met:2",
      text: "Porto (desatualizado)",
      source_hash: sourceHash("Harbor"),
    }),
  );
  await insert(
    s,
    "translations",
    translation({
      entity_id: "met:2",
      field: "medium",
      text: "Água-forte (máquina)",
      origin: "machine",
      source_hash: sourceHash("Etching"),
    }),
  );
  for (const [field, text, source] of [
    ["title", "Portos", "Harbours"],
    ["intro_caption", "Portos e navios.", "Ports and ships."],
    ["chapter_caption:2", "Um cais movimentado.", "A busy quay."],
  ]) {
    await insert(
      s,
      "translations",
      translation({
        entity_type: "storyline",
        entity_id: "harbours",
        field,
        text,
        source_hash: sourceHash(source),
      }),
    );
  }
  await insert(
    s,
    "translations",
    translation({
      entity_type: "shelf",
      entity_id: "quiet",
      text: "Salas silenciosas",
      source_hash: sourceHash("Quiet rooms"),
    }),
  );
});

afterAll(async () => {
  await withTable?.$close();
  await withoutTable?.$close();
});

describe("artworks", () => {
  it("translates an approved, current field and says what it replaced", async () => {
    db.sql = withTable;
    const res = await get({ ids: "1", locale: "pt-BR" });
    const [item] = res.body.items;
    expect(item.title).toBe("Autorretrato");
    expect(item.translated).toEqual({
      title: { origin: "human", locale: "pt-BR", original: "Self-portrait" },
    });
  });

  it("leaves pending, stale and machine translations unserved", async () => {
    db.sql = withTable;
    const res = await get({ ids: ["1", "2"], locale: "pt-BR" });
    const byId = Object.fromEntries(res.body.items.map((i: any) => [i.id, i]));
    expect(byId["1"].medium).toBe("Oil on canvas");
    expect(byId["2"].title).toBe("Harbour");
    expect(byId["2"].medium).toBe("Etching");
    expect(byId["2"].translated).toBeUndefined();
  });

  it("translates titles in the feed manifest too", async () => {
    db.sql = withTable;
    const res = await get({ shape: "manifest", locale: "pt-BR" });
    const item = res.body.find((i: any) => i.id === "1");
    expect(item.title).toBe("Autorretrato");
  });

  it("answers exactly as before when no locale is asked for", async () => {
    db.sql = withTable;
    const plain = await get({ ids: ["1", "2"] });
    db.sql = withoutTable;
    const beforeFeature = await get({ ids: ["1", "2"] });
    expect(plain.body).toEqual(beforeFeature.body);
    expect(plain.body.items[0].translated).toBeUndefined();
  });

  it("answers exactly as before when a locale has nothing translated", async () => {
    db.sql = withTable;
    const english = await get({ ids: ["1", "2"], locale: "en" });
    const plain = await get({ ids: ["1", "2"] });
    expect(english.body).toEqual(plain.body);
  });

  it("serves source text, not an error, while the table doesn't exist yet", async () => {
    db.sql = withoutTable;
    const res = await get({ ids: "1", locale: "pt-BR" });
    expect(res.statusCode).toBe(200);
    expect(res.body.items[0].title).toBe("Self-portrait");
  });

  it("rejects an unknown locale", async () => {
    db.sql = withTable;
    const res = await get({ ids: "1", locale: "xx-YY" });
    expect(res.statusCode).toBe(400);
  });
});

describe("storylines and shelves", () => {
  it("translates a storyline's title, intro and chapter captions", async () => {
    db.sql = withTable;
    const res = await get({
      shape: "storyline",
      id: "harbours",
      locale: "pt-BR",
    });
    expect(res.body.title).toBe("Portos");
    expect(res.body.intro_caption).toBe("Portos e navios.");
    expect(res.body.items[0].chapter_caption).toBe("Um cais movimentado.");
    expect(res.body.items[0].translated.chapter_caption.original).toBe(
      "A busy quay.",
    );
    expect(res.body.translated.title.original).toBe("Harbours");
  });

  it("translates shelf titles", async () => {
    db.sql = withTable;
    const res = await get({ shape: "shelves", locale: "pt-BR" });
    expect(res.body[0].title).toBe("Salas silenciosas");
  });

  it("leaves storylines and shelves untouched without a locale", async () => {
    db.sql = withTable;
    const storyline = await get({ shape: "storyline", id: "harbours" });
    const shelves = await get({ shape: "shelves" });
    expect(storyline.body.title).toBe("Harbours");
    expect(storyline.body.translated).toBeUndefined();
    expect(shelves.body[0].title).toBe("Quiet rooms");
  });
});
