# Reference data

Static snapshots used for Tea Voice cluster research. Committed
rather than gitignored, because the licences permit it and because re-fetching
data we already hold is the traffic pattern Wikimedia's policy exists to
reduce.

## `wikidata-artists.json`

Artist facts from the [Wikidata Query Service](https://query.wikidata.org/),
keyed by the artist name as it appears in our `items.artist` column.

**Licence: CC0.** [Wikidata's structured data](https://www.wikidata.org/wiki/Wikidata:Licensing)
is a public-domain dedication — no attribution required, free to store and
redistribute. (Wikidata *text* namespaces are CC BY-SA; we hold none of those.)

Written by `scripts/fetch_wikidata_artists.mts`. Two things it guarantees:

- **Nothing fetched is discarded.** Results are written before the next request
  is made, so a crash mid-run keeps what Wikimedia already answered. A name
  already stored is never asked again — including one stored as
  `{"found": false}`, because a miss is an answer too.
- **Multi-valued facts are kept whole.** Wikidata returns one row per
  combination, so an artist with two nationalities arrives as several rows.
  An earlier version keyed by name and let the last row win, which stored 5
  artists from 9 rows and reduced Pissarro from Danish-French to French. Rows
  are now grouped by artist URI and the alternatives collected.

### What each record holds

| field | note |
| -- | -- |
| `wikidata` | the item URI — citable, and the source of the facts |
| `article` | English Wikipedia URL — **where the narrative material is**, and citable |
| `birth` / `death` | years only, which is what a caption uses |
| `nationality` / `movement` | arrays; an artist can legitimately have several |
| `description` | Wikidata's one-line description |
| `found` | `false` records a name Wikidata does not have, so it is not re-asked |

### Matching the right person, and admitting when we cannot

`rdfs:label` matches **any human with that English label**. The first full run
stored 19 provably wrong people out of 120 — Vincent van Gogh as someone born
1674, Wang Meng as a badminton player, Ma Lin as a screenwriter, Maurice Denis
as a politician born 1940 — and one query returned 198 "artists" for 20 names.
That data was deleted rather than patched: a wrong birth year in a caption is
invisible once written, so a store with known-bad rows cannot be trusted at all.

Two changes:

- **The query requires an art occupation** (`P106` against painter, printmaker,
  sculptor, photographer, illustrator, draughtsperson, graphic artist). This
  removes the badminton player by construction rather than by cleanup.
- **Ambiguity is recorded, never resolved.** Two real painters can share a
  name, and picking one silently is how the wrong biography reaches a caption.
  A name matching several artists is stored `ambiguous: true` with every
  candidate kept and **no facts of its own** — deliberately no birth year for a
  caption to pick up. William Blake is the live example: the poet-artist and an
  English photographer born 1874. A human resolves it; the file will not guess.

### Compliance

The fetcher sends the Wikimedia-shaped User-Agent from `lib/source-identity.js`
(client, version, contact URL, contact email, purpose), runs one query at a
time with a 2s gap, honours `Retry-After`, and opens a circuit breaker after
**3 consecutive errors** against a published budget of 30/minute. Network
failures count against that budget too — an uncaught throw would skip the
accounting entirely, which is the gap that allowed 628 consecutive failures
during the August incident.


## `ulan-artists.json`

Artist identity and name variants from the [Getty Union List of Artist Names](http://ulandownloads.getty.edu/),
snapshot **`ulan_rel_0126`** (drawn 30 Jan 2026 — the final relational release;
Getty now publishes N-Triples only).

**Licence: [ODC-BY 1.0](https://www.getty.edu/research/tools/vocabularies/lod/index.html).**
Attribution is **required**, unlike Wikidata's CC0. Any caption grounded on
ULAN carries that obligation.

> Getty Vocabulary data is made available by the J. Paul Getty Trust under the
> Open Data Commons Attribution License (ODC-By) 1.0.

The 190 MB dump lives in `raw/` and is **not committed** — see `raw/.gitignore`.
Rebuild this file with `bun scripts/extract_ulan_artists.mts`.

### Why we wanted it

ULAN knows that `Rembrandt van Rijn`, `Rembrandt (Rembrandt van Rijn)`,
`Rijn, Rembrandt van` and `Rembrandt` are **one person**. Our catalogue holds
all four, which splits a Tea Voice cluster, splits the artist facet in search,
and defeats the feed's own de-clustering — under four spellings it cannot tell
they are the same hand.

Scanning 1,218,778 ULAN terms against our 2,642 attributed artist names:

| | |
| -- | -- |
| matched to exactly one ULAN subject | **1,783** |
| ambiguous — the same term names two people | 178 |
| not in ULAN | 681 |
| **groups of our names that are one artist** | **73** |

73 against the six a human found by eye.

### Matching is deliberately conservative

Case, accents, punctuation and a trailing parenthetical are treated as noise.
**Word order is not.** A matcher written earlier the same day sorted tokens and
"merged" *Dai Jin*, *Ma Lin* and *Lü Ji* into one artist — three different
painters. Fusing two artists is worse than failing to merge them, because the
result looks like a successful merge.

For the same reason a term matching **two** ULAN subjects (there is more than
one Rembrandt) is recorded `ambiguous` with every candidate and **no**
`ulan_id`, so a later merge step has nothing to act on by accident.
