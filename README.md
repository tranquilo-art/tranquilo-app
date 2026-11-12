Copyright (C) 2026 Tranquilo (tranquilo.art)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

# Tranquilo

[![Tests](https://github.com/tranquilo-art/tranquilo-app/actions/workflows/test.yml/badge.svg)](https://github.com/tranquilo-art/tranquilo-app/actions/workflows/test.yml)
[![Vitest coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/tranquilo-art/tranquilo-app/main/badges/coverage.json)](https://github.com/tranquilo-art/tranquilo-app/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

A calm, ad-free digital museum and open-source art platform.

**Live:** [tranquilo.art](https://tranquilo.art)

## What it does

- **A scrolling feed** of public-domain artwork pulled from five open-access museum and archive APIs, with category and facet filtering (region, era, medium, color).
- **Search** with typo correction and a small concept map.
- **Discover**, a shelf-based browsing layer for hand-curated and rule-based collections that cut across categories.
- **Storylines**, short guided sequences connecting works by shared artist, subject, or documented history.
- **Plot Twist** and **Sets**, two lightweight editorial layers that surface a work's verified backstory where one exists
- **Share links** with rich previews (title, artist, generated preview image)
- **Collect** (bookmark) and export your collection as CSV — free, local-only, no account needed.
- **Ambient music**, crossfading by category, built from CC0/public-domain recordings.

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
- `pages/` — the drill-in pages: about, submit-a-collection, Tranquilo Curator (waitlist), privacy, terms, and others.
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
| National Gallery of Art (Washington) | per-image `openaccess` flag from the NGA Open Data release (CC0) |
| National Palace Museum (Taiwan) | each record's own license statement, which must be Taiwan's [Open Government Data License v1.0](https://data.gov.tw/license) (CC BY 4.0–compatible, attribution required) |
| Te Papa Tongarewa | each image's own rights statement, which must be "No Known Copyright Restrictions"; culturally restricted collections are excluded regardless |
| Wellcome Collection | each image's own license, checked against the same allowlist |
| Art Institute of Chicago | each record's `is_public_domain` field (CC0 data); curatorial descriptions are CC BY 4.0 and credited to the museum |
| Brazilian museums via Tainacan (Museu de Arte do Rio Grande do Sul, Museu do Ouro, Museu Regional Casa dos Ottoni) | the museum's own public-domain statement, plus an independent check that the artist is outside Brazil's life + 70 copyright term |

That allowlist accepts CC0, Public Domain Mark, and CC BY of any version, and explicitly rejects CC BY-SA, CC BY-NC, and CC BY-ND — regardless of how open a source's own catalogue-level label claims to be.

**Reference data** (artist-name reconciliation, caption grounding): Wikidata facts (CC0, no attribution required) and the Getty Union List of Artist Names ([ODC-BY 1.0](https://www.getty.edu/research/tools/vocabularies/lod/index.html), attribution required — see [NOTICE](NOTICE)).

**Ambient music:** each track is sourced under its own explicit CC0/Public Domain Mark statement.

## Status

Tranquilo is an early-stage project — there are no user accounts or cross-device sync, and the free "collect" feature is local-storage only by design.

## Contributing

Bug fixes, accessibility improvements, and documentation updates are welcome directly via pull request. For anything larger — a new feature or a structural change — please open an issue first. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

### Contributors

Thanks to everyone who has helped with code, design, documentation and ideas ([emoji key](https://allcontributors.org/docs/en/emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/loveycakes"><img src="https://avatars.githubusercontent.com/u/309486746?v=4?s=64" width="64px;" alt="Mel"/><br /><sub><b>Mel</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=loveycakes" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://boon.gl/"><img src="https://avatars.githubusercontent.com/u/80543?v=4?s=64" width="64px;" alt="Robert Fletcher"/><br /><sub><b>Robert Fletcher</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=mockdeep" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/elaous"><img src="https://avatars.githubusercontent.com/u/118211557?v=4?s=64" width="64px;" alt="Sam Aouar"/><br /><sub><b>Sam Aouar</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=elaous" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/pollychen-lab"><img src="https://avatars.githubusercontent.com/u/265131177?v=4?s=64" width="64px;" alt="Polly Labs"/><br /><sub><b>Polly Labs</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=pollychen-lab" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/bfs2021"><img src="https://avatars.githubusercontent.com/u/101915083?v=4?s=64" width="64px;" alt="zgy"/><br /><sub><b>zgy</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=bfs2021" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/Vamsi-2581"><img src="https://avatars.githubusercontent.com/u/245859299?v=4?s=64" width="64px;" alt="Vamsi-2581"/><br /><sub><b>Vamsi-2581</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=Vamsi-2581" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/bh-official"><img src="https://avatars.githubusercontent.com/u/162908389?v=4?s=64" width="64px;" alt="bh-official"/><br /><sub><b>bh-official</b></sub></a><br /><a href="https://github.com/tranquilo-art/tranquilo-app/commits?author=bh-official" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

Found a security issue? Please see [SECURITY.md](SECURITY.md) rather than opening a public issue.

## Documentation

| Doc | What's in it |
|---|---|
| [STANDARDS.md](STANDARDS.md) | The stack, hard constraints, and every rule that exists because something broke without it |
| [CONVENTIONS.md](CONVENTIONS.md) | File naming and code organization |
| [SECURITY.md](SECURITY.md) | What this project handles, and how to report a vulnerability |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to propose and submit changes |
| [AGENTS.md](AGENTS.md) | Conventions for AI coding agents working in this repo |

## Provisioning infrastructure

0. Prerequisites: Bun 1.x, AWS CLI v2, jq
```
bun --version && aws --version && jq --version
```

1. Install cloudgear (not published to a registry yet)
```
git clone https://github.com/elaous/cloudgear.git ~/cloudgear
cd ~/cloudgear
bun install
bun run link          # links the cloudgear CLI and the @cloudgear/* packages
```

if you cloned it before: git pull origin main && bun install

2. Link cloudgear into the app, from the app's directory
```
cd <path to tranquilo-app>
bun link cloudgear @cloudgear/dns @cloudgear/secrets @cloudgear/core @cloudgear/blob @cloudgear/cdn @cloudgear/functions
cloudgear --help
```

3. AWS credentials (SSO), us-east-1 for CloudFront, ACM and your buckets
```
aws sso login --profile <your-sso-profile>
export AWS_PROFILE=<your-sso-profile>
export AWS_REGION=us-east-1
aws sts get-caller-identity        # confirm the right account (920042984913)
```

4. Gandi token for the DNS records (not stored anywhere by cloudgear)
```
read -rs GANDI_TOKEN && export GANDI_TOKEN
```

5. Store the app's secrets in SSM under `/cloudgear/tranquilo-app`
```
cloudgear secrets set --from-envfile .env.prod
cloudgear secrets list             # every declared name should be "ok"
```

the env file MUST be git-ignored; cloudgear refuses a tracked one

6. Generate the config from `setup.ts`
```
cloudgear generate setup.ts --project tranquilo-app
git add cloudgear.prototxt cloudgear.env.json   # commit these two together
```

7. Import what already exists (distributions, certificates, buckets).
```
cp .cloudgear/state.json .cloudgear/state.json.bak 2>/dev/null
cloudgear import --all
```

skip it if `.cloudgear/state.json` already has them.

8. Review: read-only, no AWS calls
```
cloudgear plan
# expected: new Lambdas and schedules (+), api.tranquilo.art (~), everything else no change
cloudgear check-dns                # optional; apply runs it anyway
```

9. Dry run: apply WITHOUT --auto-approve prints the plan, runs the checks,
```
cloudgear apply --env prod
```

then asks "Do you want to apply?". Answer n to cancel.

10. Apply for real, once the plan is what you expect
```
cloudgear apply --env prod --auto-approve
```

optional: `CG_DEBUG=true cloudgear apply --env prod --auto-approve` (logs every call)

11. Check the result
```
cloudgear plan                     # should now show no changes
cat .cloudgear/endpoints.json      # deployed URLs
curl -i https://api.tranquilo.art/sitemap.xml
```

check a POST route too; through CloudFront a POST needs the x-amz-content-sha256 header
(router.fetch("name", { method: "POST", body }) adds it)

**Notes:**

* Step 7: it only reads from AWS and records state, and never changes cloud resources. If you already imported, import --all skips what is in state.
* `apply` refuses on: a missing required secret or env variable (step 5), a DNS conflict, or a cloudgear.env.json that doesn’t match the config (re-run step 6). --skip-env-check and --skip-dns-check bypass those; use them only if you know why.
* Step 10: if it stops partway, run the same command again, and it resumes.
* Keep `.cloudgear/state.json` safe (it’s git-ignored by default); back it up before every apply.
