-- Hand-transcribed, once, from src/data/shelves.ts at the moment of its
-- migration -- that file is the historical record of where each id/filter
-- came from and why (per-item provenance comments included); this is the
-- live copy. Idempotent via ON CONFLICT so re-running it is always safe.
--
-- "storylines"'s item_ids is '[]'::jsonb here, same as it was in
-- src/data/shelves.ts -- it has no fixed content of its own, computed
-- instead by src/app.ts from the storylines table's own cover_item_id
-- column at feed-init time (see api/items.ts's ?shape=shelves handler and
-- src/app.ts's own comment on why).
INSERT INTO shelves (id, title, type, position, item_ids, filter, min_items) VALUES
  ('storylines', 'Storylines', 'hero', 0, '[]'::jsonb, NULL, NULL),
  ('painted-by-themselves', 'Main Character Energy', 'hero', 1,
   '[436258, 437508, 436840, 437397, 483438, 15026, 334004]'::jsonb, NULL, NULL),
  ('pets-in-art', 'Furry Friends', 'hero', 2,
   '[437173, 435864, 99443, 127235, 437890, 782306, 265794, 261350, 261353, 438617]'::jsonb,
   NULL, NULL),
  ('merry-company', 'Merry Company', 'hero', 3,
   '[435807, 436622, 436884, 435868]'::jsonb, NULL, NULL),
  ('creature-curiosities', 'Creature Curiosities', 'hero', 4,
   '[548504, 310764, 323944, 323943, 544864, 142744, 142745, 115159, 43248, 109106, 155432, 44719, 42179]'::jsonb,
   NULL, NULL),
  ('old-world-portraiture', 'Old World Portraiture', 'rule', 5,
   NULL,
   '{"category": "Paintings & Portraits", "region_primary": "Europe", "subject_type": "portrait"}'::jsonb,
   10),
  ('birdwatching', 'Birdwatching', 'hero', 6,
   '[140408, 451725, 132616, 142738, 117940, 147576, "File:A Colorful Spring.jpg", "File:Chen Lin, Water Fowl.jpg", "File:Bian Jingzhao-Four Magpies.jpg"]'::jsonb,
   NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  type = EXCLUDED.type,
  position = EXCLUDED.position,
  item_ids = EXCLUDED.item_ids,
  filter = EXCLUDED.filter,
  min_items = EXCLUDED.min_items;
