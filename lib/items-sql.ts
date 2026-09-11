// Shared SQL fragments for querying the live catalogue. Lives outside
// /api/ for the usual function-cap reason.
//
// Exists because three handlers (api/items.js, api/v/[slug].js,
// api/og/[slug].js) each run their own SELECT against `items` with no
// shared serializer -- a filter that must apply to all three is a
// correctness risk otherwise, since a quarantined item could stay reachable
// by direct share URL. One constant, three call sites.

// Rows the catalogue does not serve. 'quarantined' is the harmonization
// gate holding a fresh ingest back (persisted, never shown); 'flagged'
// stays live on purpose, just queued for human review. 'rejected' is a
// human decision (not art, too thin, too poor an image) and, unlike
// quarantined, protected from being recomputed away by the gate.
// 'delisted' means the source institution's own record moved or
// disappeared -- api/v/[slug].ts's not-found branch treats that
// differently, redirecting to the museum page rather than an ordinary
// not-found.
//
// Written as NOT IN (naming what to hide) so an unrecognised status still
// renders -- the safer failure direction, since accidentally showing an
// item is recoverable and accidentally hiding everything is an outage. The
// NOT NULL DEFAULT 'ok' on the column is what makes that safe.
//
// Photography is suspended catalogue-wide, kept separate from
// review_status so no row's review state needs re-doing when the category
// returns.
const LIVE_ITEMS_PREDICATE =
  "review_status NOT IN ('quarantined', 'rejected', 'delisted') AND category != 'Photography'";

// For a query that has no WHERE clause of its own yet.
const LIVE_ITEMS_WHERE = `WHERE ${LIVE_ITEMS_PREDICATE}`;

// For appending to an existing WHERE clause.
const LIVE_ITEMS_AND = `AND ${LIVE_ITEMS_PREDICATE}`;

export { LIVE_ITEMS_AND, LIVE_ITEMS_PREDICATE, LIVE_ITEMS_WHERE };
