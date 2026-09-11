Copyright (C) 2026 Tranquilo (tranquilo.art)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.



# Tranquilo

[![Tests](https://github.com/loveycakes/artscroll/actions/workflows/test.yml/badge.svg)](https://github.com/loveycakes/artscroll/actions/workflows/test.yml)
[![Vitest coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/loveycakes/artscroll/main/badges/coverage.json)](https://github.com/loveycakes/artscroll/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

A calm, ad-free, infinite-scroll feed of public-domain art — no algorithm chasing engagement, no accounts required, nothing to buy to just look. Built as a proof of concept to test one question: is a slower, curated way of browsing museum collections actually engaging?

**Live:** [tranquilo.art](https://tranquilo.art)

## What it does

- **A scrolling feed** of public-domain artwork pulled from five open-access museum and archive APIs, with category and facet filtering (region, era, medium, color).
- **Search** with typo correction and a small concept map, so "renaissance" or "couples" surfaces relevant pieces even when the word itself doesn't appear in an item's metadata.
- **Discover**, a shelf-based browsing layer for hand-curated and rule-based collections that cut across categories.
- **Storylines**, short guided sequences connecting works by shared artist, subject, or documented history.
- **Meet the Cast** and **Plot Twist**, two lightweight editorial layers that surface a work's real, verified backstory where one exists — never inferred from the image itself.
- **Share links** with rich previews (title, artist, generated preview image) for iMessage, Slack, and social platforms.
- **Collect** (bookmark) and export your collection as CSV — free, local-only, no account needed.
- **Ambient music**, crossfading by category, built entirely from CC0/public-domain recordings.

## Tech stack

- **Frontend:** TypeScript, [Vite](https://vitejs.dev), one custom element per component, built with [Bun](https://bun.sh).
- **API:** Vercel serverless functions (TypeScript).
- **Database:** Postgres via [Neon](https://neon.tech) — raw SQL through `@neondatabase/serverless`; [Prisma](https://www.prisma.io) is migrations-only, never a query layer.
- **Testing:** [Vitest](https://vitest.dev) + [Playwright](https://playwright.dev) for TypeScript.

## Getting started

Requires [Bun](https://bun.sh).

```
bun install
bun run dev      # frontend only, hot-reload (Vite) — no /api/** routes
bun run vercel   # frontend + real /api/** functions, needs `vercel link` once and a DATABASE_URL
```

`bun run dev` alone won't show any artwork — the feed fetches its catalogue from `/api/items`, so `bun run vercel` (or a real deploy) is what actually serves it locally. See [`.env.example`](.env.example) for every environment variable the project uses.

`bun run build` produces the static `dist/` that Vercel deploys.

## Testing

```
bun run test           # Vitest — feed ordering, search matching, schema validation
bun run test:coverage  # same, with a coverage report (coverage/)
bun run test:e2e       # Playwright, against a real build
```

Both suites run in CI on every push and pull request against `main` ([`.github/workflows/test.yml`](.github/workflows/test.yml)). The coverage badge above reflects the Vitest suite only — the DOM-bound custom elements under `src/components/` and `src/pages/` are exercised by the ~277-test Playwright suite instead, which this number doesn't include.

## Project layout

- `index.html` — the landing page and scrolling feed.
- `pages/` — the drill-in pages: about, submit-a-collection, Tranquilo Pro, privacy, terms, and others.
- `src/` — browser-side TypeScript: components, page entry modules, feed logic, analytics, and shared utilities.
- `api/` — Vercel serverless functions.
- `lib/` — shared server-side TypeScript imported by `api/`.
- `css/` — design tokens and per-component styles.
- `sql/` — the authoritative, hand-run migration history (see [`sql/README.md`](sql/README.md)); `prisma/` mirrors it for tooling but is migrations-only.
- `tests/` — Vitest and Playwright suites.

Full reference: [STANDARDS.md](STANDARDS.md) (stack and tooling) and [CONVENTIONS.md](CONVENTIONS.md) (naming rules).

## Licensing

**Code:** [AGPL-3.0-or-later](LICENSE).

| Source | Basis |
|---|---|
| The Metropolitan Museum of Art | `isPublicDomain` field, from the Met's own Collection API |
| Cleveland Museum of Art | CC0, filtered server-side via the Open Access API |
| Smithsonian Open Access | per-image `usage.access` field (checked at the image level, not the coarser object level) |
| Europeana | each item's own `rights` URI, checked against an open-license allowlist |
| Wikimedia Commons | each file's own license template, checked against the same allowlist |

That allowlist accepts CC0, Public Domain Mark, and CC BY of any version, and explicitly rejects CC BY-SA, CC BY-NC, and CC BY-ND — regardless of how open a source's own catalogue-level label claims to be.

**Reference data** (artist-name reconciliation, caption grounding): Wikidata facts (CC0, no attribution required) and the Getty Union List of Artist Names ([ODC-BY 1.0](https://www.getty.edu/research/tools/vocabularies/lod/index.html), attribution required — see [NOTICE](NOTICE)).

**Ambient music:** each track is sourced under its own explicit CC0/Public Domain Mark statement.

## Status

Tranquilo is an early-stage, self-funded proof of concept, not a finished product — there are no user accounts or cross-device sync, and the free "collect" feature is local-storage only by design.

## Contributing

Bug fixes, accessibility improvements, and documentation updates are welcome directly via pull request. For anything larger — a new feature or a structural change — please open an issue first. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

Found a security issue? Please see [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Documentation

| Doc | What's in it |
|---|---|
| [STANDARDS.md](STANDARDS.md) | The stack, hard constraints, and every rule that exists because something broke without it |
| [CONVENTIONS.md](CONVENTIONS.md) | File naming and code organization |
| [SECURITY.md](SECURITY.md) | What this project handles, and how to report a vulnerability |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to propose and submit changes |
| [AGENTS.md](AGENTS.md) | Conventions for AI coding agents working in this repo |
