-- Rollback 094: drop the persona NSFW flag.
--
-- WARNING: after this rollback every NSFW preset appears in `/persona default` again, and the next
-- forward migration run re-adds the column as false until the catalog seed restores the presets.
-- Personas created from an NSFW preset stay false after re-adding, because nothing re-copies it.

ALTER TABLE personas DROP COLUMN IF EXISTS is_nsfw;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS is_nsfw;
