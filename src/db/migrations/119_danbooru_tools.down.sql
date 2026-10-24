-- Migration 119 rollback: Drop the Danbooru Search capability toggle.

ALTER TABLE server_capabilities_configs DROP COLUMN IF EXISTS danbooru_enabled;
