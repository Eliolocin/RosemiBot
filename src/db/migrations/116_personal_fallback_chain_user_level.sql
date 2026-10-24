-- Migration 116: One personal text fallback chain per user.
--
-- The personal chain and its randomizer lived on each user_saved_provider_configs row, but only the
-- active text row's copy ever ran, so a personal chain could not mix providers. Both move to
-- user_personalization_configs, matching the server-wide chain on server_chat_configs.
--
-- The backfill keeps the text-owning row's values and drops the rest, because that is the only chain
-- that ran. The source row mirrors `getActivePersonalProviderForCapability(rows, "text") ??
-- getStoredPersonalProviderForCapability(rows, "text")`: an enabled row with a model, else an
-- assigned row, else any row with a model, each ordered by provider name. COLLATE "C" reproduces the
-- TypeScript `localeCompare` order because provider names are lowercase ASCII.
--
-- The old writer bound `JSON.stringify(refs)::jsonb`, which Bun stores as a scalar JSONB string (see
-- migration 064), so a string holding a JSON array is unwrapped rather than discarded.

ALTER TABLE user_personalization_configs
  ADD COLUMN IF NOT EXISTS fallback_model_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN IF NOT EXISTS model_randomizer_enabled BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_saved_provider_configs' AND column_name = 'fallback_model_refs'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_saved_provider_configs' AND column_name = 'model_randomizer_enabled'
  ) THEN
    EXECUTE $backfill$
      INSERT INTO user_personalization_configs (user_id, fallback_model_refs, model_randomizer_enabled)
      SELECT DISTINCT ON (uspc.user_id)
        uspc.user_id,
        CASE jsonb_typeof(uspc.fallback_model_refs)
          WHEN 'array' THEN uspc.fallback_model_refs
          WHEN 'string' THEN
            CASE WHEN left(ltrim(uspc.fallback_model_refs #>> '{}'), 1) = '['
              THEN (uspc.fallback_model_refs #>> '{}')::JSONB
              ELSE '[]'::JSONB
            END
          ELSE '[]'::JSONB
        END,
        COALESCE(uspc.model_randomizer_enabled, false)
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
      ON CONFLICT (user_id) DO UPDATE SET
        fallback_model_refs = EXCLUDED.fallback_model_refs,
        model_randomizer_enabled = EXCLUDED.model_randomizer_enabled
    $backfill$;
  END IF;
END $$;

ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS fallback_model_refs;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS model_randomizer_enabled;
