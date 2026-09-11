-- Some records date the photograph, not the object it depicts. Run once
-- by hand in Neon's web SQL editor, same convention as
-- sql/014_items_department.sql. Safe to re-run.
--
-- Sweden's Army Museum (Europeana provider 91616) supplies two record
-- types under one credit: `arme_object_*` (real artifacts, correctly
-- undated) and `arme_photo_*` (imaging records, all titled "Imaging in
-- gouache depicting [trophy] taken by the Swedish army"). The photo
-- records carry a date, but it's the date the 2006 imaging project ran
-- (331 of 336 share the literal value "2006-01-01/2006-01-01"), not when
-- any trophy was made -- treating it as the object's `date` would classify
-- centuries-old military trophies as 21st century / Contemporary.
--
-- This column labels only the true fact (when the photograph was taken),
-- so `date`/`century`/`timeframe` stay unset for these rows, exactly as
-- if the object had no date. Existing rows are left NULL until a one-time
-- backfill moves the existing `arme_photo_*` rows' misfiled `date` value
-- over.

ALTER TABLE items ADD COLUMN IF NOT EXISTS photograph_date TEXT;

-- Verify (optional):
-- SELECT count(*) FILTER (WHERE photograph_date IS NOT NULL) AS with_photo_date,
--        count(*) AS total
-- FROM items WHERE source = 'europeana' AND credit = 'Army Museum';
