-- Rollback 112: drop the Natural Nudges Pings from Personas opt-out.
--
-- WARNING: dropping this column discards every account's opt-out, and the next forward migration run
-- re-adds it as false, so those users can be pinged by Ping User idle nudges again.

ALTER TABLE user_personalization_configs DROP COLUMN IF EXISTS natural_nudge_opt_out;
