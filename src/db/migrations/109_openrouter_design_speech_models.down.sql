-- Migration 109 down: Restore the Clone-only OpenRouter speech check.
--
-- Revert the schema.sql block and the Seed Audio catalogue row in the same rollback, or the next
-- boot reinstalls the relaxed check and reseeds the row.

-- Deprecating first lets clear_changed_speech_model release personal capability assignments, which a
-- plain delete would leave behind when the foreign keys null the selections.
UPDATE speech_models SET is_deprecated = true WHERE provider = 'openrouter' AND voice_mode = 'design';
DELETE FROM speech_models WHERE provider = 'openrouter' AND voice_mode = 'design';
ALTER TABLE speech_models DROP CONSTRAINT IF EXISTS speech_models_provider_mode;
ALTER TABLE speech_models ADD CONSTRAINT speech_models_check
  CHECK ((provider = 'openrouter' AND voice_mode = 'clone') OR (provider IN ('google', 'vertex') AND voice_mode = 'design'));
