-- Migration 110: Natural Nudges, personas that speak without being triggered.
--
-- Meters are derived from the fire log instead of stored: persona, category, and idle nudge fatigue,
-- daily caps, and the pending and unanswered rules are elapsed-time queries over
-- `natural_nudge_fires`, so no decay job writes anything. Heat and waking hours come from
-- `stat_counters`, which nudge turns never feed.

CREATE TABLE IF NOT EXISTS server_natural_nudge_configs (
  server_id                 INT      PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  idle_nudges_enabled          BOOLEAN  NOT NULL DEFAULT true,
  channel_disc_ids          TEXT[]   NOT NULL DEFAULT '{}',
  llm_id                    INT      REFERENCES llms(llm_id) ON DELETE SET NULL,
  idle_nudge_frequency         SMALLINT NOT NULL DEFAULT 1 CHECK (idle_nudge_frequency BETWEEN 0 AND 3),
  disabled_builtin_idle_nudges TEXT[]   NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_natural_nudge_configs_timestamp ON server_natural_nudge_configs;
CREATE TRIGGER update_server_natural_nudge_configs_timestamp
  BEFORE UPDATE ON server_natural_nudge_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS server_natural_nudge_custom_idle_nudges (
  custom_idle_nudge_id        SERIAL   PRIMARY KEY,
  server_id         INT      NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  category          TEXT     NOT NULL CHECK (category IN ('ping_user', 'revive_topic', 'start_topic', 'play_scene')),
  title             TEXT     NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  brief             TEXT     NOT NULL CHECK (char_length(btrim(brief)) BETWEEN 1 AND 1000),
  agenda_hint       TEXT     CHECK (agenda_hint IS NULL OR char_length(agenda_hint) <= 500),
  prerequisites     TEXT[]   NOT NULL DEFAULT '{}',
  recommended_tools TEXT[]   NOT NULL DEFAULT '{}',
  enabled           BOOLEAN  NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_natural_nudge_custom_idle_nudges_server ON server_natural_nudge_custom_idle_nudges(server_id);

DROP TRIGGER IF EXISTS update_server_natural_nudge_custom_idle_nudges_timestamp ON server_natural_nudge_custom_idle_nudges;
CREATE TRIGGER update_server_natural_nudge_custom_idle_nudges_timestamp
  BEFORE UPDATE ON server_natural_nudge_custom_idle_nudges
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS persona_natural_nudge_configs (
  persona_id    INT      PRIMARY KEY REFERENCES personas(persona_id) ON DELETE CASCADE,
  talkativeness SMALLINT NOT NULL DEFAULT 2 CHECK (talkativeness BETWEEN 0 AND 4),
  interests     JSONB    NOT NULL DEFAULT '[]'::JSONB
                CHECK (jsonb_typeof(interests) = 'array' AND jsonb_array_length(interests) <= 8),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_persona_natural_nudge_configs_timestamp ON persona_natural_nudge_configs;
CREATE TRIGGER update_persona_natural_nudge_configs_timestamp
  BEFORE UPDATE ON persona_natural_nudge_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

SELECT add_column_if_not_exists('persona_presets', 'natural_nudge_interests', 'JSONB', '''[]''::JSONB', 'NOT NULL');
SELECT add_column_if_not_exists('persona_presets', 'natural_nudge_talkativeness', 'SMALLINT', '2', 'NOT NULL');

CREATE TABLE IF NOT EXISTS server_natural_nudge_runtime_state (
  server_id            INT      PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  idle_nudge_jitter       REAL     NOT NULL DEFAULT 1,
  consecutive_failures SMALLINT NOT NULL DEFAULT 0,
  stopped_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS natural_nudge_fires (
  fire_id                BIGSERIAL PRIMARY KEY,
  server_id              INT  NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  channel_disc_id        TEXT NOT NULL,
  persona_id             INT  NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
  mode                   TEXT NOT NULL CHECK (mode IN ('active', 'idle')),
  category               TEXT CHECK (category IN ('ping_user', 'revive_topic', 'start_topic', 'play_scene')),
  idle_nudge_key            TEXT,
  target_user_id         INT  REFERENCES users(user_id) ON DELETE CASCADE,
  opener_message_disc_id TEXT NOT NULL,
  answered               BOOLEAN,
  detour                 BOOLEAN NOT NULL DEFAULT false,
  fired_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_natural_nudge_fires_server_time ON natural_nudge_fires(server_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_natural_nudge_fires_target_time ON natural_nudge_fires(target_user_id, fired_at)
  WHERE target_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS natural_nudge_agendas (
  message_disc_id TEXT NOT NULL,
  persona_id      INT  NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
  agenda          TEXT NOT NULL CHECK (char_length(btrim(agenda)) BETWEEN 1 AND 500),
  target_user_id  INT  REFERENCES users(user_id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_disc_id, persona_id)
);

CREATE INDEX IF NOT EXISTS idx_natural_nudge_agendas_created ON natural_nudge_agendas(created_at);
