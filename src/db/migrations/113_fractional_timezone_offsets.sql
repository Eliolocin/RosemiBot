-- Migration 113: Store timezone offsets as fractional hours.
--
-- India (+5:30), Nepal (+5:45), Newfoundland (-3:30), and other real zones sit off the whole hour, so
-- both offset columns become REAL. Every value they can hold, quarter hours from -12 to +14, is
-- exact in binary floating point, and Bun decodes REAL as a JS number (NUMERIC would arrive as a
-- string). The personal CHECK keeps its existing name so schema.sql and migration 062 agree with it.

ALTER TABLE server_chat_configs
  ALTER COLUMN timezone_offset TYPE REAL;

ALTER TABLE user_personalization_configs
  DROP CONSTRAINT IF EXISTS user_personalization_configs_timezone_offset_check;

ALTER TABLE user_personalization_configs
  ALTER COLUMN timezone_offset TYPE REAL;

ALTER TABLE user_personalization_configs
  ADD CONSTRAINT user_personalization_configs_timezone_offset_check
  CHECK (
    timezone_offset IS NULL
    OR (timezone_offset BETWEEN -12 AND 14 AND timezone_offset * 4 = round(timezone_offset * 4))
  );
