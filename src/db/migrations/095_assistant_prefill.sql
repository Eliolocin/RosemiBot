-- Migration 095: assistant prefill capability and the server response prefill.
--
-- `supports_assistant_prefill` records whether a model continues a trailing assistant turn. It is
-- separate from `supports_prefix_completion`, which means the backend needs the `prefix: true`
-- marker; this flag means the backend accepts the trailing turn at all. Unlisted models stay false,
-- so the resolver never sends them a prefill. The backfill mirrors the seed catalog, which the
-- per-boot reseed keeps authoritative afterwards.
--
-- `response_prefill` is the server-wide prefill set beside the system prompt. NULL means unset.

SELECT add_column_if_not_exists('llms', 'supports_assistant_prefill', 'BOOLEAN', 'false', 'NOT NULL');
SELECT add_column_if_not_exists('custom_endpoints', 'supports_assistant_prefill', 'BOOLEAN', 'false', 'NOT NULL');
SELECT add_column_if_not_exists('server_chat_configs', 'response_prefill', 'TEXT');

UPDATE llms
SET supports_assistant_prefill = true, updated_at = CURRENT_TIMESTAMP
WHERE supports_assistant_prefill = false
  AND (
    (llm_provider = 'anthropic' AND llm_codename = 'claude-haiku-4-5')
    OR (
      llm_provider IN ('google', 'vertex', 'vertexexpress')
      AND llm_codename IN (
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite',
        'gemini-3.1-flash-lite-preview',
        'gemini-3.5-flash'
      )
    )
    OR (
      llm_provider = 'openrouter'
      AND llm_codename IN (
        'anthropic/claude-haiku-4.5',
        'anthropic/claude-sonnet-4.5',
        'google/gemini-3-flash-preview',
        'google/gemini-3.1-flash-lite',
        'google/gemini-3.1-flash-lite-preview'
      )
    )
  );
