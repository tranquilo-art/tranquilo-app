// ExportService owns the client-side "download my collection as CSV"
// feature. No DOM environment is configured for this suite, so the
// Blob/anchor-click download path is stubbed directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportService } from "../src/app/ExportService";

let createObjectURLMock: ReturnType<typeof vi.fn>;
let revokeObjectURLMock: ReturnType<typeof vi.fn>;
let capturedCsv: string;
let clickMock: ReturnType<typeof vi.fn>;
let appendedAnchor: any;

beforeEach(() => {
  capturedCsv = "";
  vi.stubGlobal(
    "Blob",
    class {
      parts: string[];
      type: string;
      constructor(parts: string[], opts: { type: string }) {
        this.parts = parts;
        this.type = opts.type;
        capturedCsv = parts.join("");
      }
    },
  );
  createObjectURLMock = vi.fn(() => "blob:fake-url");
  revokeObjectURLMock = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: createObjectURLMock,
    revokeObjectURL: revokeObjectURLMock,
  });
  clickMock = vi.fn();
  appendedAnchor = null;
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const el: any = { tagName: tag, click: clickMock };
      appendedAnchor = el;
      return el;
    },
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
  });
});

describe("exportCollectionCsv", () => {
  it("writes a header row plus one row per item", () => {
    const svc = new ExportService();
    svc.exportCollectionCsv([
      {
        title: "Wheat Field",
        artist: "Vincent van Gogh",
        date: "1888",
        category: "Paintings",
        source: "met",
        url: "https://example.com/1",
      },
    ]);
    const lines = capturedCsv.trim().split("\n");
    expect(lines[0]).toBe("Title,Artist,Date,Category,Source,URL");
    expect(lines[1]).toBe(
      "Wheat Field,Vincent van Gogh,1888,Paintings,The Metropolitan Museum of Art,https://example.com/1",
    );
  });

  it("defaults a missing title to Untitled and an unreal artist to Unknown", () => {
    const svc = new ExportService();
    svc.exportCollectionCsv([{ artist: "Unknown", source: "cleveland" }]);
    const [, row] = capturedCsv.trim().split("\n");
    expect(row).toBe("Untitled,Unknown,,,Cleveland Museum of Art,");
  });

  it("falls back to the raw source string for an unmapped source", () => {
    const svc = new ExportService();
    svc.exportCollectionCsv([{ source: "some-new-source" }]);
    const [, row] = capturedCsv.trim().split("\n");
    expect(row).toContain("some-new-source");
  });

  it("quotes a field containing a comma, quote, or newline", () => {
    const svc = new ExportService();
    svc.exportCollectionCsv([
      { title: 'A "Great" Work, Really', source: "met" },
    ]);
    const [, row] = capturedCsv.trim().split("\n");
    expect(row.startsWith('"A ""Great"" Work, Really",')).toBe(true);
  });

  it("triggers a download and revokes the object URL", () => {
    const svc = new ExportService();
    svc.exportCollectionCsv([{ source: "met" }]);
    expect(createObjectURLMock).toHaveBeenCalledOnce();
    expect(clickMock).toHaveBeenCalledOnce();
    expect(appendedAnchor.download).toMatch(
      /^tranquilo-collection-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:fake-url");
  });
});
