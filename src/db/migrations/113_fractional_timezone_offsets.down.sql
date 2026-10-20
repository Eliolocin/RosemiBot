-- Migration 113 down: Restore whole-hour timezone offsets.
--
-- Fractional offsets round to the nearest hour, so a UTC+5:30 user becomes UTC+6.

ALTER TABLE user_personalization_configs
  DROP CONSTRAINT IF EXISTS user_personalization_configs_timezone_offset_check;

ALTER TABLE user_personalization_configs
  ALTER COLUMN timezone_offset TYPE SMALLINT USING round(timezone_offset)::SMALLINT;

ALTER TABLE user_personalization_configs
  ADD CONSTRAINT user_personalization_configs_timezone_offset_check
  CHECK (timezone_offset IS NULL OR timezone_offset BETWEEN -12 AND 14);

ALTER TABLE server_chat_configs
  ALTER COLUMN timezone_offset TYPE INT USING round(timezone_offset)::INT;
