-- Hand-transcribed, once, from src/data/music.ts at the moment of its
-- migration -- that file is the historical record of each track's
-- sourcing/verification notes; this is the live copy. Idempotent via
-- ON CONFLICT so re-running it is always safe.
INSERT INTO music_buckets (key, label, category, track, credit, credit_url, license) VALUES
  ('paintings', 'Paintings', 'Paintings & Portraits',
   'https://archive.org/download/OpenGoldbergVariations/Kimiko%20Ishizaka%20-%20J.S.%20Bach-%20-Open-%20Goldberg%20Variations%2C%20BWV%20988%20%28Piano%29%20-%2001%20Aria.mp3',
   'J.S. Bach, "Aria" (Goldberg Variations, BWV 988) — performed by Kimiko Ishizaka',
   'https://archive.org/details/OpenGoldbergVariations',
   'CC0 1.0 Universal'),
  ('sculpture-decorative-arts', 'Sculpture & Decorative Arts', 'Sculpture & Objects',
   NULL, NULL, NULL, NULL),
  ('prints-drawings', 'Prints & Drawings', 'Works on Paper',
   'https://archive.org/download/bach-well-tempered-clavier-book-1/Kimiko%20Ishizaka%20-%20Bach-%20Well-Tempered%20Clavier%2C%20Book%201%20-%2001%20Prelude%20No.%201%20in%20C%20major%2C%20BWV%20846.mp3',
   'J.S. Bach, "Prelude No. 1 in C major" (Well-Tempered Clavier, Book 1, BWV 846) — performed by Kimiko Ishizaka',
   'https://archive.org/details/bach-well-tempered-clavier-book-1',
   'CC0 1.0 Universal'),
  ('asian-art', 'Asian Art', NULL,
   NULL, NULL, NULL, NULL),
  ('photographs', 'Photographs', 'Photography',
   NULL, NULL, NULL, NULL),
  ('arms-armor', 'Arms & Armor', 'Arms & Armor',
   'https://archive.org/download/MusopenCollectionAsFlac/Beethoven_CoriolanOverture/LudwigVanBeethoven-CoriolanOverture.mp3',
   'Ludwig van Beethoven, "Coriolan Overture," Op. 62 — Musopen',
   'https://archive.org/details/MusopenCollectionAsFlac',
   'Public Domain Mark 1.0')
  -- 'architecture-space' no longer inserted -- see
  -- 029_music_buckets_retire_architecture_space.sql to drop it from a
  -- database that already has it.
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  track = EXCLUDED.track,
  credit = EXCLUDED.credit,
  credit_url = EXCLUDED.credit_url,
  license = EXCLUDED.license;
