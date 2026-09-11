// "Set of works" -- badges same-title/same-artist items confirmed to be
// genuinely distinct real objects, not duplicates (e.g. separately-
// accessioned castings of the same sculpture). Runs against PGlite --
// real Postgres, in-process.
//
// Member ids are the bare native_id ("97797"), not the Postgres composite
// primary key -- using the composite form would still let the chip
// render (a separate plain column) while silently breaking the position
// label and click-through, so this fixture uses the real shape deliberately.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSetOfWork, getSetOfWorksIndex } from "../lib/setOfWorks.ts";
import { makeSql } from "./helpers/pg.ts";

let sql: any;
beforeAll(async () => {
  sql = await makeSql(["034_set_of_works.sql"]);
  await sql(
    "INSERT INTO set_of_works (id, title, items) VALUES ($1, $2, $3::jsonb)",
    [
      "set-thinker",
      "The Thinker",
      JSON.stringify([
        {
          id: "97797",
          distinguishing_trait: "Larger, later monumental casting (182.9cm)",
        },
        {
          id: "149563",
          distinguishing_trait: "Original-size casting (70.8cm)",
        },
      ]),
    ],
  );
});
afterAll(async () => {
  if (sql) await sql.$close();
});

describe("getSetOfWork", () => {
  it("returns the full row, including each member's distinguishing_trait", async () => {
    await expect(getSetOfWork(sql, "set-thinker")).resolves.toEqual({
      id: "set-thinker",
      title: "The Thinker",
      items: [
        {
          id: "97797",
          distinguishing_trait: "Larger, later monumental casting (182.9cm)",
        },
        {
          id: "149563",
          distinguishing_trait: "Original-size casting (70.8cm)",
        },
      ],
    });
  });

  it("returns null for an id that doesn't exist, or no id at all", async () => {
    expect(await getSetOfWork(sql, "no-such-set")).toBeNull();
    expect(await getSetOfWork(sql, "")).toBeNull();
    expect(await getSetOfWork(sql, undefined)).toBeNull();
    expect(await getSetOfWork(sql, null)).toBeNull();
  });
});

describe("getSetOfWorksIndex", () => {
  it("carries only id and member ids -- not each member's distinguishing_trait", async () => {
    const index = await getSetOfWorksIndex(sql);
    expect(index).toEqual([
      {
        id: "set-thinker",
        items: [{ id: "97797" }, { id: "149563" }],
      },
    ]);
  });
});
