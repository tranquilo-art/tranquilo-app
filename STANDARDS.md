# Technical Standards & Architecture Reference

This document serves as the authoritative technical reference for the Tranquilo codebase. Every rule and constraint detailed here traces directly to real system behavior, performance measurements, or past infrastructure incidents.

---

## 1. Core Technology Stack

We maintain a strict minimal-dependency philosophy to ensure fast builds, small bundles, and predictable serverless deployments.

```
┌────────────────────────────────────────────────────────┐
│                   TRANQUILO STACK                      │
├───────────────────────┬────────────────────────────────┤
│ Browser UI            │ Vanilla Web Components (TS)    │
│ Frontend Bundler      │ Vite → dist/                   │
│ Hosting & Serverless  │ Vercel                         │
│ Package Mgr & Runtime │ Bun (pinned to v1.3.11 in CI)  │
│ Database & Driver     │ Neon Postgres (@neondatabase/serverless) │
│ Code Quality          │ Biome (TS) + Vitest/Playwright │
└───────────────────────┴────────────────────────────────┘
```

### Dependency Budget
We enforce a strict upper limit on production dependencies. Serverless API functions (`/api`) rely on **only 7 core packages** (`@neondatabase/serverless`, `@sentry/node`, `@vercel/blob`, `@vercel/og`, `sharp`, `svix`, `ws`).

> **Standing Rule:** Do not install full third-party SDKs for one-off HTTP tasks. Integrations for services like Resend, Linear, and S3 (using hand-rolled SigV4 authentication) use native `fetch`.

---

## 2. Module System & Code Formatting

* **ES Modules Only:** All TypeScript code under `api/`, `lib/`, `src/`, scripts, and test suites uses native ES Modules (`import`/`export`). CommonJS (`require()`) is strictly prohibited.
* **Biome Linter & Formatter:** We use **Biome** (`bun run lint` / `bun run lint:fix`) scoped to `src/**` and core configuration files. Legacy files are brought into Biome's linting scope only as they are actively refactored.
* **TypeScript Directives:** Any `@ts-ignore` or `@ts-expect-error` directive must be accompanied by an explicit inline explanation justifying its usage.

---

## 3. Hard Operational Constraints

These architectural boundaries prevent silent production deployment failures and API rate-limiting issues:

* **Vercel Hobby 12-Function Cap:** Vercel's free tier permits a maximum of **12 serverless function files** under `/api/` (we currently use 10). Exceeding this limit causes silent deployment failures.
  * *Rule:* Never create a new top-level file in `/api/`. Shared logic belongs in `lib/`, and scheduled jobs must be added as new `?job=` parameters routed through the single dispatcher at `api/cron/index.ts`.
* **API Rate Limits & Bulk Fetching:** Never execute bulk, un-throttled API requests against third-party institution endpoints (e.g., The Met, Cleveland Museum of Art, Europeana, Smithsonian, or Wikimedia Commons).
  * *Wikimedia Rule:* Requests must always set a valid `WIKIMEDIA_USER_AGENT`, run with 40–50 items per batch, and respect a 15–20 minute cooldown between runs.
* **Image Proxy Protection:** Never run automated scripts against `/img/**` endpoints, as each request consumes operations from our serverless storage quotas.
* **Analytics Protection:** Automated test suites and local development drivers must block the Cloudflare analytics beacon (e.g., aborting `cloudflareinsights.com` requests) to prevent skewed production metrics.

---

## 4. Architecture & Data Placement

### Separating Config, Content, and Structure

| Layer | Responsibility | Storage Location | Access Pattern |
| :--- | :--- | :--- | :--- |
| **Config** | Tooling knobs, tuning parameters, build options | `config.toml` (repo root) | Read at **build time** only. Never read directly by deployed browsers or serverless functions at request time. |
| **Content** | Curated artworks, storylines, shelves, ambient music | Postgres Database (Neon) | Queried dynamically at runtime via `/api` functions. |
| **Structure** | UI components, menu order, layout composition | TypeScript Source Code (`src/`) | Baked directly into the application bundle. |

### Performance Invariants
* **Paged Server-Side Feed:** The primary artwork feed uses server-side pagination powered by an indexed `shuffle_key` cursor. Client-side arrays represent the currently loaded page cache, not the entire catalogue.
* **Slide Recycling:** Releasing or recycling a feed slide must invoke `imageState.cancel()` to prevent lingering background failure timers from invalidating valid items.
* **DOM vs. Item Offsets:** Non-item slides (such as the feed intro card or empty-collection prompts) affect DOM index offsets. Positional calculations must verify whether non-item slides were rendered rather than assuming static array offsets.

---

## 5. Database Strategy & Migrations

* **Authoritative Schema (`sql/*.sql`):** The raw SQL files in `sql/*.sql` remain the ultimate source of truth for the database schema. All SQL files are written to be idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
* **Prisma for Migrations Only:** We use Prisma Migrate strictly to manage schema versioning and deployment workflows (`bun run db:migrate:dev`). We do not install or generate `@prisma/client`.
* **Raw SQL Queries:** Every application query uses raw SQL via `@neondatabase/serverless` (TypeScript).
* **Direct Connection Strings for Migrations:** Prisma Migrate requires persistent session locks (`pg_advisory_lock`). Always use Neon's direct (non-pooled) connection string when running migrations, while keeping runtime application queries on the pooled endpoint.

---

## 6. Testing, CI & Quality Assurance

Our offline testing setup guarantees reliable local feedback without depending on external API availability or CI minutes.

```bash
# Local Development & Validation Commands
bun run test:e2e:changed  # Runs Playwright E2E tests for changed git paths
bun run test              # Runs all Vitest logic and unit tests
bun run lint              # Executes Biome formatting and linting checks
```

The ingestion pipeline's own test suite runs from its own branch/repo.

### Continuous Integration (GitHub Actions)

* CI executes the complete E2E test suite sharded 4 ways across parallel runners.
* Pull requests require the `test-e2e-required` status gate to pass prior to merging.

---

## 7. Workflow & Security Best Practices

* **Explicit Git Staging:** Always stage specific file paths (`git add src/components/...`). Avoid blanket commands like `git add -A` to prevent accidental commits of local secrets or temporary artifacts.
* **Credential Safety:** Never pipe environment variables or secrets through shell commands or logs. Verify environment files by variable name only.
* **Preserve Decision Context:** Code comments often document why a specific pattern or workaround was implemented. Always review existing header comments before refactoring complex modules.
