-- Migration 094: NSFW flag for persona presets and the personas created from them.
--
-- `/persona default` hides NSFW presets and `/nsfw persona default` lists them, so the flag lives on
-- the preset and is seeded from the catalog. A persona copies it at creation and keeps it through
-- export and import, which is how `/persona import` knows to refuse an NSFW persona outside the
-- age-restricted `/nsfw` command. Every existing row is SFW, so the false default needs no backfill.

SELECT add_column_if_not_exists('persona_presets', 'is_nsfw', 'BOOLEAN', 'false', 'NOT NULL');
SELECT add_column_if_not_exists('personas', 'is_nsfw', 'BOOLEAN', 'false', 'NOT NULL');
