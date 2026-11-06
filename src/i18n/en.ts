// English UI strings -- the source of truth. MessageKey is derived from
// this object, so every t("...") call is checked against it at typecheck,
// and every other language's dictionary is typed as a partial copy of it
// (a misspelled key in a translation file fails typecheck too).
//
// Conventions:
//   - Keys are flat and namespaced by component: "upsell.cta".
//   - {name} placeholders are filled by t(key, { name }).
//   - Plurals are sibling keys ending in a CLDR plural category --
//     "works.count.one" / "works.count.other" -- looked up with
//     tn("works.count", n). Always include ".other".
//   - Plain text only. Components insert strings with textContent or
//     setAttribute, never innerHTML, so markup here would show literally.

export const en = {
  // <tranquilo-upsell-toast>
  "upsell.body":
    "Saved temporarily in this browser. Permanent collections and organization are part of Tranquilo Curator, still taking shape.",
  "upsell.cta": "Join the waitlist",
  "upsell.dismiss": "Dismiss",

  // The first-scroll cue under the feed (#scrollHint in index.html).
  "feed.scrollHint": "scroll to explore",

  // Intro slide (src/feed/introSlides.ts). {works} is a rounded count like
  // "10k+"; {count} is the number of sources.
  "intro.heading": "A calmer way to scroll.",
  "intro.tagline.one":
    "Enjoy calm scrolling with {works} public-domain works across {count} source.",
  "intro.tagline.other":
    "Enjoy calm scrolling with {works} public-domain works across {count} sources.",
  "intro.mission.title": "Mission",
  "intro.mission.body": "Open source & ad‑free.",
  "intro.mission.cta": "Get involved",
  "intro.connect.title": "Connect",
  "intro.connect.body": "Monthly curated art.",
  "intro.connect.cta": "Subscribe",
  "intro.support.title": "Support",
  "intro.support.body": "Sustained by community.",
  "intro.support.cta": "Give",

  // My Collection's empty slide. A newline in the title is a line break.
  "collection.empty.eyebrow": "My Collection",
  "collection.empty.title": "Nothing collected\nyet.",
  "collection.empty.body": "Tap the bookmark on any piece to start.",

  // The AI-disclosure note on Tea captions -- APPROVED WORDING, held here
  // so other languages can be reviewed before any is shown. Components do
  // not read these yet (they carry the locked English directly); the
  // English must stay identical to it -- tests/ai-disclosure-static.test.ts.
  // A translation needs explicit approval, not just a native-speaker pass:
  // it backs a claim in the Terms about human editorial review.
  "ai.disclosure.text":
    "Drafted with AI help; edited and reviewed by a person.",
  "ai.disclosure.errorPrompt": "Spotted an error?",
  "ai.disclosure.badgeLabel": "How this text was written",

  // Shared across components.
  "common.untitled": "Untitled",

  // Feed slides (src/feed/slideBuilder.ts).
  "slide.nudity.label": "This image may contain nudity. Tap to reveal.",
  "slide.nudity.line1": "May contain nudity",
  "slide.nudity.line2": "Tap to reveal",
  "slide.imageError": "Couldn’t load image — tap to retry",
  // {position} is slide.position, e.g. "3 of 13".
  "slide.storylineChip": "Storyline · {position}",
  "slide.position": "{index} of {total}",
  "slide.setPosition": "{index} of {total} in set",
  "slide.share": "Copy share link",
  "slide.collect.add": "Collect this piece",
  "slide.collect.remove": "Remove from collection",

  // <tranquilo-detail-modal>. The AI-disclosure note is deliberately NOT
  // here: it's fixed, approved wording (tests/ai-disclosure-static.test.ts)
  // and needs its own approved translation before it can vary by language.
  "detail.close": "Close",
  "detail.shelfPrev": "Previous in this shelf",
  "detail.shelfNext": "Next in this shelf",
  "detail.source": "Source",
  // aria-label on a caption source icon; {host} is e.g. "metmuseum.org".
  "detail.sourceHost": "Source: {host}",
  "detail.sources": "Sources",
  // aria-label on a caption's book icon; {title} is the book's title.
  "detail.bookSource": "Book: {title}",
  "detail.twist": "The Twist",
  "detail.cast.title": "Meet the Cast",
  "detail.cast.possibly": "Possibly {name}",
  "detail.cast.noDetail": "No verified detail available yet.",
  "detail.fact.didYouKnow": "Did you know?",
  "detail.fact.basic": "Basic Information",
  "detail.meta.artist": "Artist",
  "detail.meta.created": "Created",
  "detail.meta.material": "Material",
  "detail.meta.artistOrigin": "Artist origin",
  "detail.meta.objectOrigin": "Object origin",
  "detail.meta.origin": "Origin",
  "detail.meta.culture": "Culture",
  "detail.meta.photographDate": "Date of photograph",
  "detail.meta.photographer": "Photographer",
  "detail.meta.provenance": "Provenance",
  "detail.meta.tagged": "Tagged",
  "detail.meta.license": "License",
  // The link to the institution's own page for the work (also on the error
  // page). "on" for a domain, "at" for a named institution: see
  // SOURCE_LINK_PREPOSITIONS in src/app/sourceLinks.ts.
  "detail.sourceLink.on": "View on {institution}",
  "detail.sourceLink.at": "View at {institution}",
  "detail.cite.button": "Cite this work",
  "detail.cite.copy": "Copy",
  "detail.cite.copied": "Copied",
  "detail.cite.failed": "Couldn't copy",
  "detail.print.button": "Get a print",
  "detail.print.soon": "Checkout is opening soon.",
  "detail.print.shipTo": "Ship to",
  "detail.print.priceLoading": "Getting price…",
  "detail.print.priceUnavailable": "Price unavailable",
  "detail.print.notAvailable": "Not available in {country}",
  "detail.print.deliveryIncluded": "includes about {price} delivery",
  "detail.print.deliveryDays": "{min}–{max} days",
  "detail.print.approximate": "Delivery prices are approximate.",
  "detail.print.importTax":
    "The buyer is responsible for import taxes in Brazil.",
  "detail.print.showMockup": "Show the {product} mock-up",
  "detail.print.mockupNote":
    "A preview. The printed colours and edges may differ slightly.",
  "print.product.mini_print": "Mini print",
  "print.product.poster": "Poster",
  "print.product.framed": "Framed poster",
  "print.product.tote": "Tote bag",
  "print.product.mug": "Mug",
  "print.size.mini_print": "13 × 18 cm",
  "print.size.poster": "40 × 50 cm",
  "print.size.framed": "40 × 50 cm",
  "print.size.tote": "Natural cotton",
  "print.size.mug": "325 ml (11 oz)",
  "detail.report.button": "Report a problem",
  "detail.report.image": "There's an issue with image",
  "detail.report.content": "There's an issue with content",
  "detail.report.technical": "I'm having a technical issue (broken link)",
  "detail.report.more": "Tell us more",
  "detail.report.commentPlaceholder": "Anything else? (optional)",
  "detail.report.send": "Send",
  "detail.report.thanks":
    "Thanks, your feedback has been sent. We'll take a look.",

  // Search panel and results lines. Strings with {query}/{suggestion}/
  // {count} are rendered with tHtml/tnHtml: the values carry markup.
  "search.placeholder": "Search artist, title, category, era…",
  "search.submit": "Run search",
  "search.close": "Close search",
  "search.recent": "Recent searches",
  "search.browseBy": "Browse by",
  "search.related": "Showing pieces related to “{concept}”",
  "search.results.one": "{count} result for “{query}”",
  "search.results.other": "{count} results for “{query}”",
  "search.noResults": "No results for “{query}.”",
  "search.didYouMean": "No results for “{query}.” Did you mean {suggestion}?",

  // Filter banner under the top bar.
  "filter.moreBy": "More by {artist}",
  "filter.collection": "{title} ({count})",
  "collection.toast.empty": "Nothing collected yet",

  "share.copied": "Link copied",
  "share.failed": "Couldn't copy link",

  // Shown when the catalogue fails to load (src/errorState.ts).
  "error.heading": "We’re having a problem right now, but we’ll be back soon.",
  "error.retry": "Try again",
  "error.home": "Back to Tranquilo",

  // <tranquilo-support-strip> and its donation dialog.
  "support.strip.line": "Tranquilo runs on direct support, not ads.",
  "support.strip.unavailable":
    "Donations are briefly unavailable. Thank you for wanting to — please try again shortly.",
  "support.strip.soon": "Donations open soon.",
  "support.strip.donate": "Donate",
  "support.dialog.close": "Close",
  "support.dialog.title": "Support Tranquilo",
  "support.dialog.body":
    "Every contribution goes to hosting and the quiet cost of keeping this running.",
  "support.dialog.once": "Give once",
  "support.dialog.monthly": "Give monthly",
  "support.dialog.perMonth": "per month",
  "support.dialog.note":
    "Payment is handled by Stripe — Tranquilo never sees your card details. Amounts are shown in your own currency at checkout.",
  "support.once.note": "Choose your own amount",

  // <tranquilo-patreon-link> on the Support and Thank-you pages.
  "support.patreon.body":
    "Prefer a membership? Join us on Patreon and follow along as Tranquilo grows.",
  "support.patreon.join": "Join on Patreon",
  "support.patreon.soon": "Patreon opens soon.",

  // Discover (shelves) mode.
  "shelves.home": "Tranquilo, back to the homepage",
  "shelves.title": "Discover",
  "shelves.close": "Close discover",
  "shelves.storylines.title": "Storylines",
  "shelves.storylines.subtitle": "Curated stories behind the art",
  "shelves.moods.title": "Shelves, Curated by Hand",
  "shelves.moods.subtitle": "Pick a mood and enjoy",
  "shelf.close": "Close shelf",
  "shelf.share": "Copy link to this shelf",
  "shelf.works.one": "{count} work",
  "shelf.works.other": "{count} works",

  // Storyline mode.
  "storyline.close": "Close storyline",
  "storyline.prev": "Previous page",
  "storyline.next": "Next page",
  "storyline.hint.arrows": "Use the arrows to begin →",
  "storyline.hint.swipe": "Swipe to begin →",
  "storyline.share": "Copy link to this storyline",
  "storyline.chapterOf": "Chapter {index} of {total}",
  "storyline.goToChapter": "Go to chapter {index}",

  "setOfWorks.details": "View details",

  // Collection export confirmation.
  "export.title": "Your CSV is downloading",
  "export.body":
    "Syncing across devices, organized lists, and sharing are part of Tranquilo Curator, still taking shape.",

  // Lightbox. {institution} is the source's display name.
  "lightbox.loading": "Loading full resolution…",
  "lightbox.sourceRecord": "Source record at {institution}",
  "lightbox.fullResolution": "Full resolution at {institution}",

  // Static pages' layout (vite-plugins/base-template.mts, at build time).
  "nav.home": "Home",
  "nav.about": "About",
  "nav.submit": "Submit",
  "nav.getInvolved": "Get involved",
  "nav.support": "Support us",
  "footer.feedback": "Feedback",
  "footer.legal": "Terms & Privacy",
  "footer.curator": "Tranquilo Curator Waitlist",
  // The language switcher's accessible name (top bar menu, page footer).
  "language.label": "Language",

  // About page community section (vite-plugins/community-partial.mts).
  // {handle} is a GitHub handle such as "@octocat".
  "community.title": "Community",
  "community.intro":
    "Tranquilo is built in the open, with help from these people. Thank you.",
  "community.contributors": "Contributors on GitHub",
  "community.donors": "Supporters",
  "community.patrons": "Patrons on Patreon",
  "community.avatarAlt": "{handle} on GitHub",

  // Email sign-up forms on static pages (src/pages/*.ts).
  "form.joining": "Joining…",
  "form.error": "Something went wrong — please try again in a moment.",
  "form.email": "Email",
  "form.emailPlaceholder": "you@example.com",
  "form.emailInvalid": "Please enter a valid email address.",
  "about.notify.cta": "Notify me",
  "curator.cta": "Join the waitlist",

  // The Feedback and Submit forms' busy and failure text (src/pages/*.ts).
  "feedback.sending": "Sending…",
  "feedback.submit": "Send feedback",
  "feedback.error":
    "That didn't send. Your message is still here — try again in a moment.",
  "submit.sending": "Submitting…",
  "submit.submit": "Submit for review",
  "submit.error":
    "Something went wrong sending this — please try again in a moment.",

  // The homepage newsletter dialog (TranquiloNewsletterModal.ts); its
  // email field and status messages use the form.* keys above.
  "newsletter.close": "Close",
  "newsletter.title": "Enjoy a monthly art moment",
  "newsletter.body": "A monthly note with curated art. No spam.",
  "newsletter.subscribe": "Subscribe",
  "newsletter.success": "You're on the list — look out for our next note.",

  // <tranquilo-topbar>
  "topbar.shareBanner.text": "Tranquilo is open source and volunteer-run.",
  "topbar.shareBanner.newsletter": "Get newsletter",
  "topbar.shareBanner.involved": "Get involved",
  "topbar.shareBanner.dismiss": "Dismiss",
  "topbar.home": "Tranquilo, back to the top",
  "topbar.music": "Toggle music",
  "topbar.search": "Search",
  "topbar.discover": "Discover shelves",
  "topbar.collection.label": "My Collection",
  // Screen-reader label for the bookmark button; {count} saved items.
  "topbar.collection.empty": "My Collection, empty",
  "topbar.collection.count.one": "My Collection, {count} item",
  "topbar.collection.count.other": "My Collection, {count} items",
  "topbar.filter.export": "Export",
  "topbar.filter.clear": "Show all",
  // Artist card shown above search results for an artist.
  "artistCard.wikipedia": "Read more on Wikipedia",
  "artistCard.wikidata": "View on Wikidata",

  // Category chip row: the reset chip (its filter value stays "All"), the
  // Storyline toggle, and the overflow menu button.
  "chips.all": "All",
  "chips.storyline": "Storyline",
  "chips.more": "More",

  // Display labels for controlled-vocabulary values, keyed by facetKey()
  // (src/i18n/facets.ts) and rendered with facetLabel(). Every term in
  // shared/vocabulary.json needs one; tests/i18n-facets.test.ts enforces it.
  // English labels match the stored value except where the stored value is
  // a slug (subject_type).
  "facet.category.paintings-portraits": "Paintings & Portraits",
  "facet.category.sculpture-objects": "Sculpture & Objects",
  "facet.category.works-on-paper": "Works on Paper",
  "facet.category.arms-armor": "Arms & Armor",
  "facet.category.photography": "Photography",

  "facet.region.europe": "Europe",
  "facet.region.east-asia": "East Asia",
  "facet.region.south-asia": "South Asia",
  "facet.region.southeast-asia": "Southeast Asia",
  "facet.region.west-asia-middle-east": "West Asia & Middle East",
  "facet.region.africa": "Africa",
  "facet.region.north-america": "North America",
  "facet.region.latin-america-caribbean": "Latin America & Caribbean",
  "facet.region.americas": "Americas",
  "facet.region.oceania": "Oceania",

  "facet.timeframe.ancient-classical": "Ancient & Classical",
  "facet.timeframe.medieval": "Medieval",
  "facet.timeframe.renaissance": "Renaissance",
  "facet.timeframe.baroque-enlightenment": "Baroque & Enlightenment",
  "facet.timeframe.19th-century": "19th Century",
  "facet.timeframe.modern-contemporary": "Modern & Contemporary",

  "facet.media_type.painting": "Painting",
  "facet.media_type.print-drawing": "Print/Drawing",
  "facet.media_type.photograph": "Photograph",
  "facet.media_type.ceramic": "Ceramic",
  "facet.media_type.metalwork": "Metalwork",
  "facet.media_type.stone-sculpture": "Stone Sculpture",
  "facet.media_type.textile": "Textile",
  "facet.media_type.glass": "Glass",
  "facet.media_type.decorative-object": "Decorative Object",

  "facet.palette.red": "Red",
  "facet.palette.orange": "Orange",
  "facet.palette.gold-yellow": "Gold/Yellow",
  "facet.palette.green": "Green",
  "facet.palette.teal": "Teal",
  "facet.palette.blue": "Blue",
  "facet.palette.purple": "Purple",
  "facet.palette.pink": "Pink",
  "facet.palette.neutral": "Neutral",

  "facet.subject_type.portrait": "Portrait",
  "facet.subject_type.religious": "Religious",
  "facet.subject_type.landscape": "Landscape",
  "facet.subject_type.genre-scene": "Genre scene",
  "facet.subject_type.still-life": "Still life",
  "facet.subject_type.other": "Other",

  // The templated caption shown when an item has no written one.
  "caption.basic.untitled": "Untitled",
  "caption.basic.by": "by {artist}",
} as const;

export type MessageKey = keyof typeof en;

/** A translation: any subset of the English keys. Missing keys fall back. */
export type Dictionary = Partial<Record<MessageKey, string>>;
