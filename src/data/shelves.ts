// Tranquilo mood shelves: a homepage/discovery layer, separate from
// `category` and the taxonomy facets -- not every item needs to appear
// in a shelf, and an item can appear in several.
//
// Retired from the load path -- shelves now live in Postgres
// (sql/021_shelves.sql/022_shelves_seed.sql); app.js fetches them at
// feed-init time. This file stays as a frozen reference for where each
// id/filter came from and as tests/data-schema.test.ts's fixture. Edit
// the seed SQL to actually change what Discover shows.
//
// Two shelf types: "hero" is a fixed, hand-curated `itemIds` list, the
// "someone actually thought about this" moments an algorithmic homepage
// can't produce; "rule" is a generic `filter` object matched against
// `item[key] === value`, gated by `minItems` so shelf count grows
// naturally with the catalogue.
//
// Nothing in the shelf mechanism needs to know about specific facet
// names in advance -- it's a generic object-match filter, so future
// vibe-tag filters compose identically once that data exists.
import type { Shelf } from "../types/Shelf";

export const SHELVES: Shelf[] = [
  {
    id: "storylines",
    title: "Storylines",
    type: "hero",
    // Placed first deliberately, for real editorial prominence rather
    // than leaving Storyline content discoverable only via the in-feed
    // chip.
    //
    // Computed from every current storyline, unlike other hero shelves
    // (hand-curated snapshots), so it stays in sync as storylines are added.
    //
    // Starts empty and is populated by app.js once the storyline index
    // arrives, always before a reader can reach Discover.
    //
    // Tapping a card lands on the cover item's detail view, not directly
    // into Storyline mode -- entering the storyline is one more tap on
    // the Storyline chip there, since that chip only renders in the main
    // feed's own card.
    itemIds: [],
  },
  {
    id: "painted-by-themselves",
    title: "Main Character Energy",
    type: "hero",
    itemIds: [436258, 437508, 436840, 437397, 483438, 15026, 334004],
  },
  {
    id: "pets-in-art",
    title: "Furry Friends",
    type: "hero",
    // Admits companion pets with their humans, or animals reading as
    // somebody's pet -- an animal rendered as a decorative/still-life
    // object (Chardin's "The Silver Tureen", Fabergé's "Bulldog") is not
    // in scope, a different pattern from this shelf's actual subject.
    //
    // The id stays "pets-in-art", distinct from the display title, since
    // renaming it would change the shelf's identity key for no gain.
    itemIds: [
      437173, 435864, 99443, 127235, 437890, 782306, 265794, 261350, 261353,
      438617,
    ],
  },
  {
    id: "merry-company",
    title: "Merry Company",
    type: "hero",
    itemIds: [435807, 436622, 436884, 435868],
  },
  {
    id: "creature-curiosities",
    title: "Creature Curiosities",
    type: "hero",
    // An animal rendered as a precious or ritual object rather than a
    // companion portrait -- the distinction that keeps Chardin's rabbit
    // and Fabergé's "Bulldog" out of Furry Friends. Spans Ghana, China,
    // Greece, Central America and Russia, 500 BCE to 1915.
    itemIds: [
      548504,
      310764,
      323944,
      323943,
      544864,
      142744, // House of Fabergé, "Bulldog"
      142745, // House of Fabergé, "Sleeping Puppies on a Mat" -- agate, chalcedony
      115159, // Gold Weight (abrammuo): Antelope -- Akan, 1800s, Cleveland
      43248, // Two rabbits -- jade, 14th-15th c., Met
      109106, // Lion's Head -- terracotta, 500-400 BCE, Cleveland
      155432, // Crocodile Pendant -- cast gold, 1000-1550, Cleveland
      44719, // Finial in the Shape of a Tiger -- bronze, 6th-5th c. BCE, Met
      42179, // Reclining tiger -- bronze, 4th-3rd c. BCE, Met
    ],
  },
  {
    id: "old-world-portraiture",
    title: "Old World Portraiture",
    type: "rule",
    filter: {
      category: "Paintings & Portraits",
      region_primary: "Europe",
      subject_type: "portrait",
    },
    minItems: 10,
  },
  {
    id: "birdwatching",
    title: "Birdwatching",
    type: "hero",
    // Hand-curated, not a rule shelf: no clean structured field to filter
    // birds on (a raw keyword sweep pulls in false positives like
    // heraldic eagles). Cut down to ids where a bird is genuinely the
    // subject in an observational register. The last 3 ids are Wikimedia
    // Commons filename strings rather than numeric ids -- needed no code
    // change, since item.id is always a string at runtime.
    itemIds: [
      140408, // Peregrine Falcons (Duck Hawks) -- John James Audubon, c. 1827, Cleveland
      451725, // "The Concourse of the Birds," Mantiq al-Tayr folio -- Habiballah of Sava, c. 1600, Met
      132616, // Still Life with Birds and Fruit -- Giovanna Garzoni, c. 1650, Cleveland
      142738, // Parrot on a Perch -- House of Fabergé, 1896-1903, Cleveland
      117940, // Cranes and Serpents -- China, 475-221 BCE, Cleveland
      147576, // Mirror with Phoenixes, Birds, Butterflies -- Tang Dynasty, 700s, Cleveland
      "File:A Colorful Spring.jpg", // Golden Pheasants in Spring -- Giuseppe Castiglione, 18th c., Wikimedia Commons/Taiwan NPM
      "File:Chen Lin, Water Fowl.jpg", // Water Fowl -- Chen Lin, 1301, Commons/NPM
      "File:Bian Jingzhao-Four Magpies.jpg", // Four Magpies -- Bian Jingzhao, Ming Dynasty, Commons/NPM
    ],
  },
];
