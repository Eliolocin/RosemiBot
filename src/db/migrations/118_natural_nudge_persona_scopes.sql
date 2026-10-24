-- Migration 118: Natural Nudges per-persona availability.
--
-- A row limits one idle nudge (built-in key or `custom:<id>`) to the listed personas; no row means every
-- persona may use it. Persona IDs are a JSONB array rather than rows with a foreign key: a cascade would
-- empty a scope whose personas were all deleted, and an empty scope reads as open to everyone.
-- `persona_id` is never reused, so the bot filters stale IDs on read and the Studio marks such a scope as
-- blocked. JSONB rather than INT[] because Bun SQL fails to decode INT[] in some code paths.

CREATE TABLE IF NOT EXISTS server_natural_nudge_persona_scopes (
  server_id      INT   NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  idle_nudge_key TEXT  NOT NULL,
  persona_ids    JSONB NOT NULL
                 CHECK (jsonb_typeof(persona_ids) = 'array' AND jsonb_array_length(persona_ids) > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, idle_nudge_key)
);

DROP TRIGGER IF EXISTS update_server_natural_nudge_persona_scopes_timestamp ON server_natural_nudge_persona_scopes;
CREATE TRIGGER update_server_natural_nudge_persona_scopes_timestamp
  BEFORE UPDATE ON server_natural_nudge_persona_scopes
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();
