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
