-- Migration 112: Natural Nudges Reach-out opt-out.
--
-- A Reach-out episode pings one user by name, so every user can refuse to be its target from
-- `/personal config` > Privacy. Unset accounts stay eligible, matching the feature being on by default.

SELECT add_column_if_not_exists('user_personalization_configs', 'natural_nudge_opt_out', 'BOOLEAN', 'false', 'NOT NULL');
