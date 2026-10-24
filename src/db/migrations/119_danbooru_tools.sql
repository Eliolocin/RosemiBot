-- Migration 119: Danbooru Search capability toggle.
--
-- The default fills existing rows with true on purpose, so servers that never touch the checkbox get
-- the feature.

ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS danbooru_enabled BOOLEAN NOT NULL DEFAULT true;
