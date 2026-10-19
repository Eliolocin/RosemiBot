-- Migration 108 down: Restore the empty hidden notice list default.

ALTER TABLE server_notice_embeds_configs
  ALTER COLUMN tool_notice_hidden_keys SET DEFAULT '{}';
