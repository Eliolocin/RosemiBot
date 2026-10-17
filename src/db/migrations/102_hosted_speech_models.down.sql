DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM server_speech_configs WHERE speech_design_model_id IS NOT NULL OR speech_clone_model_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM user_saved_provider_configs WHERE speech_design_model_id IS NOT NULL OR speech_clone_model_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM speech_voice_bindings)
    OR EXISTS (SELECT 1 FROM scoped_model_registrations WHERE speech_model_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Clear hosted speech selections, registrations, and remote voice bindings before downgrade'; END IF;
END $$;
DROP TRIGGER IF EXISTS validate_hosted_speech_selections ON server_speech_configs;
DROP TRIGGER IF EXISTS validate_hosted_speech_selections ON user_saved_provider_configs;
DROP FUNCTION IF EXISTS validate_hosted_speech_selections();
DROP TRIGGER IF EXISTS revise_speech_credentials ON saved_provider_configs;
DROP TRIGGER IF EXISTS revise_speech_credentials ON user_saved_provider_configs;
DROP FUNCTION IF EXISTS revise_speech_credentials();
DROP TRIGGER IF EXISTS retire_persona_speech_bindings ON persona_voice_configs;
DROP FUNCTION IF EXISTS retire_persona_speech_bindings();
DROP TRIGGER IF EXISTS clear_hosted_speech_registration ON scoped_model_registrations;
DROP FUNCTION IF EXISTS clear_hosted_speech_registration();
DROP FUNCTION IF EXISTS validate_speech_voice_binding() CASCADE;
DROP FUNCTION IF EXISTS clear_removed_speech_credentials() CASCADE;
DROP FUNCTION IF EXISTS clear_changed_speech_model() CASCADE;
DROP TABLE speech_voice_bindings;
ALTER TABLE server_speech_configs DROP COLUMN speech_design_model_id, DROP COLUMN speech_clone_model_id;
ALTER TABLE saved_provider_configs DROP COLUMN credential_revision;
ALTER TABLE user_saved_provider_configs DROP COLUMN speech_design_model_id, DROP COLUMN speech_clone_model_id, DROP COLUMN credential_revision;
UPDATE user_saved_provider_configs SET
  enabled_capabilities = array_remove(array_remove(enabled_capabilities, 'speech_design'), 'speech_clone'),
  assigned_capabilities = array_remove(array_remove(assigned_capabilities, 'speech_design'), 'speech_clone');
ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
ALTER TABLE scoped_model_registrations DROP COLUMN speech_model_id;
ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_one_model
  CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id, decision_model_id) = 1);
DROP TABLE speech_models;
