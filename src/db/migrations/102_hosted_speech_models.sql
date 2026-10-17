CREATE TABLE IF NOT EXISTS speech_models (
  speech_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'openrouter', 'vertex')),
  codename TEXT NOT NULL,
  voice_mode TEXT NOT NULL CHECK (voice_mode IN ('design', 'clone', 'auto')),
  descriptions JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_deprecated BOOLEAN NOT NULL DEFAULT false,
  is_scoped_registration BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, codename),
  CHECK ((provider = 'openrouter' AND voice_mode = 'clone') OR (provider IN ('google', 'vertex') AND voice_mode = 'design'))
);

SELECT add_column_if_not_exists('scoped_model_registrations', 'speech_model_id', 'INT REFERENCES speech_models(speech_model_id) ON DELETE CASCADE');
DO $$
DECLARE old_check RECORD;
BEGIN
  FOR old_check IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'scoped_model_registrations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%num_nonnulls%'
  LOOP
    EXECUTE format('ALTER TABLE scoped_model_registrations DROP CONSTRAINT %I', old_check.conname);
  END LOOP;
  ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_one_model
    CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id, decision_model_id, speech_model_id) = 1);
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_server_speech
  ON scoped_model_registrations(server_id, speech_model_id) WHERE user_id IS NULL AND speech_model_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_user_speech
  ON scoped_model_registrations(user_id, speech_model_id) WHERE server_id IS NULL AND speech_model_id IS NOT NULL;

SELECT add_column_if_not_exists('server_speech_configs', 'speech_design_model_id', 'INT REFERENCES speech_models(speech_model_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('server_speech_configs', 'speech_clone_model_id', 'INT REFERENCES speech_models(speech_model_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'speech_design_model_id', 'INT REFERENCES speech_models(speech_model_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'speech_clone_model_id', 'INT REFERENCES speech_models(speech_model_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('saved_provider_configs', 'credential_revision', 'INT NOT NULL', '1');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'credential_revision', 'INT NOT NULL', '1');

CREATE OR REPLACE FUNCTION validate_hosted_speech_selections() RETURNS TRIGGER AS $$
DECLARE selected RECORD;
BEGIN
  IF TG_TABLE_NAME = 'server_speech_configs' THEN
    IF num_nonnulls(NEW.speech_design_model_id, NEW.speech_design_endpoint_id) > 1
      OR num_nonnulls(NEW.speech_clone_model_id, NEW.speech_clone_endpoint_id) > 1
    THEN RAISE EXCEPTION 'Speech mode must select one target'; END IF;
    FOR selected IN SELECT * FROM (VALUES (NEW.speech_design_model_id, 'design'), (NEW.speech_clone_model_id, 'clone')) AS slots(id, mode)
    LOOP
      IF selected.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM speech_models m JOIN saved_provider_configs c ON c.provider = m.provider
        WHERE m.speech_model_id = selected.id AND c.server_id = NEW.server_id AND c.api_key IS NOT NULL
          AND m.voice_mode IN (selected.mode, 'auto') AND NOT m.is_deprecated
          AND (NOT m.is_scoped_registration OR EXISTS (
            SELECT 1 FROM scoped_model_registrations r WHERE r.speech_model_id = m.speech_model_id
              AND r.server_id = NEW.server_id AND r.user_id IS NULL))
      ) THEN RAISE EXCEPTION 'Invalid server hosted speech selection'; END IF;
    END LOOP;
  ELSE
    FOR selected IN SELECT * FROM (VALUES (NEW.speech_design_model_id, 'design'), (NEW.speech_clone_model_id, 'clone')) AS slots(id, mode)
    LOOP
      IF selected.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM speech_models m WHERE m.speech_model_id = selected.id AND m.provider = NEW.provider
          AND NEW.api_key IS NOT NULL AND m.voice_mode IN (selected.mode, 'auto') AND NOT m.is_deprecated
          AND (NOT m.is_scoped_registration OR EXISTS (
            SELECT 1 FROM scoped_model_registrations r WHERE r.speech_model_id = m.speech_model_id
              AND r.user_id = NEW.user_id AND r.server_id IS NULL))
      ) THEN RAISE EXCEPTION 'Invalid personal hosted speech selection'; END IF;
    END LOOP;
    IF (NEW.enabled_capabilities @> ARRAY['speech_design'] AND NOT NEW.assigned_capabilities @> ARRAY['speech_design'])
      OR (NEW.enabled_capabilities @> ARRAY['speech_clone'] AND NOT NEW.assigned_capabilities @> ARRAY['speech_clone'])
    THEN RAISE EXCEPTION 'Enabled personal speech capabilities require ownership'; END IF;
    PERFORM 1 FROM users WHERE user_id = NEW.user_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM user_saved_provider_configs c WHERE c.user_id = NEW.user_id AND c.provider <> NEW.provider
        AND ((NEW.assigned_capabilities @> ARRAY['speech_design'] AND c.assigned_capabilities @> ARRAY['speech_design'])
          OR (NEW.assigned_capabilities @> ARRAY['speech_clone'] AND c.assigned_capabilities @> ARRAY['speech_clone']))
    ) THEN RAISE EXCEPTION 'Personal speech capability already assigned'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_hosted_speech_selections ON server_speech_configs;
CREATE TRIGGER validate_hosted_speech_selections BEFORE INSERT OR UPDATE OF speech_design_model_id, speech_clone_model_id, speech_design_endpoint_id, speech_clone_endpoint_id
  ON server_speech_configs FOR EACH ROW EXECUTE FUNCTION validate_hosted_speech_selections();
DROP TRIGGER IF EXISTS validate_hosted_speech_selections ON user_saved_provider_configs;
CREATE TRIGGER validate_hosted_speech_selections BEFORE INSERT OR UPDATE OF speech_design_model_id, speech_clone_model_id, provider, api_key, assigned_capabilities, enabled_capabilities
  ON user_saved_provider_configs FOR EACH ROW EXECUTE FUNCTION validate_hosted_speech_selections();

CREATE TABLE IF NOT EXISTS speech_voice_bindings (
  speech_voice_binding_id SERIAL PRIMARY KEY,
  persona_id INT REFERENCES personas(persona_id) ON DELETE SET NULL,
  saved_config_id INT REFERENCES saved_provider_configs(saved_config_id) ON DELETE CASCADE,
  user_saved_config_id INT REFERENCES user_saved_provider_configs(user_saved_config_id) ON DELETE CASCADE,
  credential_revision INT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('google', 'vertex')),
  project TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  prompt_hash TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  pending_delete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (num_nonnulls(saved_config_id, user_saved_config_id) = 1),
  CHECK (transport <> 'vertex' OR (project <> '' AND location <> ''))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_speech_voice_bindings_identity
  ON speech_voice_bindings(persona_id, COALESCE(saved_config_id, 0), COALESCE(user_saved_config_id, 0), credential_revision, transport, project, location, prompt_hash)
  WHERE NOT pending_delete AND persona_id IS NOT NULL;

CREATE OR REPLACE FUNCTION revise_speech_credentials() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.api_key IS DISTINCT FROM OLD.api_key THEN
    NEW.credential_revision = OLD.credential_revision + 1;
    IF TG_TABLE_NAME = 'saved_provider_configs' THEN
      UPDATE speech_voice_bindings SET pending_delete = true WHERE saved_config_id = OLD.saved_config_id;
      IF NEW.api_key IS NULL THEN
        UPDATE server_speech_configs SET
          speech_design_model_id = CASE WHEN speech_design_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_design_model_id END,
          speech_clone_model_id = CASE WHEN speech_clone_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_clone_model_id END
        WHERE server_id = OLD.server_id;
      END IF;
    ELSE
      UPDATE speech_voice_bindings SET pending_delete = true WHERE user_saved_config_id = OLD.user_saved_config_id;
      IF NEW.api_key IS NULL THEN
        NEW.speech_design_model_id = NULL;
        NEW.speech_clone_model_id = NULL;
        NEW.enabled_capabilities = array_remove(array_remove(NEW.enabled_capabilities, 'speech_design'), 'speech_clone');
        NEW.assigned_capabilities = array_remove(array_remove(NEW.assigned_capabilities, 'speech_design'), 'speech_clone');
      END IF;
    END IF;
  ELSE
    NEW.credential_revision = OLD.credential_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS revise_speech_credentials ON saved_provider_configs;
CREATE TRIGGER revise_speech_credentials BEFORE UPDATE ON saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION revise_speech_credentials();
DROP TRIGGER IF EXISTS revise_speech_credentials ON user_saved_provider_configs;
CREATE TRIGGER revise_speech_credentials BEFORE UPDATE ON user_saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION revise_speech_credentials();

CREATE OR REPLACE FUNCTION retire_persona_speech_bindings() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.speech_voice_design_prompt IS DISTINCT FROM OLD.speech_voice_design_prompt THEN
    UPDATE speech_voice_bindings SET pending_delete = true WHERE persona_id = OLD.persona_id
      AND EXISTS (SELECT 1 FROM personas WHERE persona_id = OLD.persona_id);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS retire_persona_speech_bindings ON persona_voice_configs;
CREATE TRIGGER retire_persona_speech_bindings AFTER UPDATE OF speech_voice_design_prompt OR DELETE ON persona_voice_configs
  FOR EACH ROW EXECUTE FUNCTION retire_persona_speech_bindings();

CREATE OR REPLACE FUNCTION clear_hosted_speech_registration() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.speech_model_id IS NOT NULL THEN
    UPDATE server_speech_configs SET
      speech_design_model_id = CASE WHEN speech_design_model_id = OLD.speech_model_id THEN NULL ELSE speech_design_model_id END,
      speech_clone_model_id = CASE WHEN speech_clone_model_id = OLD.speech_model_id THEN NULL ELSE speech_clone_model_id END
    WHERE server_id = OLD.server_id AND EXISTS (SELECT 1 FROM servers WHERE server_id = OLD.server_id);
    UPDATE user_saved_provider_configs SET
      assigned_capabilities = array_remove(array_remove(assigned_capabilities,
        CASE WHEN speech_design_model_id = OLD.speech_model_id THEN 'speech_design' END),
        CASE WHEN speech_clone_model_id = OLD.speech_model_id THEN 'speech_clone' END),
      enabled_capabilities = array_remove(array_remove(enabled_capabilities,
        CASE WHEN speech_design_model_id = OLD.speech_model_id THEN 'speech_design' END),
        CASE WHEN speech_clone_model_id = OLD.speech_model_id THEN 'speech_clone' END),
      speech_design_model_id = CASE WHEN speech_design_model_id = OLD.speech_model_id THEN NULL ELSE speech_design_model_id END,
      speech_clone_model_id = CASE WHEN speech_clone_model_id = OLD.speech_model_id THEN NULL ELSE speech_clone_model_id END
    WHERE user_id = OLD.user_id AND EXISTS (SELECT 1 FROM users WHERE user_id = OLD.user_id);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_hosted_speech_registration ON scoped_model_registrations;
CREATE TRIGGER clear_hosted_speech_registration AFTER DELETE ON scoped_model_registrations
  FOR EACH ROW EXECUTE FUNCTION clear_hosted_speech_registration();

CREATE OR REPLACE FUNCTION validate_speech_voice_binding() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.persona_id IS NULL THEN NEW.pending_delete = true; END IF;
  IF NOT NEW.pending_delete AND NOT (
    EXISTS (
      SELECT 1 FROM saved_provider_configs c
      WHERE c.saved_config_id = NEW.saved_config_id AND c.provider = NEW.transport
        AND c.credential_revision = NEW.credential_revision AND c.api_key IS NOT NULL
        AND (NEW.persona_id IS NULL OR EXISTS (
          SELECT 1 FROM personas p WHERE p.persona_id = NEW.persona_id AND p.server_id = c.server_id))
    ) OR EXISTS (
      SELECT 1 FROM user_saved_provider_configs c
      WHERE c.user_saved_config_id = NEW.user_saved_config_id AND c.provider = NEW.transport
        AND c.credential_revision = NEW.credential_revision AND c.api_key IS NOT NULL
    )
  ) THEN RAISE EXCEPTION 'Invalid speech voice credential owner or revision'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_speech_voice_binding ON speech_voice_bindings;
CREATE TRIGGER validate_speech_voice_binding BEFORE INSERT OR UPDATE ON speech_voice_bindings
  FOR EACH ROW EXECUTE FUNCTION validate_speech_voice_binding();

CREATE OR REPLACE FUNCTION clear_removed_speech_credentials() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM servers WHERE server_id = OLD.server_id) THEN RETURN OLD; END IF;
  UPDATE server_speech_configs SET
    speech_design_model_id = CASE WHEN speech_design_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_design_model_id END,
    speech_clone_model_id = CASE WHEN speech_clone_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_clone_model_id END
  WHERE server_id = OLD.server_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_removed_speech_credentials ON saved_provider_configs;
CREATE TRIGGER clear_removed_speech_credentials BEFORE DELETE ON saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION clear_removed_speech_credentials();

CREATE OR REPLACE FUNCTION clear_changed_speech_model() RETURNS TRIGGER AS $$
BEGIN
  UPDATE server_speech_configs SET
    speech_design_model_id = CASE WHEN speech_design_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('design', 'auto') OR NEW.provider <> OLD.provider) THEN NULL ELSE speech_design_model_id END,
    speech_clone_model_id = CASE WHEN speech_clone_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('clone', 'auto') OR NEW.provider <> OLD.provider) THEN NULL ELSE speech_clone_model_id END
  WHERE speech_design_model_id = NEW.speech_model_id OR speech_clone_model_id = NEW.speech_model_id;
  UPDATE user_saved_provider_configs SET
    assigned_capabilities = array_remove(array_remove(assigned_capabilities,
      CASE WHEN speech_design_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('design', 'auto') OR NEW.provider <> OLD.provider) THEN 'speech_design' END),
      CASE WHEN speech_clone_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('clone', 'auto') OR NEW.provider <> OLD.provider) THEN 'speech_clone' END),
    enabled_capabilities = array_remove(array_remove(enabled_capabilities,
      CASE WHEN speech_design_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('design', 'auto') OR NEW.provider <> OLD.provider) THEN 'speech_design' END),
      CASE WHEN speech_clone_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('clone', 'auto') OR NEW.provider <> OLD.provider) THEN 'speech_clone' END),
    speech_design_model_id = CASE WHEN speech_design_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('design', 'auto') OR NEW.provider <> OLD.provider) THEN NULL ELSE speech_design_model_id END,
    speech_clone_model_id = CASE WHEN speech_clone_model_id = NEW.speech_model_id AND (NEW.is_deprecated OR NEW.voice_mode NOT IN ('clone', 'auto') OR NEW.provider <> OLD.provider) THEN NULL ELSE speech_clone_model_id END
  WHERE speech_design_model_id = NEW.speech_model_id OR speech_clone_model_id = NEW.speech_model_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_changed_speech_model ON speech_models;
CREATE TRIGGER clear_changed_speech_model AFTER UPDATE OF voice_mode, provider, is_deprecated ON speech_models
  FOR EACH ROW EXECUTE FUNCTION clear_changed_speech_model();
