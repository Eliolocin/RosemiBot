-- Rollback 110: drop Natural Nudges.
--
-- Agendas and fire rows are runtime state; dropping them only forgets past nudges.

DROP TABLE IF EXISTS natural_nudge_agendas;
DROP TABLE IF EXISTS natural_nudge_fires;
DROP TABLE IF EXISTS server_natural_nudge_runtime_state;
DROP TABLE IF EXISTS persona_natural_nudge_configs;
DROP TABLE IF EXISTS server_natural_nudge_custom_idle_nudges;
DROP TABLE IF EXISTS server_natural_nudge_configs;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS natural_nudge_talkativeness;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS natural_nudge_interests;
