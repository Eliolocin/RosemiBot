ALTER TABLE server_model_configs
  ADD COLUMN IF NOT EXISTS subscription_capabilities TEXT[] NOT NULL DEFAULT '{}';

UPDATE server_model_configs m
SET subscription_capabilities = ARRAY(
  SELECT capability FROM (VALUES
    ('text', m.llm_id, s.llm_id, m.api_key IS NULL AND EXISTS (SELECT 1 FROM llms model WHERE model.llm_id = m.llm_id AND model.llm_provider = 'openrouter')),
    ('embedding', m.embedding_model_id, s.embedding_model_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM embedding_models model WHERE model.embedding_model_id = m.embedding_model_id AND model.provider = 'openrouter')),
    ('image', m.diffusion_model_id, s.diffusion_model_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM image_diffusion_models model WHERE model.diffusion_model_id = m.diffusion_model_id AND model.provider = 'openrouter')),
    ('video', m.video_model_id, s.video_model_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM video_generation_models model WHERE model.video_model_id = m.video_model_id AND model.provider = 'openrouter')),
    ('vision', m.vision_llm_id, s.vision_llm_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM llms model WHERE model.llm_id = m.vision_llm_id AND model.llm_provider = 'openrouter')),
    ('speech_design', v.speech_design_model_id, v.speech_design_model_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM speech_models speech WHERE speech.speech_model_id = v.speech_design_model_id AND speech.provider = 'openrouter')),
    ('reviewer', chat.response_reviewer_llm_id, chat.response_reviewer_llm_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM llms model WHERE model.llm_id = chat.response_reviewer_llm_id AND model.llm_provider = 'openrouter')),
    ('speech_clone', v.speech_clone_model_id, v.speech_clone_model_id, b.api_key IS NULL AND EXISTS (SELECT 1 FROM speech_models speech WHERE speech.speech_model_id = v.speech_clone_model_id AND speech.provider = 'openrouter'))
  ) AS selection(capability, active_id, saved_id, unambiguous)
  WHERE active_id IS NOT NULL AND active_id = saved_id AND unambiguous
)
FROM saved_provider_configs s
LEFT JOIN saved_provider_configs b ON b.server_id = s.server_id AND b.provider = 'openrouter'
LEFT JOIN server_speech_configs v ON v.server_id = s.server_id
LEFT JOIN server_chat_configs chat ON chat.server_id = s.server_id
WHERE s.server_id = m.server_id AND s.provider = 'supporter';
