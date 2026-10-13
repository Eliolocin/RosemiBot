ALTER TABLE message_proxy_instances
  DROP CONSTRAINT IF EXISTS message_proxy_instances_bot_user_id_format;
ALTER TABLE message_proxy_instances DROP COLUMN IF EXISTS bot_user_id;
