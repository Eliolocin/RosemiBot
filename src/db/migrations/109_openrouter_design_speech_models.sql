-- Migration 109: Allow OpenRouter speech models in the Design slot.
--
-- schema.sql applies the same block before the model seed runs, so on an upgraded database this
-- migration finds the named constraint already in place.

DO $$
DECLARE legacy_check RECORD;
BEGIN
  FOR legacy_check IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'speech_models'::regclass AND contype = 'c' AND conname <> 'speech_models_provider_mode'
      AND pg_get_constraintdef(oid) LIKE '%provider%' AND pg_get_constraintdef(oid) LIKE '%voice_mode%'
  LOOP
    EXECUTE format('ALTER TABLE speech_models DROP CONSTRAINT %I', legacy_check.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'speech_models'::regclass AND conname = 'speech_models_provider_mode'
  ) THEN
    ALTER TABLE speech_models ADD CONSTRAINT speech_models_provider_mode CHECK (
      (provider = 'openrouter' AND voice_mode IN ('design', 'clone')) OR (provider IN ('google', 'vertex') AND voice_mode = 'design')
    );
  END IF;
END $$;
