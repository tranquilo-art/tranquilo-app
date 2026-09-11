// The Collect/bookmark localStorage store: purely client-side, no account
// or backend. Collections key on source:native_id, matching dedupe_key()
// and the Postgres primary key, since two sources can hand out the same
// bare id. A legacy bare-id entry is still readable: isCollected()/
// toggle() check both formats, and migrate() rewrites what it can
// resolve without dropping what it can't.
export interface CollectionStoreHost {
  // Batches a lookup for every unresolved entry in one call, since a
  // collection is bounded and this only runs once per load.
  resolveItemsByIds(ids: string[]): Promise<unknown>;
  // Reads the resolved catalogue for one id's source, after
  // resolveItemsByIds() above has settled.
  getItemSource(id: string): string | undefined;
}

export class CollectionStore {
  constructor(
    private storageKey: string,
    // Cannot check `entry.indexOf(":") !== -1` instead: Commons
    // native_ids are colon-bearing ("File:A Colorful Spring.jpg"), so
    // that test would treat every legacy Commons save as already
    // migrated. Checking the prefix against the known source list
    // actually distinguishes them.
    private knownSources: string[],
    private host: CollectionStoreHost,
  ) {}

  // No `|| "met"` fallback: a missing source produces a visibly broken
  // "undefined:123" key as a tripwire, since the manifest always carries source.
  keyFor(item: { source?: string; id: string | number }): string {
    return `${item.source}:${item.id}`;
  }

  isCollectionKey(entry: string): boolean {
    const at = entry.indexOf(":");
    return at !== -1 && this.knownSources.indexOf(entry.slice(0, at)) !== -1;
  }

  getAll(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey) || "[]");
      // Pre-migration ids mixed bare numbers and strings; Postgres's
      // native_id is text, so api/items.js always returns string ids --
      // without this, an old numeric entry would stop matching and look
      // uncollected.
      return raw.map(String);
    } catch (_e) {
      return [];
    }
  }

  // Reads both formats, in case a browser is on a stale bundle or
  // migrate() couldn't resolve an entry.
  isCollected(item: { source?: string; id: string | number }): boolean {
    const coll = this.getAll();
    return (
      coll.indexOf(this.keyFor(item)) !== -1 ||
      coll.indexOf(String(item.id)) !== -1
    );
  }

  count(): number {
    return this.getAll().length;
  }

  toggle(item: { source?: string; id: string | number }): boolean {
    const coll = this.getAll();
    const key = this.keyFor(item);
    let idx = coll.indexOf(key);
    // A legacy bare entry is removed by the same click, so un-collecting
    // something saved before the migration works even if never migrated.
    if (idx === -1) idx = coll.indexOf(String(item.id));
    let nowCollected: boolean;
    if (idx === -1) {
      coll.push(key);
      nowCollected = true;
    } else {
      coll.splice(idx, 1);
      nowCollected = false;
    }
    localStorage.setItem(this.storageKey, JSON.stringify(coll));
    return nowCollected;
  }

  // Rewrites bare ids to source:native_id, using the catalogue to supply
  // the source. An unresolvable entry is left exactly as it was, still
  // readable by the dual-format checks above. Asynchronous, since
  // resolving a bare id is a server question.
  migrate(): Promise<{ total: number; changed: boolean }> {
    const raw = this.getAll();
    const unresolved = raw.filter((entry) => !this.isCollectionKey(entry));
    if (!unresolved.length) {
      return Promise.resolve({ total: raw.length, changed: false });
    }
    return this.host.resolveItemsByIds(unresolved).then(() => {
      let changed = false;
      const migrated = raw.map((entry) => {
        if (this.isCollectionKey(entry)) return entry;
        const source = this.host.getItemSource(entry);
        if (source) {
          changed = true;
          return `${source}:${entry}`;
        }
        // Preserved rather than dropped: an unresolvable entry is still
        // the visitor's saved item, and isCollected() reads both formats.
        return entry;
      });
      if (changed) {
        localStorage.setItem(this.storageKey, JSON.stringify(migrated));
      }
      return { total: raw.length, changed };
    });
  }
}
