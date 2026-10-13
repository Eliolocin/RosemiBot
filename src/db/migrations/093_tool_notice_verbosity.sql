-- Migration 093: Notice verbosity for tool notices posted in the conversation.
--
-- Adds the setting behind `/config` > Behavior > Notices > Notice Verbosity. Minimal renders a
-- visible tool notice as its title alone; Verbose keeps the full card. Existing servers move to
-- Minimal on purpose: the column default is the only source of the default, so `/setup` must never
-- write this column, or a later change to the default would stop reaching that server.

SELECT add_column_if_not_exists(
  'server_notice_embeds_configs',
  'tool_notice_verbosity',
  'TEXT',
  '''minimal''',
  'NOT NULL CHECK (tool_notice_verbosity IN (''minimal'', ''verbose''))'
);
