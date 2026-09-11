// Feed ordering moves server-side onto a precomputed shuffle key. Written
// against the stated contract rather than the implementation, since tests
// written afterwards tend to ratify code instead of constrain it.
//
// Three things are worth guarding: the cursor round-trips exactly (a lossy
// float cursor fails the same way a truncated timestamp cursor once did --
// repeating pages); the query stays an index range scan (the entire reason
// this design beat a seeded hash sort); and declustering survives being
// applied per page (it can't be identical to a global pass, since the
// look-ahead is bounded -- what's guaranteed is that the seam between two
// pages is checked at all).
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as items from "../api/items.ts";
import { LIVE_ITEMS_PREDICATE } from "../lib/items-sql.ts";
import {
  declusterOrder,
  declusterPageOrder,
  isRealArtist,
} from "../src/logic/logic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function item(id: any, artist: any, category?: any) {
  return {
    id: id,
    artist: artist,
    category: category || "Paintings & Portraits",
  };
}

// ---------------------------------------------------------------------------
// 1. The cursor
// ---------------------------------------------------------------------------
describe("shuffle cursor codec", () => {
  // The values that break naive float handling: the 0.1+0.2 artifact, a
  // value one ULP below 1, a denormal, and 16-17 significant digit values a
  // shorter formatter would round. A changed value lands the cursor on the
  // wrong row.
  const KEYS = [
    0,
    0.5,
    0.1,
    0.1 + 0.2,
    0.9999999999999999,
    1 - Number.EPSILON,
    0.30000000000000004,
    0.1234567890123456,
    5e-324,
    Math.SQRT1_2,
  ];

  KEYS.forEach((key) => {
    it(`round-trips the float8 ${key} with no loss`, () => {
      const back = items.decodeShuffleCursor(
        items.encodeShuffleCursor(key, "x", 0.25, false),
      );
      // Object.is, not a tolerance check: this must be the SAME double, not a
      // close one.
      expect(Object.is(back.shuffleKey, key)).toBe(true);
    });
  });

  it("survives a native_id containing a comma", () => {
    // Real Commons filenames have one; the cursor uses a separator that
    // cannot occur in the payload for exactly this reason.
    const id = "File:11 Qian Xuan. Sqirrel. National Palace Museum, Taipei.jpg";
    const back = items.decodeShuffleCursor(
      items.encodeShuffleCursor(0.42, id, 0.9, true),
    );
    expect(back.nativeId).toBe(id);
  });

  it("carries the session start and the wrap phase", () => {
    const back = items.decodeShuffleCursor(
      items.encodeShuffleCursor(0.42, "abc", 0.875, true),
    );
    expect(Object.is(back.start, 0.875)).toBe(true);
    expect(back.wrapped).toBe(true);
  });

  it("distinguishes a wrapped cursor from an unwrapped one", () => {
    const before = items.decodeShuffleCursor(
      items.encodeShuffleCursor(0.42, "abc", 0.875, false),
    );
    expect(before.wrapped).toBe(false);
  });

  it("rejects a malformed cursor as a 400, not a crash", () => {
    expect(() => {
      items.decodeShuffleCursor("not-a-cursor");
    }).toThrowError(/malformed/i);
    try {
      items.decodeShuffleCursor("not-a-cursor");
    } catch (err) {
      expect((err as any).status).toBe(400);
    }
  });

  it("rejects a cursor whose key is not a finite number", () => {
    const forged = Buffer.from(
      ["NaN", "abc", "0.5", "0"].join("\u0000"),
      "utf8",
    ).toString("base64url");
    expect(() => {
      items.decodeShuffleCursor(forged);
    }).toThrowError(/malformed/i);
  });
});

// ---------------------------------------------------------------------------
// 2. The query
// ---------------------------------------------------------------------------
describe("shuffle-ordered paging stays an index range scan", () => {
  it("orders by the indexed tuple, not by shuffle_key alone", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
    });
    // Must match items_shuffle_idx exactly, not shuffle_key alone with the
    // tiebreak living only in the WHERE clause.
    expect(q.text).toMatch(/ORDER BY shuffle_key ASC, native_id ASC/);
    expect(q.text).not.toMatch(/ORDER BY created_at/);
  });

  it("seeks with a row-value comparison and an explicit float8 cast", () => {
    const cursor = items.encodeShuffleCursor(0.5, "abc", 0.5, false);
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      cursor: cursor,
    });
    // Row-value so the composite index serves it directly; float8 so
    // Postgres doesn't infer numeric and lose the index to a cast.
    expect(q.text).toMatch(
      /\(shuffle_key, native_id\) > \(\$\d+::float8, \$\d+\)/,
    );
  });

  it("starts a session from its offset without a cursor", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.25",
    });
    expect(q.text).toMatch(
      /\(shuffle_key, native_id\) > \(\$\d+::float8, \$\d+\)/,
    );
    expect(q.params).toContain(0.25);
  });

  it("bounds the wrapped phase so a session stops where it began", () => {
    // After wrapping to 0 the session must stop at its start offset, or the
    // feed repeats items it already showed.
    const cursor = items.encodeShuffleCursor(0.1, "abc", 0.875, true);
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      cursor: cursor,
    });
    expect(q.text).toMatch(/shuffle_key < \$\d+::float8/);
    expect(q.params).toContain(0.875);
  });

  it("does NOT bound the unwrapped phase", () => {
    const cursor = items.encodeShuffleCursor(0.1, "abc", 0.875, false);
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      cursor: cursor,
    });
    expect(q.text).not.toMatch(/shuffle_key < /);
  });

  it("filters by category so the composite index can serve a chip", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
      category: "Photography",
    });
    expect(q.text).toMatch(/category = \$\d+/);
    expect(q.params).toContain("Photography");
  });

  it("applies the shared live-items predicate", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
    });
    expect(q.text).toContain(LIVE_ITEMS_PREDICATE);
  });

  it("is paginated and limited", () => {
    const q = items.buildQuery({
      shape: "manifest",
      order: "shuffle",
      start: "0.5",
    });
    expect(q.paginated).toBe(true);
    expect(q.text).toMatch(/LIMIT \$\d+/);
  });

  it("rejects a start outside [0,1)", () => {
    ["-0.1", "1", "1.5", "NaN", "abc"].forEach((bad) => {
      expect(() => {
        items.buildQuery({ shape: "manifest", order: "shuffle", start: bad });
      }, bad).toThrowError();
    });
  });

  // The guarantee the existing manifest makes, which this must not weaken.
  it("leaves an ordinary manifest complete and unpaged", () => {
    const q = items.buildQuery({ shape: "manifest" });
    expect(q.paginated).toBe(false);
    expect(q.text).not.toMatch(/LIMIT/);
  });

  it("still refuses a cursor on an ordinary manifest", () => {
    expect(() => {
      items.buildQuery({ shape: "manifest", cursor: "anything" });
    }).toThrowError(/cursor is not valid/);
  });
});

// ---------------------------------------------------------------------------
// 3. Declustering across a page boundary
// ---------------------------------------------------------------------------
describe("declusterPageOrder", () => {
  it("with no carry-over behaves exactly like declusterOrder", () => {
    const page = [item(1, "A"), item(2, "A"), item(3, "B"), item(4, "C")];
    expect(declusterPageOrder(page, null, false)).toEqual(
      declusterOrder(page, false),
    );
  });

  it("never returns the carry item itself", () => {
    const carry = item(99, "Rembrandt");
    const page = [item(1, "A"), item(2, "B")];
    const out = declusterPageOrder(page, carry, false);
    expect(out.map((i: any) => i.id)).not.toContain(99);
  });

  it("returns exactly the items it was given, once each", () => {
    const carry = item(99, "A");
    const page = [item(1, "A"), item(2, "A"), item(3, "B"), item(4, "C")];
    const out = declusterPageOrder(page, carry, false);
    expect(out.length).toBe(page.length);
    expect(out.map((i: any) => i.id).sort()).toEqual([1, 2, 3, 4]);
  });

  it("breaks a seam: page 2 must not open on the artist page 1 closed with", () => {
    // Without carry-over the visitor sees the same artist twice in a row
    // across the page boundary, the adjacency declusterOrder() prevents.
    const carry = item(99, "Rembrandt");
    const page = [item(1, "Rembrandt"), item(2, "Vermeer"), item(3, "Hals")];
    const out = declusterPageOrder(page, carry, false);
    expect(out[0].artist).not.toBe("Rembrandt");
  });

  it("leaves the seam alone when an unknown artist is on either side", () => {
    // Treating every "Unknown" as one artist would make the constraint
    // unsatisfiable for artist-sparse categories.
    expect(isRealArtist("Unknown")).toBe(false);
    const carry = item(99, "Unknown");
    const page = [item(1, "Unknown"), item(2, "Vermeer")];
    const out = declusterPageOrder(page, carry, false);
    expect(out[0].id).toBe(1);
  });

  it("checks category across the seam when asked to", () => {
    const carry = item(99, "A", "Photography");
    const page = [item(1, "B", "Photography"), item(2, "C", "Arms & Armor")];
    const out = declusterPageOrder(page, carry, true);
    expect(out[0].category).not.toBe("Photography");
  });

  it("leaves the violation in place when the page holds no clean swap", () => {
    // Expected: a page's look-ahead is bounded, unlike a global pass.
    const carry = item(99, "Rembrandt");
    const page = [item(1, "Rembrandt"), item(2, "Rembrandt")];
    const out = declusterPageOrder(page, carry, false);
    expect(out[0].artist).toBe("Rembrandt");
  });

  it("handles an empty page", () => {
    expect(declusterPageOrder([], item(99, "A"), false)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. The deploy constraint
// ---------------------------------------------------------------------------
describe("Vercel function cap", () => {
  it("api/ still holds at most 12 functions", () => {
    // Hobby caps at 12 and we are at it -- a 13th route fails the deploy
    // silently, so nothing about the failure looks like a failure.
    function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory()
          ? walk(full)
          : e.name.endsWith(".ts")
            ? [full]
            : [];
      });
    }
    const fns = walk(path.join(__dirname, "..", "api"));
    expect(
      fns.length,
      fns.map((f: string) => path.basename(f)).join(", "),
    ).toBeLessThanOrEqual(12);
  });
});
