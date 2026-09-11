# sql/

Every file here is a one-time, run-by-hand-in-Neon's-web-SQL-editor migration
against Tranquilo's Postgres database. Each file is idempotent
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, etc.) so
re-running one is always safe.

**These files stay exactly where they are — they are not superseded by
Prisma.** `tests/helpers/pg.ts`'s `makeSql([...])` calls and
`python/scripts/restore_from_backup.py`'s `SCHEMA_FILE` constant both read
individual files here directly, by their real `NNN_` names, and will keep
doing so. Every `sql/NNN_name.sql` has a matching folder under
`prisma/migrations/`, each a verbatim copy of that file — Prisma's history
is a mirror of this directory, not a replacement for it. `001`-`018`
predate Prisma and are folded into one `20260819000000_baseline` migration
rather than one folder each.

Before `prisma migrate dev`/`deploy` can be used for a *new* migration, every
migration already applied by hand against Neon has to be marked as such —
never actually re-*executed* there:

```
prisma migrate resolve --applied 20260819000000_baseline
prisma migrate resolve --applied 20260829113515_storylines
prisma migrate resolve --applied 20260829113516_storylines_seed
prisma migrate resolve --applied 20260904212049_shelves
prisma migrate resolve --applied 20260904212050_shelves_seed
prisma migrate resolve --applied 20260904212051_music_buckets
prisma migrate resolve --applied 20260904212052_music_buckets_seed
prisma migrate resolve --applied 20260905014242_img_cache_native_id
prisma migrate resolve --applied 20260905014243_img_object_keys
prisma migrate resolve --applied 20260905014244_hero_items
prisma migrate resolve --applied 20260905014245_hero_items_seed
prisma migrate resolve --applied 20260905034739_music_buckets_retire_architecture_space
```

Run `prisma migrate status` first — it lists which of these Prisma already
knows about, so only the ones it's missing need resolving. Going forward, a
schema change gets *both*: a new `sql/NNN_name.sql` and its own
`prisma/migrations/<timestamp>_<name>/migration.sql`, then `prisma migrate
resolve --applied <name>` once it's actually been run against Neon.

Verified via PGlite (an in-process Postgres, the same engine
`tests/helpers/pg.ts` uses for the test suite): every file from `001`
through the latest applies cleanly to a fresh database in order, including
the `unaccent`/`pg_trgm` extensions and the `search_text` generated column.
Not verified against real Neon.

## Naming convention

`NNN_name.sql`, zero-padded to 3 digits, in the order the migration actually
ran against Neon. **The number is the whole point — it's the one thing a
filename couldn't previously tell you.** When adding a new migration, give it
the next unused number; don't reuse or renumber an existing one, even if a
later file turns out to depend on an earlier one you'd naturally group it
near — sequence reflects *when it ran*, not topical grouping.

## Reconstructing the order (why some of this is marked "best-effort")

Before this pass, these 18 files had no prefix at all, and nothing in the
repo recorded the order they were actually applied in. Two things made this
mostly, but not perfectly, reconstructable:

- **Git commit dates**, for anything committed after 2026-08-19: reliable,
  since each of those files has its own real commit.
- **Each file's own header comment**, which frequently says "same
  convention as sql/OTHER_FILE.sql" — citing the file(s) its author had
  most recently written when they wrote this one. Not a complete list of
  every prior migration (a file several citations deep doesn't re-cite
  everything before it, just the 1-2 nearest precedents), but a reliable
  *relative* signal: if A cites B, A came after B.

Fourteen of the eighteen files share one identical first-commit timestamp
(2026-08-19 08:21:57, a repo-import squash) — git gives zero ordering
signal within that group, so their relative order below is reconstructed
entirely from citation chains and thematic/ticket grouping. Confidence
per file:

| # | File | Confidence | Basis |
|---|---|---|---|
| 001 | `items_schema.sql` | **Confirmed** | `migrate_to_postgres.py` explicitly says run this first |
| 002 | `analytics_events.sql` | Best-effort | No citation or ticket reference at all; placed early as a small, independent table |
| 003 | `items_harmonization.sql` | High | Root of the harmonization chain — cited by 5 other files, cites nothing itself |
| 004 | `items_rejected_state.sql` | High | Cites `items_harmonization.sql` only |
| 005 | `items_search.sql` | High | Cites `items_harmonization.sql` + `items_rejected_state.sql` |
| 006 | `items_region_alt.sql` | High | Cites `items_search.sql` + `items_harmonization.sql` |
| 007 | `items_series.sql` | High | Cites `items_region_alt.sql` + `items_harmonization.sql` |
| 008 | `items_place_of_origin.sql` | Medium | Cites `items_harmonization.sql` only; placed last in this sub-chain because `items_department.sql` (the next *dated* commit) cites it as its sole precedent |
| 009 | `blob_usage_tracker_schema.sql` | Medium | No citation itself, but cited by `img_fetch_state.sql` as a precedent — placed immediately before it |
| 010 | `img_fetch_state.sql` | High | Cites `blob_usage_tracker_schema.sql` + `items_series.sql` — the one citation that bridges the two sub-chains |
| 011 | `img_cache_entries.sql` | Medium | Same underlying work as 010 (a later phase of it), no explicit citation |
| 012 | `host_fetch_state.sql` | Medium | Cites `img_fetch_state.sql` only; ordered before 013 by which was filed first in the tracker, as a tiebreak, not a citation |
| 013 | `img_shed_stats.sql` | Medium | Cites `img_fetch_state.sql` only |
| 014 | `items_department.sql` | **Confirmed** | Real commit, 2026-08-19 17:35 |
| 015 | `items_contributor_nationality.sql` | **Confirmed** | Real commit, 2026-08-20 |
| 016 | `blob_ops_stats.sql` | **Confirmed** | Real commit, 2026-08-21 |
| 017 | `items_shuffle_key.sql` | **Confirmed** | Real commit, 2026-08-22; cites `items_search.sql` + `items_region_alt.sql` |
| 018 | `items_vocab.sql` | **Confirmed** | Same commit as 017; cites `items_search.sql` + `items_shuffle_key.sql`, so strictly after it |
| 019 | `storylines.sql` | **Confirmed** | Real commit, first appearance of the storylines tables |
| 020 | `storylines_seed.sql` | **Confirmed** | Same migration; generated once from `src/data/storylines.ts`, verified byte-for-byte against it via PGlite |
| 021 | `shelves.sql` | **Confirmed** | Real commit |
| 022 | `shelves_seed.sql` | **Confirmed** | Same commit as 021 |
| 023 | `music_buckets.sql` | **Confirmed** | Same commit as 021/022 |
| 024 | `music_buckets_seed.sql` | **Confirmed** | Same commit; generated once from `src/data/music.ts` |
| 025 | `img_cache_native_id.sql` | **Confirmed** | Adds `native_id` to `img_cache_entries`, backfilled from `source`/`tier`/`cache_key` |
| 026 | `img_object_keys.sql` | **Confirmed** | Adds `object_key`/`content_hash`/`object_written_at` to `img_cache_entries` for the S3 migration |
| 027 | `hero_items.sql` | **Confirmed** | Curated hero-rotation pool, `(source, native_id)` keyed, joined against `items` |
| 028 | `hero_items_seed.sql` | **Confirmed** | Same table, 19 curated rows |
| 029 | `music_buckets_retire_architecture_space.sql` | **Confirmed** | Deletes the `architecture-space` row `024`'s seed no longer inserts |

"Best-effort"/"Medium" entries are a reasonable reconstruction, not a
guarantee — revisit this table directly against git history and each file's
own header comment if it ever needs to be redone. None of the uncertainty here is about whether
these migrations are *safe* (every one is `IF NOT EXISTS`/idempotent,
independent of run order in practice); it's purely about recording
history accurately.
