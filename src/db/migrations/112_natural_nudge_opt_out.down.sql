-- Rollback 112: drop the Natural Nudges Reach-out opt-out.
--
-- WARNING: dropping this column discards every account's opt-out, and the next forward migration run
-- re-adds it as false, so those users can be pinged by Reach-out episodes again.

ALTER TABLE user_personalization_configs DROP COLUMN IF EXISTS natural_nudge_opt_out;
