// Server-side access to "Set of works" (in Postgres, see
// sql/033_items_set_of_work_id.sql / sql/034_set_of_works.sql) -- the
// badge for same-title/same-artist items confirmed to be genuinely distinct
// real objects, not duplicates. Same eager/lazy split as lib/storylines.ts:
// getSetOfWorksIndex() is the always-on badge chip, getSetOfWork() the
// full-detail fetch on open. The chip is clickable but has no
// slug/share-page scheme, unlike storylines.
//
// IMPORTANT: each member's `items[].id` must be the bare native_id
// ("97797"), not the Postgres composite key ("cleveland:97797") -- this
// module just passes the JSONB through and doesn't enforce it.

// JSONB columns come back already parsed under this project's driver
// family, handled defensively anyway so a wrong assumption fails soft.
function parseItemsField(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return [];
    }
  }
  return [];
}

function rowToSetOfWork(row: any): any {
  return {
    id: row.id,
    title: row.title,
    items: parseItemsField(row.items),
  };
}

// Full detail, fetched once per id on open (mirrors
// lib/storylines.ts's getStoryline()).
async function getSetOfWork(sql: any, id?: string | null): Promise<any> {
  if (!id) return null;
  const rows = await sql("SELECT * FROM set_of_works WHERE id = $1", [id]);
  return rows[0] ? rowToSetOfWork(rows[0]) : null;
}

// The EAGER half: just enough for src/feed/slideBuilder.ts's badge chip and
// its position label -- id + items[].id, not each member's
// distinguishing_trait, which the chip never renders.
async function getSetOfWorksIndex(sql: any): Promise<any[]> {
  const rows = await sql("SELECT id, items FROM set_of_works");
  return rows.map((row: any) => ({
    id: row.id,
    items: parseItemsField(row.items).map((member: any) => ({ id: member.id })),
  }));
}

export { getSetOfWork, getSetOfWorksIndex };
