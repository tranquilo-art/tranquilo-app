# Coding Conventions

These conventions apply to all TypeScript, Python, and configuration files in the Tranquilo codebase. 

>**Scope Note:** Existing legacy files are brought into compliance gradually as they are touched, rather than renamed or refactored wholesale in a single pass.

---

## File Naming & Architecture Rules

### TypeScript Conventions

| Category | Convention | Example | Usage / Notes |
| :--- | :--- | :--- | :--- |
| **Classes** | `PascalCase.ts` | `TranquiloFeed.ts` | One class per file. Filename matches the exported class name. |
| **Abstract Classes** | `AbstractPascalCase.ts` | `AbstractOverlay.ts` | Base classes for shared behavior (e.g., focus traps, overlays). |
| **Interfaces** | `ICamelCase.ts` | `IStorylineRepository.ts` | One interface per file. |
| **Polymorphic / Correlated Classes** | `camelCase.ts` | `shelfTypes.ts` | Used for 2+ small correlated classes or base + subclasses in one file. |
| **Functions** | `camelCase.ts` | `slugFor.ts` | A module of related pure helper functions. |
| **Types & Enums** | `types/CamelCase.ts`<br>`enums/CamelCase.ts` | `types/Item.ts`<br>`enums/ShelfType.ts` | Individual files inside subfolders, or single `types.ts` / `enums.ts` barrels. |
| **Primitive Constants** | `constants.ts` | `constants.ts` | Exported as `UPPER_CASE` primitives (e.g., `MAX_FEED_PAGE_SIZE = 24`). |
| **Non-Primitive Values** | `camelCase.ts` | `musicBuckets.ts` | Explicitly typed objects/arrays (e.g., `const musicBuckets: MusicBucket[] = [...]`). |
| **HTML Generators** | `dash-case.html.ts` | `storyline-chapter.html.ts` | TypeScript modules or string templates that output HTML. |

#### TypeScript Best Practices
* **Access Control:** Use `private` and `protected` deliberately. Class members are not public by default.
* **Native Decorators:** Use native TS decorators (`@abstract`, `@singleton`, TS 5 stage-3) where they express real system behavior (e.g., singleton services like a collection store). Do not use them on DOM-backed UI components, as the browser already guarantees a single instance per element.
* **DOM Helpers:** Use our lightweight event utility (`on(elem, fn)`) instead of raw `addEventListener` at every call site.
* **HTML String Building:** Always use template literals for HTML strings under `src/`. Never use `+` string concatenation (enforced by Biome's `useTemplate` rule).

---

### Non-TypeScript Conventions

| Category | Convention | Example | Notes |
| :--- | :--- | :--- | :--- |
| **Data & Configuration** | `dash-case.toml`<br>`dash-case.json5` | `config.toml`<br>`music-buckets.json5` | Read at build/dev-time only (see Data Placement below). |
| **HTML Entry Points** | `dash-case.html` | `pages/thank-you.html` | Standard static HTML entry files. |

---

## Tooling & Dependency Guarantees

We maintain an intentional, lightweight dependency budget to keep build times fast and security risks low.

```
┌────────────────────────────────────────────────────────┐
│                   TOOLING STACK                        │
├───────────────────────┬────────────────────────────────┤
│ Runtime & Package Mgr │ Bun (not Node/npm)             │
│ Linter & Formatter    │ Biome (not ESLint/Prettier)    │
│ Bundler               │ Vite                           │
│ Database Migrations   │ Prisma Schema (Migrations only)│
│ Database Driver       │ Raw SQL via @neondatabase/serverless │
└───────────────────────┴────────────────────────────────┘
```

### JS/TS Stack (Bun + Biome)
* **Package Manager:** Use **Bun** exclusively (`bun install`, `bun run <script>`, `bun test`). Never use `npm` or `node`.
* **Linter & Formatter:** Use **Biome** (`bun run lint`, `bun run lint:fix`). Biome is scoped specifically to `src/**` and new configuration files. Legacy files in `js/`, `api/`, or `lib/` are only linted once they are actively migrated into `src/`.
* **Dependency Budget:** We enforce a strict minimal-dependency rule. No extra UI frameworks, CSS toolchains, or unnecessary bundler plugins.

The ingestion pipeline (Python, managed with `uv`) has its own conventions in its own branch/repo.

### Database Strategy (Raw SQL + Prisma Migrations)
* **No ORM or Query Builders:** We do not use `@prisma/client` or dynamic query builders. Every database operation uses **raw, explicit SQL** via `@neondatabase/serverless`.
* **Prisma for Migrations Only:** Prisma is used strictly for managing database schemas and executing migration workflows (`bun run db:migrate:dev`). We always run commands with `--skip-generate` to avoid generating ORM clients.

---

## Data Placement Architecture

To avoid architectural drift, we strictly separate **Config**, **Content**, and **Structure**:

```
               ┌───────────────────────────────┐
               │       DATA PLACEMENT          │
               └──────────────┬────────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
┌─────────┐                 ┌─────────┐                 ┌─────────┐
│ CONFIG  │                 │ CONTENT │                 │STRUCTURE│
└────┬────┘                 └────┬────┘                 └────┬────┘
     │                           │                           │
     ├─ Tooling/tuning knobs     ├─ Curated art & metadata   ├─ Page layouts & UI
     ├─ Stored in TOML/JSON5     ├─ Stored in Postgres DB    ├─ Expressed in TS
     └─ Read at BUILD time only  └─ Served dynamically       └─ Baked into codebase
```

1. **Config (Build-Time Input):** Tooling, CI, and dev-time tuning parameters live in `config.toml` (repo root); the ingestion pipeline keeps its own equivalent in its own branch/repo. 
   * *Rule:* Deployed runtime processes (browsers or serverless functions) **never read TOML files directly**.
   * *Build Loader:* Running `scripts/generate-config.mts` bakes TOML settings into gitignored TS modules (`src/data/config.generated.ts` and `lib/config.generated.ts`) during the build step.
2. **Content (Database):** Curated art items, storylines, shelves, and ambient music choices live in the Postgres database. They are served dynamically, never hardcoded in TOML.
3. **Structure (Code):** Component hierarchy, navigation, and page layouts are defined directly in TypeScript code—never driven by external JSON/TOML layout files.

---

## Testing Strategy

Run targeted test suites while developing, but ensure full suites pass before submitting PRs:

```bash
# JavaScript & UI Testing
bunx vitest run          # Unit & logic tests
bun run test:e2e:changed # Runs Playwright specs only for git-changed files
bun run test:e2e:<group> # Runs a specific test group (e.g., search, lightbox, feed)
bun run test:all         # Runs all JS unit and E2E tests
```

The ingestion pipeline's own test suite runs from its own branch/repo.

**E2E Merge Requirement:** While `test:e2e:changed` helps you iterate quickly, CI will always run the complete, 4-way sharded E2E test suite prior to merging.
