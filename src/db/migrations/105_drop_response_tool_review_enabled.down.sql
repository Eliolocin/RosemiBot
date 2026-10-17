-- Migration 105 rollback: Restore server_chat_configs.response_tool_review_enabled from the tools review item.

ALTER TABLE server_chat_configs
  ADD COLUMN IF NOT EXISTS response_tool_review_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE server_chat_configs
SET response_tool_review_enabled = true
WHERE 'tools' = ANY (response_review_items);
