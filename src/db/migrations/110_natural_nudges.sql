-- Migration 110: Natural Nudges, personas that speak without being triggered.
--
-- Meters are derived from the fire log instead of stored: persona, category, and episode fatigue,
-- daily caps, and the pending and unanswered rules are elapsed-time queries over
-- `natural_nudge_fires`, so no decay job writes anything. Heat and waking hours come from
-- `stat_counters`, which nudge turns never feed.

CREATE TABLE IF NOT EXISTS server_natural_nudge_configs (
  server_id                 INT      PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  episodes_enabled          BOOLEAN  NOT NULL DEFAULT true,
  channel_disc_ids          TEXT[]   NOT NULL DEFAULT '{}',
  llm_id                    INT      REFERENCES llms(llm_id) ON DELETE SET NULL,
  reach_out_weight          SMALLINT NOT NULL DEFAULT 35 CHECK (reach_out_weight BETWEEN 0 AND 100),
  revive_weight             SMALLINT NOT NULL DEFAULT 25 CHECK (revive_weight BETWEEN 0 AND 100),
  new_topic_weight          SMALLINT NOT NULL DEFAULT 25 CHECK (new_topic_weight BETWEEN 0 AND 100),
  alter_talk_weight         SMALLINT NOT NULL DEFAULT 15 CHECK (alter_talk_weight BETWEEN 0 AND 100),
  daily_episode_cap         SMALLINT NOT NULL DEFAULT 3 CHECK (daily_episode_cap BETWEEN 1 AND 10),
  episode_frequency         SMALLINT NOT NULL DEFAULT 1 CHECK (episode_frequency BETWEEN 0 AND 3),
  disabled_builtin_episodes TEXT[]   NOT NULL DEFAULT '{}',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_natural_nudge_configs_timestamp ON server_natural_nudge_configs;
CREATE TRIGGER update_server_natural_nudge_configs_timestamp
  BEFORE UPDATE ON server_natural_nudge_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS server_natural_nudge_episodes (
  episode_id        SERIAL   PRIMARY KEY,
  server_id         INT      NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  category          TEXT     NOT NULL CHECK (category IN ('reach_out', 'revive', 'new_topic', 'alter_talk')),
  title             TEXT     NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  brief             TEXT     NOT NULL CHECK (char_length(btrim(brief)) BETWEEN 1 AND 1000),
  agenda_hint       TEXT     CHECK (agenda_hint IS NULL OR char_length(agenda_hint) <= 500),
  prerequisites     TEXT[]   NOT NULL DEFAULT '{}',
  recommended_tools TEXT[]   NOT NULL DEFAULT '{}',
  enabled           BOOLEAN  NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_natural_nudge_episodes_server ON server_natural_nudge_episodes(server_id);

DROP TRIGGER IF EXISTS update_server_natural_nudge_episodes_timestamp ON server_natural_nudge_episodes;
CREATE TRIGGER update_server_natural_nudge_episodes_timestamp
  BEFORE UPDATE ON server_natural_nudge_episodes
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
  episode_jitter       REAL     NOT NULL DEFAULT 1,
  consecutive_failures SMALLINT NOT NULL DEFAULT 0,
  stopped_at           TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS natural_nudge_fires (
  fire_id                BIGSERIAL PRIMARY KEY,
  server_id              INT  NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  channel_disc_id        TEXT NOT NULL,
  persona_id             INT  NOT NULL REFERENCES personas(persona_id) ON DELETE CASCADE,
  mode                   TEXT NOT NULL CHECK (mode IN ('chime_in', 'episode')),
  category               TEXT CHECK (category IN ('reach_out', 'revive', 'new_topic', 'alter_talk')),
  episode_key            TEXT,
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
