// Domain-style labels for the detail view's "View on X" source link.
// Separate from ExportService's EXPORT_SOURCE_NAMES, which holds full
// institutional names for a CSV rather than the actual host item.url points at.
const SOURCE_LINK_LABELS: Record<string, string> = {
  met: "metmuseum.org",
  smithsonian: "cooperhewitt.org",
  cleveland: "clevelandart.org",
  commons: "commons.wikimedia.org",
  europeana: "europeana.eu",
  // The institution's name, not a domain -- digitalarchive.npm.gov.tw
  // reads as noise next to "National Palace Museum" the way it wouldn't
  // for, say, metmuseum.org. See SOURCE_LINK_PREPOSITIONS below for why
  // this one also gets "View AT" instead of "View on".
  npm: "National Palace Museum",
  // Same reasoning as npm above -- the brand name as it appears on
  // Wellcome's own About page ("Wellcome Collection"), not the bare
  // domain or the uncapitalized source id (the fallback below, before
  // this entry existed).
  wellcome: "Wellcome Collection",
};

// Every other source's label is a domain ("View on metmuseum.org"), where
// "on" reads naturally. A named institution wants "at" instead ("View at
// the National Palace Museum" is what a person would actually say) --
// keyed separately, rather than baking a preposition into the label
// string itself, so a future domain-style source doesn't inherit "at" by
// copy-paste. Defaults to "on" for every source not listed here.
const SOURCE_LINK_PREPOSITIONS: Record<string, string> = {
  npm: "at",
  wellcome: "at",
};

export function sourceLinkPreposition(item: any): string {
  return SOURCE_LINK_PREPOSITIONS[item?.source] || "on";
}

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
