import { isRealArtist } from "../logic/logic";

// Builds and downloads a CSV of the visitor's saved collection, entirely
// client-side with no server call. An unmapped source falls back to its raw
// slug instead of a hardcoded institution name.
const EXPORT_SOURCE_NAMES: Record<string, string> = {
  met: "The Metropolitan Museum of Art",
  smithsonian: "Smithsonian (Cooper Hewitt)",
  cleveland: "Cleveland Museum of Art",
  commons: "Wikimedia Commons",
  europeana: "Europeana",
};

function csvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export class ExportService {
  exportCollectionCsv(collectedItems: any[]): void {
    const header = ["Title", "Artist", "Date", "Category", "Source", "URL"];
    const rows = collectedItems.map((item: any) =>
      [
        item.title || "Untitled",
        isRealArtist(item.artist) ? item.artist : "Unknown",
        item.date || "",
        item.category || "",
        EXPORT_SOURCE_NAMES[item.source || "met"] || item.source || "",
        item.url || "",
      ]
        .map(csvField)
        .join(","),
    );
    const csv = `${[header.map(csvField).join(",")].concat(rows).join("\n")}\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tranquilo-collection-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
