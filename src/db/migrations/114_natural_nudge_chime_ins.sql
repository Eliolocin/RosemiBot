-- Migration 114: Natural Nudges Chime-ins.
--
-- Chime-ins join a live conversation that matches a persona's interests. The server settings ship on
-- by default, like episodes, because heat already keeps quiet servers out. The matcher asks a Decision
-- model one `choice` question, so decision models now declare that primitive; every Decision API style
-- the bot calls accepts it.

SELECT add_column_if_not_exists('server_natural_nudge_configs', 'chime_in_enabled', 'BOOLEAN', 'true', 'NOT NULL');
SELECT add_column_if_not_exists(
  'server_natural_nudge_configs', 'daily_chime_in_cap', 'SMALLINT', '3',
  'NOT NULL CHECK (daily_chime_in_cap BETWEEN 1 AND 20)'
);
SELECT add_column_if_not_exists(
  'server_natural_nudge_configs', 'chime_in_frequency', 'SMALLINT', '1',
  'NOT NULL CHECK (chime_in_frequency BETWEEN 0 AND 3)'
);

ALTER TABLE decision_models DROP CONSTRAINT IF EXISTS decision_models_supported_primitives_check;
ALTER TABLE decision_models ALTER COLUMN supported_primitives SET DEFAULT '["predicate", "choice"]'::jsonb;
UPDATE decision_models SET supported_primitives = '["predicate", "choice"]'::jsonb
WHERE supported_primitives = '["predicate"]'::jsonb;
ALTER TABLE decision_models ADD CONSTRAINT decision_models_supported_primitives_check
  CHECK (supported_primitives IN ('["predicate"]'::jsonb, '["predicate", "choice"]'::jsonb));
