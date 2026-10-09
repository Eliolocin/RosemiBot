-- Rollback 093: drop the tool notice verbosity setting.
--
-- WARNING: dropping this column discards every server's choice, and the next forward migration
-- run re-adds it as Minimal for every server, including those that had chosen Verbose.

ALTER TABLE server_notice_embeds_configs DROP COLUMN IF EXISTS tool_notice_verbosity;
