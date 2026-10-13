SELECT add_column_if_not_exists('message_proxy_instances', 'bot_user_id', 'TEXT');

UPDATE message_proxy_instances
SET bot_user_id = CASE instance_id
  WHEN 'pluralkit:official' THEN '466378653216014359'
  WHEN 'pluralbuddy:official' THEN '1436973163211657278'
  ELSE bot_user_id
END
WHERE instance_id IN ('pluralkit:official', 'pluralbuddy:official');

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'message_proxy_instances_bot_user_id_format'
  ) THEN
    ALTER TABLE message_proxy_instances
      ADD CONSTRAINT message_proxy_instances_bot_user_id_format
      CHECK (bot_user_id IS NULL OR bot_user_id ~ '^[0-9]{17,20}$');
  END IF;
END $$;
