-- Applies hosted speech defaults to owners whose credentials predate migration 102, matching what
-- adding the provider now does. Owners with any speech target, registered speech endpoint, or
-- personal speech assignment keep their configuration untouched.

WITH defaults AS (
  SELECT provider, speech_model_id, voice_mode FROM speech_models
  WHERE is_default AND NOT is_deprecated AND NOT is_scoped_registration
),
untouched AS (
  SELECT s.server_id FROM servers s
  WHERE NOT EXISTS (
    SELECT 1 FROM server_speech_configs c WHERE c.server_id = s.server_id
      AND num_nonnulls(c.speech_design_model_id, c.speech_clone_model_id, c.speech_design_endpoint_id, c.speech_clone_endpoint_id) > 0
  ) AND NOT EXISTS (
    SELECT 1 FROM custom_endpoint_connections cec
    WHERE cec.server_id = s.server_id AND cec.user_id IS NULL AND cec.capability = 'speech'
  )
),
picks AS (
  SELECT u.server_id,
    (SELECT d.speech_model_id FROM defaults d JOIN saved_provider_configs c ON c.provider = d.provider
      WHERE c.server_id = u.server_id AND c.api_key IS NOT NULL AND d.voice_mode IN ('design', 'auto')
      ORDER BY array_position(ARRAY['google', 'openrouter', 'vertex'], d.provider), d.speech_model_id LIMIT 1) AS design_id,
    (SELECT d.speech_model_id FROM defaults d JOIN saved_provider_configs c ON c.provider = d.provider
      WHERE c.server_id = u.server_id AND c.api_key IS NOT NULL AND d.voice_mode IN ('clone', 'auto')
      ORDER BY array_position(ARRAY['google', 'openrouter', 'vertex'], d.provider), d.speech_model_id LIMIT 1) AS clone_id
  FROM untouched u
)
INSERT INTO server_speech_configs (server_id, speech_design_model_id, speech_clone_model_id)
SELECT server_id, design_id, clone_id FROM picks WHERE num_nonnulls(design_id, clone_id) > 0
ON CONFLICT (server_id) DO UPDATE SET
  speech_design_model_id = EXCLUDED.speech_design_model_id,
  speech_clone_model_id = EXCLUDED.speech_clone_model_id;

-- Each row is updated once with both modes so the per-owner capability trigger never sees a
-- half-applied assignment.
WITH defaults AS (
  SELECT provider, speech_model_id, voice_mode FROM speech_models
  WHERE is_default AND NOT is_deprecated AND NOT is_scoped_registration
),
untouched AS (
  SELECT u.user_id FROM users u
  WHERE NOT EXISTS (
    SELECT 1 FROM user_saved_provider_configs c WHERE c.user_id = u.user_id AND (
      num_nonnulls(c.speech_design_model_id, c.speech_clone_model_id) > 0
      OR COALESCE(c.assigned_capabilities, '{}') && ARRAY['speech_design', 'speech_clone']
      OR COALESCE(c.enabled_capabilities, '{}') && ARRAY['speech_design', 'speech_clone'])
  ) AND NOT EXISTS (
    SELECT 1 FROM custom_endpoint_connections cec
    WHERE cec.user_id = u.user_id AND cec.server_id IS NULL AND cec.capability = 'speech'
  )
),
design AS (
  SELECT DISTINCT ON (c.user_id) c.user_saved_config_id, d.speech_model_id
  FROM untouched u
  JOIN user_saved_provider_configs c ON c.user_id = u.user_id AND c.api_key IS NOT NULL
  JOIN defaults d ON d.provider = c.provider AND d.voice_mode IN ('design', 'auto')
  ORDER BY c.user_id, array_position(ARRAY['google', 'openrouter', 'vertex'], d.provider), d.speech_model_id
),
clone AS (
  SELECT DISTINCT ON (c.user_id) c.user_saved_config_id, d.speech_model_id
  FROM untouched u
  JOIN user_saved_provider_configs c ON c.user_id = u.user_id AND c.api_key IS NOT NULL
  JOIN defaults d ON d.provider = c.provider AND d.voice_mode IN ('clone', 'auto')
  ORDER BY c.user_id, array_position(ARRAY['google', 'openrouter', 'vertex'], d.provider), d.speech_model_id
),
targets AS (
  SELECT c.user_saved_config_id, design.speech_model_id AS design_id, clone.speech_model_id AS clone_id,
    (CASE WHEN design.speech_model_id IS NOT NULL THEN ARRAY['speech_design'] ELSE '{}'::TEXT[] END)
      || (CASE WHEN clone.speech_model_id IS NOT NULL THEN ARRAY['speech_clone'] ELSE '{}'::TEXT[] END) AS modes
  FROM user_saved_provider_configs c
  LEFT JOIN design ON design.user_saved_config_id = c.user_saved_config_id
  LEFT JOIN clone ON clone.user_saved_config_id = c.user_saved_config_id
  WHERE num_nonnulls(design.speech_model_id, clone.speech_model_id) > 0
)
UPDATE user_saved_provider_configs c SET
  speech_design_model_id = COALESCE(t.design_id, c.speech_design_model_id),
  speech_clone_model_id = COALESCE(t.clone_id, c.speech_clone_model_id),
  assigned_capabilities = COALESCE(c.assigned_capabilities, '{}') || t.modes,
  enabled_capabilities = COALESCE(c.enabled_capabilities, '{}') || t.modes
FROM targets t
WHERE c.user_saved_config_id = t.user_saved_config_id;
