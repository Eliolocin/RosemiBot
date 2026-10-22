-- Rollback 114: drop the Natural Nudges Active Nudge settings and the decision `choice` primitive.
--
-- Dropping the columns discards each server's Active Nudge choices, and the next forward run restores the
-- defaults, so a server that turned Active Nudges off has them on again.

ALTER TABLE server_natural_nudge_configs DROP COLUMN IF EXISTS active_nudge_frequency;
ALTER TABLE server_natural_nudge_configs DROP COLUMN IF EXISTS active_nudges_enabled;

ALTER TABLE decision_models DROP CONSTRAINT IF EXISTS decision_models_supported_primitives_check;
UPDATE decision_models SET supported_primitives = '["predicate"]'::jsonb;
ALTER TABLE decision_models ALTER COLUMN supported_primitives SET DEFAULT '["predicate"]'::jsonb;
ALTER TABLE decision_models ADD CONSTRAINT decision_models_supported_primitives_check
  CHECK (supported_primitives = '["predicate"]'::jsonb);
