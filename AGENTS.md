# AGENTS.md — AI Assistant Guidelines

This file defines runtime instructions and hard constraints for AI coding agents (Claude Code, Cursor, Copilot, Aider) working on Tranquilo.

---

## 1. Quick Command Reference

Always run local tests before reporting a task as complete:

```bash
# Frontend & Logic Unit Tests
bun run test

# Target/E2E UI Tests (Playwright)
bun run test:e2e:changed   # Test git-modified files only
bun run test:all           # Full suite run

# Code Quality & Formatting
bun run lint               # Biome linter check
bun run lint:fix           # Biome auto-formatter
```

The ingestion pipeline's own test suite runs from its own branch/repo.

---

## 2. Non-Negotiable Hard Constraints

When making changes, you MUST strictly adhere to these boundaries:

* **Vercel Hobby 12-Function Cap:**
  * NEVER create new top-level files in /api/. We are strictly capped at 12 serverless functions (currently at 10).
  * Put shared server logic in lib/. Scheduled tasks must be added as ?job= parameters routed through api/cron/index.ts.
* **ES Modules Only (No CommonJS):**
  * Use import/export everywhere. require() is strictly forbidden.
* **No Bulk External Requests:**
  * Never write scripts or tests that issue unthrottled HTTP requests against partner institution APIs (The Met, Cleveland, Smithsonian, Europeana, Wikimedia). Always test against offline local fixtures.
* **Protect Storage Quotas:**
  * Never run automated browser loops or test scripts against production /img/** endpoints.
* **Protect Analytics Metrics:**
  * Ensure local/automated browser test runs explicitly block or abort requests to cloudflareinsights.com.
* **No ORM Client Generation:**
  * Do NOT install or run @prisma/client or prisma generate. Prisma is for database migrations only (bun run db:migrate:dev). Application queries must use raw SQL via @neondatabase/serverless (TypeScript) or psycopg (Python).

---

## 3. Code Style & Conventions

* **Package Managers:** Use Bun (bun install, bun run) for JS/TS. Use uv (uv sync --project python) for Python. Never run npm, npx, or pip.
* **TypeScript Best Practices:**
  * File naming: PascalCase.ts for single classes, camelCase.ts for utility functions/modules, types/CamelCase.ts for interfaces/types.
  * DOM Events: Use the on(elem, fn) helper (from src/utils/on.ts) instead of raw addEventListener.
  * HTML Strings: Always use ES6 template literals—never + string concatenation.
  * Explicit Directives: Every @ts-ignore or @ts-expect-error MUST be accompanied by an inline explanatory comment.
* **Database & Data Placement:**
  * config.toml is read at build time only. Deployed serverless functions and browser scripts must NEVER read TOML files directly at request time.
  * sql/*.sql files are the authoritative schema reference and must be kept idempotent (CREATE TABLE IF NOT EXISTS).

---

## 4. Git & Commit Hygiene

* **No Foreign Ticket References:** Do NOT include legacy internal ticket prefixes (TRA-, CUR-) in new commit messages or comments. Reference GitHub issues using standard #123 syntax where applicable.
* **Explicit Git Staging:** Always stage explicit file paths (git add src/components/TranquiloFeed.ts). Never run git add -A or git add ..
