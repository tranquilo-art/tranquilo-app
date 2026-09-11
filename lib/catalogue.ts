// How the tooling reads the whole catalogue now that /api/items no longer
// serves it in one response (the old endpoint was an unbounded SELECT *,
// ~390MB at the 200k target). Two shapes: fetchAllItems() pages with a
// cursor for callers needing full fields (title, medium, tags, bio);
// fetchManifest() is one ~20KB gzipped request when only identity/facets
// matter.

const DEFAULT_API = "https://tranquilo.art/api/items";

export function resolveApi(argv: string[] = process.argv): string {
  const flag = argv.indexOf("--api");
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  return process.env.FIXTURE_API || DEFAULT_API;
}

export async function fetchManifest(api: string): Promise<any> {
  const res = await fetch(`${api}?shape=manifest`);
  if (!res.ok) throw new Error(`${api}?shape=manifest responded ${res.status}`);
  return res.json();
}

// Pages with a cursor until the endpoint says there is no next page. The
// page ceiling is a guard against a cursor that stops advancing (happened
// once when a millisecond-truncated created_at defeated the native_id
// tiebreak) -- terminating loudly beats hanging.
export async function fetchAllItems(
  api: string,
  { limit = 200, maxPages = 2000 }: { limit?: number; maxPages?: number } = {},
): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | null = null;
  let pages = 0;

  while (pages < maxPages) {
    const url: string = `${api}?limit=${limit}${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    const body: any = await res.json();
    pages++;

    items.push(...body.items);
    if (!body.next_cursor) return items;
    if (body.next_cursor === cursor) {
      throw new Error(
        `cursor stopped advancing after ${pages} page(s) ` +
          `(${items.length} items) -- paging is broken, not finished`,
      );
    }
    cursor = body.next_cursor;
  }
  throw new Error(
    `hit the ${maxPages}-page ceiling; cursor is not terminating`,
  );
}
