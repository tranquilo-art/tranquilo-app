-- The object's own place, kept as its own fact rather than folded into
-- `bio`, which already means different things per source (artist
-- nationality/dates for Met/Cleveland/Smithsonian, a place for Europeana/
-- Commons) with nothing recording which. `place_of_origin` is where the
-- object came from, set only where a source genuinely records it, never
-- inferred from an artist's nationality -- a French designer's work made
-- in England originates in England.
--
-- Populated at ingestion by the Smithsonian adapter, from
-- indexedStructured.place/geoLocation. Cooper Hewitt is largely anonymous
-- design objects, so artist nationality
-- resolved a region for 1 record in 6 while place resolved 6 in 6; before
-- this, 68% of a pull quarantined on schema.region_unresolved and aborted
-- the run-level guard.

ALTER TABLE items ADD COLUMN IF NOT EXISTS place_of_origin TEXT;

-- ---------------------------------------------------------------------------
-- Verify (optional)
-- ---------------------------------------------------------------------------
-- SELECT source, count(*) FILTER (WHERE place_of_origin IS NOT NULL) AS with_place,
--        count(*) AS total
-- FROM items GROUP BY 1 ORDER BY 2 DESC;
