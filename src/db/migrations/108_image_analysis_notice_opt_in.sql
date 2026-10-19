-- Migration 108: Default the image analysis notice to hidden.
--
-- The "Analyzing image..." card becomes opt-in for new servers and after `/reset config`;
-- `/config` > Behavior > Notices > Notice Embeds shows it again. Existing rows keep their stored
-- list, so a server that already chose visible or hidden keeps that choice.

ALTER TABLE server_notice_embeds_configs
  ALTER COLUMN tool_notice_hidden_keys SET DEFAULT '{image_analysis}';
