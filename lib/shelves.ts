// Server-side access to Discover shelves (in Postgres, see
// sql/021_shelves.sql/sql/022_shelves_seed.sql). getShelves() takes an
// already-open `sql` client, same reasoning as lib/storylines.ts.

// JSONB columns come back already parsed under this project's driver
// family, handled defensively anyway so a wrong assumption fails soft.
function parseJsonbField(value: any): any {
  if (value == null) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return value;
    }
  }
  return value;
}

function rowToShelf(row: any): any {
  const shelf: any = { id: row.id, title: row.title, type: row.type };
  if (row.type === "hero") {
    shelf.itemIds = parseJsonbField(row.item_ids) || [];
  } else {
    shelf.filter = parseJsonbField(row.filter) || {};
    shelf.minItems = row.min_items;
  }
  return shelf;
}

// Every shelf, in Discover's display order. Small and always-fetched --
// no lazy half, since a shelf definition is already as small as the thing
// it would be split into.
async function getShelves(sql: any): Promise<any[]> {
  const rows = await sql`SELECT * FROM shelves ORDER BY position ASC`;
  return rows.map(rowToShelf);
}

export { getShelves };
