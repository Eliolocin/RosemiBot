-- Migration 106: Drop server_chat_configs.response_decision_model_id.
--
-- Response Drafting no longer routes reviews through a Decision model, so the saved selection has no reader.

ALTER TABLE server_chat_configs
  DROP COLUMN IF EXISTS response_decision_model_id;
