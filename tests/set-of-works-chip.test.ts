// The set-of-works chip's pure logic (setOfWorkFor/setOfWorkPositionLabel),
// tested directly rather than through full slide DOM construction, which
// buildSlide() doesn't have a test harness for yet.
import { describe, expect, it } from "vitest";

// This suite runs in Node, not a browser, but createSlideBuilder()
// unconditionally constructs an IntersectionObserver as a side effect of
// being called, unrelated to the two pure functions under test. A minimal
// stub is enough since neither function touches it.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).IntersectionObserver = FakeIntersectionObserver;

const { createSlideBuilder } = await import("../src/feed/slideBuilder.ts");

// Neither function touches the host object, so an empty stub is enough.
const stubHost = {} as any;

function item(id: string, setOfWorkId: string | null = null): any {
  return { id, set_of_work_id: setOfWorkId };
}

describe("setOfWorkFor", () => {
  it("returns the indexed set of works for an item carrying its id", () => {
    const setOfWorksById = {
      "set-thinker": { id: "set-thinker", items: [{ id: "a" }, { id: "b" }] },
    };
    const slideBuilder = createSlideBuilder(stubHost, {
      pageLoadId: "test",
      storylinesById: {},
      setOfWorksById,
    });
    expect(slideBuilder.setOfWorkFor(item("a", "set-thinker"))).toEqual(
      setOfWorksById["set-thinker"],
    );
  });

  it("returns null when the item has no set_of_work_id", () => {
    const slideBuilder = createSlideBuilder(stubHost, {
      pageLoadId: "test",
      storylinesById: {},
      setOfWorksById: {},
    });
    expect(slideBuilder.setOfWorkFor(item("a", null))).toBeNull();
  });

  it("returns null when the id isn't in the index (not yet loaded)", () => {
    const slideBuilder = createSlideBuilder(stubHost, {
      pageLoadId: "test",
      storylinesById: {},
      setOfWorksById: {},
    });
    expect(slideBuilder.setOfWorkFor(item("a", "set-thinker"))).toBeNull();
  });
});

describe("setOfWorkPositionLabel", () => {
  it("labels an item by its 1-indexed position in the set", () => {
    const slideBuilder = createSlideBuilder(stubHost, {
      pageLoadId: "test",
      storylinesById: {},
      setOfWorksById: {},
    });
    // Bare native_id, not the Postgres composite primary key -- using the
    // composite form here once shipped live with the label always "0 of N".
    const setOfWork = {
      id: "set-thinker",
      items: [{ id: "97797" }, { id: "149563" }],
    };
    expect(slideBuilder.setOfWorkPositionLabel(item("97797"), setOfWork)).toBe(
      "1 of 2 in set",
    );
    expect(slideBuilder.setOfWorkPositionLabel(item("149563"), setOfWork)).toBe(
      "2 of 2 in set",
    );
  });

  it("compares ids as strings, matching the storyline chip's own convention", () => {
    const slideBuilder = createSlideBuilder(stubHost, {
      pageLoadId: "test",
      storylinesById: {},
      setOfWorksById: {},
    });
    // A number, not a string: hand-authored data can carry a literal
    // numeric id where the item's own id always comes back as a string.
    const setOfWork = {
      id: "set-x",
      items: [{ id: 12345 as unknown as string }],
    };
    expect(slideBuilder.setOfWorkPositionLabel(item("12345"), setOfWork)).toBe(
      "1 of 1 in set",
    );
  });
});
