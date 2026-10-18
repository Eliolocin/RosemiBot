-- Migration 106 rollback: Restore server_chat_configs.response_decision_model_id with no saved selections.

ALTER TABLE server_chat_configs
  ADD COLUMN IF NOT EXISTS response_decision_model_id INT REFERENCES decision_models(decision_model_id) ON DELETE SET NULL;
