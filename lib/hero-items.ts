// Server-side access to the hand-curated hero pool (in Postgres, see
// sql/027_hero_items.sql/sql/028_hero_items_seed.sql).
//
// getHeroPool() takes an already-open `sql` client rather than opening its
// own, same reasoning as lib/shelves.ts's getShelves().

import { LIVE_ITEMS_PREDICATE } from "./items-sql.ts";

// Joined against `items` for media_type (used by pickHeroes() to avoid two
// consecutive items of the same medium) rather than storing it in
// hero_items. Filtered by LIVE_ITEMS_PREDICATE, so a hero whose item has
// since been quarantined or rejected silently drops out of the pool.
async function getHeroPool(sql: any): Promise<any[]> {
  const rows = await sql.query(
    `SELECT h.source, h.native_id, i.media_type FROM hero_items h ` +
      `JOIN items i ON i.source = h.source AND i.native_id = h.native_id ` +
      `WHERE ${LIVE_ITEMS_PREDICATE} ORDER BY h.position ASC`,
  );
  return rows.map((row: any) => ({
    source: row.source,
    native_id: row.native_id,
    media_type: row.media_type,
  }));
}

export { getHeroPool };
