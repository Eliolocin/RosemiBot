-- Migration 114: Natural Nudges Active Nudges.
--
-- Active Nudges join a live conversation that matches a persona's interests. The server settings ship on
-- by default, like idle nudges, because heat already keeps quiet servers out. The matcher asks a Decision
-- model one `choice` question, so decision models now declare that primitive; every Decision API style
-- the bot calls accepts it.

SELECT add_column_if_not_exists('server_natural_nudge_configs', 'active_nudges_enabled', 'BOOLEAN', 'true', 'NOT NULL');
SELECT add_column_if_not_exists(
  'server_natural_nudge_configs', 'active_nudge_frequency', 'SMALLINT', '1',
  'NOT NULL CHECK (active_nudge_frequency BETWEEN 0 AND 3)'
);

ALTER TABLE decision_models DROP CONSTRAINT IF EXISTS decision_models_supported_primitives_check;
ALTER TABLE decision_models ALTER COLUMN supported_primitives SET DEFAULT '["predicate", "choice"]'::jsonb;
UPDATE decision_models SET supported_primitives = '["predicate", "choice"]'::jsonb
WHERE supported_primitives = '["predicate"]'::jsonb;
ALTER TABLE decision_models ADD CONSTRAINT decision_models_supported_primitives_check
  CHECK (supported_primitives IN ('["predicate"]'::jsonb, '["predicate", "choice"]'::jsonb));
