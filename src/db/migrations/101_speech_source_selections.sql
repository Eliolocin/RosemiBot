SELECT add_column_if_not_exists('server_speech_configs', 'speech_design_endpoint_id', 'INT REFERENCES custom_endpoints(custom_endpoint_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('server_speech_configs', 'speech_clone_endpoint_id', 'INT REFERENCES custom_endpoints(custom_endpoint_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('persona_voice_configs', 'voice_source_priority', 'TEXT NOT NULL CHECK (voice_source_priority IN (''design'', ''clone''))', '''design''');

WITH legacy AS (
  SELECT DISTINCT ON (cec.server_id) cec.server_id, ce.custom_endpoint_id, cec.api_style,
    COALESCE(ce.extra_config->>'voice_mode', 'clone') AS mode
  FROM custom_endpoints ce
  JOIN custom_endpoint_connections cec USING (connection_id)
  WHERE cec.capability = 'speech' AND cec.server_id IS NOT NULL
    AND cec.user_id IS NULL AND ce.is_default = true
  ORDER BY cec.server_id, ce.updated_at DESC, ce.custom_endpoint_id DESC
)
INSERT INTO server_speech_configs (server_id, speech_design_endpoint_id, speech_clone_endpoint_id)
SELECT server_id,
  CASE WHEN api_style = 'tts-clone' AND mode IN ('voice-design', 'auto') THEN custom_endpoint_id END,
  CASE WHEN api_style = 'elevenlabs' OR (api_style = 'tts-clone' AND mode <> 'voice-design') THEN custom_endpoint_id END
FROM legacy
ON CONFLICT (server_id) DO UPDATE SET
  speech_design_endpoint_id = EXCLUDED.speech_design_endpoint_id,
  speech_clone_endpoint_id = EXCLUDED.speech_clone_endpoint_id;

UPDATE persona_voice_configs pvc
SET voice_source_priority = 'clone'
FROM personas p
JOIN server_speech_configs ssc ON ssc.server_id = p.server_id
JOIN custom_endpoints ce ON ce.custom_endpoint_id = ssc.speech_clone_endpoint_id
WHERE pvc.persona_id = p.persona_id AND pvc.speech_voice_sample_id IS NOT NULL
  AND pvc.speech_voice_name IS DISTINCT FROM 'VoiceDesign'
  AND ce.extra_config->>'voice_mode' = 'auto' AND ce.is_default = true;

UPDATE custom_endpoints ce SET is_default = false
FROM custom_endpoint_connections cec
WHERE ce.connection_id = cec.connection_id AND cec.capability = 'speech'
  AND cec.server_id IS NOT NULL AND cec.user_id IS NULL;

CREATE OR REPLACE FUNCTION validate_speech_endpoint_selections() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.speech_design_endpoint_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.speech_design_endpoint_id IS DISTINCT FROM OLD.speech_design_endpoint_id) AND NOT EXISTS (
    SELECT 1 FROM custom_endpoints ce JOIN custom_endpoint_connections cec USING (connection_id)
    WHERE ce.custom_endpoint_id = NEW.speech_design_endpoint_id AND cec.server_id = NEW.server_id
      AND cec.user_id IS NULL AND cec.capability = 'speech' AND cec.api_style = 'tts-clone'
      AND ce.extra_config->>'voice_mode' IN ('voice-design', 'auto')
  ) THEN RAISE EXCEPTION 'Invalid server Voice Design selection'; END IF;
  IF NEW.speech_clone_endpoint_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.speech_clone_endpoint_id IS DISTINCT FROM OLD.speech_clone_endpoint_id) AND NOT EXISTS (
    SELECT 1 FROM custom_endpoints ce JOIN custom_endpoint_connections cec USING (connection_id)
    WHERE ce.custom_endpoint_id = NEW.speech_clone_endpoint_id AND cec.server_id = NEW.server_id
      AND cec.user_id IS NULL AND cec.capability = 'speech'
      AND (cec.api_style = 'elevenlabs' OR (cec.api_style = 'tts-clone'
        AND COALESCE(ce.extra_config->>'voice_mode', 'clone') NOT IN ('voice-design')))
  ) THEN RAISE EXCEPTION 'Invalid server Voice Clone selection'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_speech_endpoint_selections ON server_speech_configs;
CREATE TRIGGER validate_speech_endpoint_selections
  BEFORE INSERT OR UPDATE OF speech_design_endpoint_id, speech_clone_endpoint_id ON server_speech_configs
  FOR EACH ROW EXECUTE FUNCTION validate_speech_endpoint_selections();

CREATE OR REPLACE FUNCTION clear_unsupported_speech_selections() RETURNS TRIGGER AS $$
BEGIN
  UPDATE server_speech_configs ssc SET
    speech_design_endpoint_id = CASE WHEN EXISTS (
      SELECT 1 FROM custom_endpoints ce JOIN custom_endpoint_connections cec USING (connection_id)
      WHERE ce.custom_endpoint_id = ssc.speech_design_endpoint_id AND cec.server_id = ssc.server_id
        AND cec.user_id IS NULL AND cec.capability = 'speech' AND cec.api_style = 'tts-clone'
        AND ce.extra_config->>'voice_mode' IN ('voice-design', 'auto')
    ) THEN speech_design_endpoint_id END,
    speech_clone_endpoint_id = CASE WHEN EXISTS (
      SELECT 1 FROM custom_endpoints ce JOIN custom_endpoint_connections cec USING (connection_id)
      WHERE ce.custom_endpoint_id = ssc.speech_clone_endpoint_id AND cec.server_id = ssc.server_id
        AND cec.user_id IS NULL AND cec.capability = 'speech'
        AND (cec.api_style = 'elevenlabs' OR (cec.api_style = 'tts-clone'
          AND COALESCE(ce.extra_config->>'voice_mode', 'clone') <> 'voice-design'))
    ) THEN speech_clone_endpoint_id END
  WHERE speech_design_endpoint_id IN (
    SELECT custom_endpoint_id FROM custom_endpoints WHERE connection_id = NEW.connection_id
  ) OR speech_clone_endpoint_id IN (
    SELECT custom_endpoint_id FROM custom_endpoints WHERE connection_id = NEW.connection_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_unsupported_speech_selections ON custom_endpoints;
CREATE TRIGGER clear_unsupported_speech_selections AFTER UPDATE OF extra_config, connection_id ON custom_endpoints
  FOR EACH ROW EXECUTE FUNCTION clear_unsupported_speech_selections();
DROP TRIGGER IF EXISTS clear_unsupported_speech_selections ON custom_endpoint_connections;
CREATE TRIGGER clear_unsupported_speech_selections AFTER UPDATE OF api_style, capability, server_id, user_id ON custom_endpoint_connections
  FOR EACH ROW EXECUTE FUNCTION clear_unsupported_speech_selections();
