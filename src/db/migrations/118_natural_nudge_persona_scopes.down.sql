-- Rollback 118: drop Natural Nudges per-persona availability.
--
-- Every scoped idle nudge opens to all personas again, and the next forward run starts with no scopes.

DROP TABLE IF EXISTS server_natural_nudge_persona_scopes;
