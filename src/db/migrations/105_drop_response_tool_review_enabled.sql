-- Migration 105: Carry response_tool_review_enabled into response_review_items and drop the flag.
--
-- The `tools` review item replaced this flag without carrying it over, so an enabled flag
-- becomes the item before the column is dropped.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'server_chat_configs'
      AND column_name = 'response_tool_review_enabled'
  ) THEN
    UPDATE server_chat_configs
    SET response_review_items = array_append(response_review_items, 'tools')
    WHERE response_tool_review_enabled
      AND NOT ('tools' = ANY (response_review_items));
  END IF;
END $$;

ALTER TABLE server_chat_configs
  DROP COLUMN IF EXISTS response_tool_review_enabled;
