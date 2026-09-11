// SlugCodec owns the {source}-{native_id} share-link slug encoding and
// reading it back from location. No DOM environment is configured for
// this suite, so `location` is stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SlugCodec } from "../src/app/SlugCodec";

describe("encodeId", () => {
  it("passes a plain met/cleveland/smithsonian id through unchanged", () => {
    const codec = new SlugCodec();
    expect(codec.encodeId("met", "436572")).toBe("436572");
  });

  it("drops the redundant Commons File: prefix", () => {
    const codec = new SlugCodec();
    expect(codec.encodeId("commons", "File:A Colorful Spring.jpg")).toBe(
      "A%20Colorful%20Spring.jpg",
    );
  });

  it("swaps Europeana's internal / for a - so it stays one path segment", () => {
    const codec = new SlugCodec();
    expect(codec.encodeId("europeana", "/2064116/Museu_foo")).toBe(
      "2064116-Museu_foo",
    );
  });

  it("only escapes %, /, #, ?, and whitespace -- literal non-ASCII passes through", () => {
    const codec = new SlugCodec();
    expect(codec.encodeId("commons", "岁")).toBe("岁");
  });

  it("escapes a literal % so decoding stays unambiguous", () => {
    const codec = new SlugCodec();
    expect(codec.encodeId("met", "100%")).toBe("100%25");
  });
});

describe("decodeId", () => {
  it("is the inverse of encodeId for a plain id", () => {
    const codec = new SlugCodec();
    expect(codec.decodeId("met", codec.encodeId("met", "436572"))).toBe(
      "436572",
    );
  });

  it("restores the Commons File: prefix", () => {
    const codec = new SlugCodec();
    const encoded = codec.encodeId("commons", "File:A Colorful Spring.jpg");
    expect(codec.decodeId("commons", encoded)).toBe(
      "File:A Colorful Spring.jpg",
    );
  });

  it("restores Europeana's internal /", () => {
    const codec = new SlugCodec();
    const encoded = codec.encodeId("europeana", "/2064116/Museu_foo");
    expect(codec.decodeId("europeana", encoded)).toBe("/2064116/Museu_foo");
  });

  it("accepts an old-style, whole-slug-encoded Commons id unchanged", () => {
    const codec = new SlugCodec();
    expect(
      codec.decodeId("commons", encodeURIComponent("File:Old Link.jpg")),
    ).toBe("File:Old Link.jpg");
  });

  it("accepts an old-style, whole-slug-encoded Europeana id unchanged", () => {
    const codec = new SlugCodec();
    expect(
      codec.decodeId("europeana", encodeURIComponent("/2064116/Museu_foo")),
    ).toBe("/2064116/Museu_foo");
  });
});

describe("decodeSlug", () => {
  it("splits on the first hyphen into source and id", () => {
    const codec = new SlugCodec();
    expect(codec.decodeSlug("met-436572")).toBe("met-436572");
  });

  it("decodes only the id half, source stays literal", () => {
    const codec = new SlugCodec();
    const encoded = `europeana-${codec.encodeId("europeana", "/2064116/Museu_foo")}`;
    expect(codec.decodeSlug(encoded)).toBe("europeana-/2064116/Museu_foo");
  });

  it("decodeURIComponent()s a slug with no hyphen at all", () => {
    const codec = new SlugCodec();
    expect(codec.decodeSlug("bare%20slug")).toBe("bare slug");
  });
});

describe("slugFromLocation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the /v/{slug} path form", () => {
    vi.stubGlobal("location", {
      pathname: "/v/met-436572",
      hash: "",
    });
    const codec = new SlugCodec();
    expect(codec.slugFromLocation()).toBe("met-436572");
  });

  it("falls back to the historical #{slug} hash form", () => {
    vi.stubGlobal("location", {
      pathname: "/index.html",
      hash: "#met-436572",
    });
    const codec = new SlugCodec();
    expect(codec.slugFromLocation()).toBe("met-436572");
  });
});

describe("storylineIdFromLocation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the /s/{id} path form", () => {
    vi.stubGlobal("location", { pathname: "/s/el-greco-evolution" });
    const codec = new SlugCodec();
    expect(codec.storylineIdFromLocation()).toBe("el-greco-evolution");
  });

  it("returns an empty string off any other path", () => {
    vi.stubGlobal("location", { pathname: "/index.html" });
    const codec = new SlugCodec();
    expect(codec.storylineIdFromLocation()).toBe("");
  });
});
