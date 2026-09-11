-- Seed for sql/027_hero_items.sql. Safe to re-run (ON CONFLICT upserts
-- position only, so re-running this after re-ordering the list below is
-- exactly how you change the rotation).
--
-- media_type drives tonal variety in pickHeroes() (src/logic/logic.ts) --
-- avoids two consecutive items of the same medium, preserving the intent
-- of the original curated ordering (sculpture, painting, photograph,
-- painting, painting). Not stored here (see sql/027_hero_items.sql's own
-- comment) -- listed alongside each row below only as a comment, read live
-- from `items.media_type` by lib/hero-items.ts's join.
INSERT INTO hero_items (source, native_id, position) VALUES
  ('met',       '191811', 1),   -- Rodin, The Thinker (Metalwork)
  ('met',       '436528', 2),   -- Van Gogh, Irises (Painting)
  ('met',       '261941', 3),   -- Le Gray, The Great Wave (Photograph)
  ('met',       '438821', 4),   -- Gauguin, Ia Orana Maria (Painting)
  ('met',       '437397', 5),   -- Rembrandt, Self-Portrait (Painting)
  ('cleveland', '110180', 6),   -- Ryder, The Race Track (Painting)
  ('cleveland', '103366', 7),   -- Stuart, Elizabeth Beltzhoover Mason (Painting)
  ('met',       '252468', 8),   -- Kritios, Harmodios head (Stone Sculpture)
  ('met',       '192770', 9),   -- Agostino, Saint Bridget (Stone Sculpture)
  ('cleveland', '325449', 10),  -- Stieglitz, The Steerage (Photograph)
  ('cleveland', '158284', 11),  -- Curtis, Judith-Mohave (Photograph)
  ('met',       '260988', 12),  -- Claudet, The Chess Players (Photograph)
  ('met',       '13875',  13),  -- Simon, Presentation quilt (Textile)
  ('cleveland', '104361', 14),  -- Altdorfer, Judith (Print/Drawing)
  ('cleveland', '108380', 15),  -- Durer, The Last Supper (Print/Drawing)
  ('met',       '24953',  16),  -- Tekelu, Yatagan (Metalwork)
  ('met',       '238971', 17),  -- Antico, Spinario (Metalwork)
  ('cleveland', '100824', 18),  -- Rodin, Pierre de Wissant (Metalwork)
  ('met',       '202535', 19)   -- Pronk, Creamer with cover (Ceramic)
ON CONFLICT (source, native_id) DO UPDATE SET position = EXCLUDED.position;
