// Server-side access to ambient-music buckets (in Postgres, see
// sql/023_music_buckets.sql/sql/024_music_buckets_seed.sql).
//
// getMusicBuckets() takes an already-open `sql` client, same reasoning as
// lib/storylines.ts/lib/shelves.ts.
//
// Returns buckets keyed by `key`, not an array, matching how
// TranquiloMusicToggle.ts always looks one up. No separate category->bucket
// map in the response either: each bucket carries its own `category`, and a
// hand-written duplicate of that 1:1 relationship used to drift -- the
// caller derives it with one reduce instead.
async function getMusicBuckets(sql: any): Promise<Record<string, any>> {
  const rows = await sql("SELECT * FROM music_buckets");
  const buckets: Record<string, any> = {};
  rows.forEach((row: any) => {
    buckets[row.key] = {
      label: row.label,
      category: row.category,
      track: row.track,
      credit: row.credit,
      creditUrl: row.credit_url,
      license: row.license,
    };
  });
  return buckets;
}

export { getMusicBuckets };
