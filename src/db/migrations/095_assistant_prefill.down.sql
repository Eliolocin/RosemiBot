-- Rollback 095: drop the assistant prefill capability and the server response prefill.
--
-- WARNING: every saved server prefill is lost, and so is any prefill toggle a user set on a custom
-- endpoint or registered model. Seeded rows regain their values from the catalog on the next boot.

ALTER TABLE server_chat_configs DROP COLUMN IF EXISTS response_prefill;
ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS supports_assistant_prefill;
ALTER TABLE llms DROP COLUMN IF EXISTS supports_assistant_prefill;
