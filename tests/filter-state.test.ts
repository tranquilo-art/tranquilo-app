// FilterState owns the feed's current filter, a plain state container --
// these tests cover get/set roundtrips and the snapshot shape
// feedHost.getFilterState() depends on.
import { describe, expect, it } from "vitest";
import { FilterState } from "../src/app/FilterState";

describe("FilterState", () => {
  it("defaults to the All category with everything else unset", () => {
    const state = new FilterState();
    expect(state.getCategory()).toBe("All");
    expect(state.getArtist()).toBeNull();
    expect(state.getSearch()).toBeNull();
    expect(state.getConcept()).toBeNull();
    expect(state.getCollectionFilter()).toBe(false);
    expect(state.getStorylineFilter()).toBe(false);
    expect(state.getBannerHtml()).toBeNull();
  });

  it("round-trips each field through its own getter/setter", () => {
    const state = new FilterState();
    state.setCategory("Paintings");
    state.setArtist("Vincent van Gogh");
    state.setSearch("wheat field");
    state.setConcept({ label: "armor", filter: { category: "Arms & Armor" } });
    state.setCollectionFilter(true);
    state.setBannerHtml("<b>hi</b>");

    expect(state.getCategory()).toBe("Paintings");
    expect(state.getArtist()).toBe("Vincent van Gogh");
    expect(state.getSearch()).toBe("wheat field");
    expect(state.getConcept()).toEqual({
      label: "armor",
      filter: { category: "Arms & Armor" },
    });
    expect(state.getCollectionFilter()).toBe(true);
    expect(state.getBannerHtml()).toBe("<b>hi</b>");
  });

  it("toggleStorylineFilter flips and returns the new value each call", () => {
    const state = new FilterState();
    expect(state.toggleStorylineFilter()).toBe(true);
    expect(state.getStorylineFilter()).toBe(true);
    expect(state.toggleStorylineFilter()).toBe(false);
    expect(state.getStorylineFilter()).toBe(false);
  });

  it("snapshot reflects live field values, not a value frozen at construction", () => {
    const state = new FilterState();
    state.setCategory("Sculpture");
    state.setArtist("Rodin");
    state.setCollectionFilter(true);
    state.toggleStorylineFilter();

    expect(state.snapshot()).toEqual({
      category: "Sculpture",
      artist: "Rodin",
      search: null,
      concept: null,
      collectionFilter: true,
      storylineFilter: true,
    });
  });
});
