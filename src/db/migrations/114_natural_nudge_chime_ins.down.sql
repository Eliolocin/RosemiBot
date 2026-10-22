-- Rollback 114: drop the Natural Nudges Chime-in settings and the decision `choice` primitive.
--
-- Dropping the columns discards each server's Chime-in choices, and the next forward run restores the
-- defaults, so a server that turned Chime-ins off has them on again.

ALTER TABLE server_natural_nudge_configs DROP COLUMN IF EXISTS chime_in_frequency;
ALTER TABLE server_natural_nudge_configs DROP COLUMN IF EXISTS chime_in_enabled;

ALTER TABLE decision_models DROP CONSTRAINT IF EXISTS decision_models_supported_primitives_check;
UPDATE decision_models SET supported_primitives = '["predicate"]'::jsonb;
ALTER TABLE decision_models ALTER COLUMN supported_primitives SET DEFAULT '["predicate"]'::jsonb;
ALTER TABLE decision_models ADD CONSTRAINT decision_models_supported_primitives_check
  CHECK (supported_primitives = '["predicate"]'::jsonb);
