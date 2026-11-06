import { describe, expect, it } from "vitest";
import { gelatoProductUid, orientationOf } from "../lib/print-products.ts";

describe("the orientation of an artwork", () => {
  it("is landscape when wider than tall, and portrait otherwise", () => {
    expect(orientationOf(4000, 3000)).toBe("hor");
    expect(orientationOf(3000, 4000)).toBe("ver");
    expect(orientationOf(3000, 3000)).toBe("hor");
  });
});

describe("the Gelato product for a print", () => {
  it("follows the artwork's orientation for posters and framed prints", () => {
    expect(gelatoProductUid("poster", "ver")).toMatch(/_ver$/);
    expect(gelatoProductUid("poster", "hor")).toMatch(/_hor$/);
    expect(gelatoProductUid("framed", "ver")).toContain("_ver_");
    expect(gelatoProductUid("framed", "hor")).toContain("_hor_");
  });

  it("is the same for either orientation of a tote or mug", () => {
    expect(gelatoProductUid("tote", "ver")).toBe(
      gelatoProductUid("tote", "hor"),
    );
    expect(gelatoProductUid("mug", "ver")).toBe(gelatoProductUid("mug", "hor"));
    expect(gelatoProductUid("mug", "hor")).toMatch(/^mug_/);
  });

  it("follows the artwork's orientation for the mini print", () => {
    expect(gelatoProductUid("mini_print", "ver")).toMatch(/_ver$/);
    expect(gelatoProductUid("mini_print", "hor")).toMatch(/_hor$/);
  });

  it("is absent for an unknown product", () => {
    expect(gelatoProductUid("canvas", "hor")).toBeNull();
  });
});
