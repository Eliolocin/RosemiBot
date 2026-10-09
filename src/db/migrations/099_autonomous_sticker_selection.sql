-- Sticker selection is autonomous, so its former intent triggers are obsolete.
UPDATE server_trigger_behavior_configs
SET deliberate_tool_triggers = deliberate_tool_triggers - 'sticker'
WHERE deliberate_tool_triggers ? 'sticker';
