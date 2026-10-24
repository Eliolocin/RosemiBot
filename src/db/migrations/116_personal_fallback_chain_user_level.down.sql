-- Rollback for migration 116: returns the personal fallback chain and randomizer to the text-owning
-- user_saved_provider_configs row, chosen by the same order the up migration used.

SELECT add_column_if_not_exists('user_saved_provider_configs', 'fallback_model_refs', 'JSONB', '''[]''::JSONB');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'model_randomizer_enabled', 'BOOLEAN', 'false', 'NOT NULL');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_personalization_configs' AND column_name = 'fallback_model_refs'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_personalization_configs' AND column_name = 'model_randomizer_enabled'
  ) THEN
    EXECUTE $restore$
      UPDATE user_saved_provider_configs target
      SET fallback_model_refs = upc.fallback_model_refs,
          model_randomizer_enabled = upc.model_randomizer_enabled
      FROM (
        SELECT DISTINCT ON (uspc.user_id) uspc.user_saved_config_id, uspc.user_id
        FROM user_saved_provider_configs uspc
        WHERE 'text' = ANY(uspc.assigned_capabilities) OR uspc.llm_id IS NOT NULL
        ORDER BY
          uspc.user_id,
          CASE
            WHEN 'text' = ANY(uspc.enabled_capabilities) AND uspc.llm_id IS NOT NULL THEN 0
            WHEN 'text' = ANY(uspc.assigned_capabilities) THEN 1
            ELSE 2
          END,
          uspc.provider COLLATE "C"
      ) source
      JOIN user_personalization_configs upc ON upc.user_id = source.user_id
      WHERE target.user_saved_config_id = source.user_saved_config_id
    $restore$;
  END IF;
END $$;

ALTER TABLE user_personalization_configs DROP COLUMN IF EXISTS fallback_model_refs;
ALTER TABLE user_personalization_configs DROP COLUMN IF EXISTS model_randomizer_enabled;
