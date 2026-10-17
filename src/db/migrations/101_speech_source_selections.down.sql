DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM server_speech_configs ssc
    LEFT JOIN custom_endpoints ce ON ce.custom_endpoint_id = COALESCE(ssc.speech_design_endpoint_id, ssc.speech_clone_endpoint_id)
    WHERE (ssc.speech_design_endpoint_id IS NOT NULL AND ssc.speech_clone_endpoint_id IS NOT NULL
      AND ssc.speech_design_endpoint_id <> ssc.speech_clone_endpoint_id)
      OR (ce.extra_config->>'voice_mode' = 'auto'
        AND (ssc.speech_design_endpoint_id IS NULL OR ssc.speech_clone_endpoint_id IS NULL))
  ) THEN RAISE EXCEPTION 'Cannot downgrade independent speech selections'; END IF;
  IF EXISTS (
    SELECT 1 FROM persona_voice_configs pvc
    JOIN personas p USING (persona_id)
    LEFT JOIN server_speech_configs ssc USING (server_id)
    LEFT JOIN custom_endpoints ce ON ce.custom_endpoint_id = ssc.speech_clone_endpoint_id
    WHERE pvc.voice_source_priority <> CASE WHEN ce.extra_config->>'voice_mode' = 'auto'
      AND pvc.speech_voice_sample_id IS NOT NULL AND pvc.speech_voice_name IS DISTINCT FROM 'VoiceDesign'
      THEN 'clone' ELSE 'design' END
  ) THEN RAISE EXCEPTION 'Cannot downgrade persona voice source priority'; END IF;
END $$;
UPDATE custom_endpoints ce SET is_default = false
FROM custom_endpoint_connections cec
WHERE ce.connection_id = cec.connection_id AND cec.capability = 'speech' AND cec.user_id IS NULL;
UPDATE custom_endpoints ce SET is_default = true
FROM server_speech_configs ssc
WHERE ce.custom_endpoint_id = COALESCE(ssc.speech_design_endpoint_id, ssc.speech_clone_endpoint_id);
DROP TRIGGER IF EXISTS clear_unsupported_speech_selections ON custom_endpoints;
DROP TRIGGER IF EXISTS clear_unsupported_speech_selections ON custom_endpoint_connections;
DROP FUNCTION IF EXISTS clear_unsupported_speech_selections();
DROP TRIGGER IF EXISTS validate_speech_endpoint_selections ON server_speech_configs;
DROP FUNCTION IF EXISTS validate_speech_endpoint_selections();
ALTER TABLE server_speech_configs DROP COLUMN IF EXISTS speech_design_endpoint_id;
ALTER TABLE server_speech_configs DROP COLUMN IF EXISTS speech_clone_endpoint_id;
ALTER TABLE persona_voice_configs DROP COLUMN IF EXISTS voice_source_priority;
