// Domain-style labels for the detail view's "View on X" source link.
// Separate from ExportService's EXPORT_SOURCE_NAMES, which holds full
// institutional names for a CSV rather than the actual host item.url points at.
const SOURCE_LINK_LABELS: Record<string, string> = {
  met: "metmuseum.org",
  smithsonian: "cooperhewitt.org",
  cleveland: "clevelandart.org",
  commons: "commons.wikimedia.org",
  europeana: "europeana.eu",
};

// Europeana aggregates rather than holds: its `url` lands on a portal
// record that then points at whichever of roughly 26 institutions actually
// has the object. Every other source's `url` is the holding museum's own
// object page.
const SOURCE_IS_AGGREGATOR: Record<string, boolean> = { europeana: true };

// Falls back to the raw source string if a future source is added before
// SOURCE_LINK_LABELS is, so an unmapped source still shows something
// honest rather than a wrong institution name.
export function sourceLinkLabel(item: any): string {
  return SOURCE_LINK_LABELS[item?.source] || item?.source || "source";
}

export function isAggregatorSource(item: any): boolean {
  return !!SOURCE_IS_AGGREGATOR[item?.source];
}
