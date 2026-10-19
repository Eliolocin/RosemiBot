-- Migration 111: Move legacy `#name` channel scopes aside so channel IDs can replace them.
--
-- Documents and server memories now store their channel scope in channel_disc_ids (added by
-- schema.sql and schema_rag.sql). Resolving a stored channel name to an ID needs the Discord API,
-- which a migration cannot call, so this migration copies every legacy scope into
-- legacy_channel_scope_tags before dropping documents.channel_tags and stripping `#` entries from
-- server_memories.tags. Until a copied row is resolved, readers treat its document or memory as active in
-- every channel, matching an empty scope, so a filtered item widens once rather than disappearing. On login,
-- src/utils/memory/legacyChannelScopeBackfill.ts narrows the names that match a guild channel; an admin
-- settles the rest by saving the item's form with channels picked.

CREATE TABLE IF NOT EXISTS legacy_channel_scope_tags (
  source_table TEXT NOT NULL CHECK (source_table IN ('documents', 'server_memories')),
  row_id INT NOT NULL,
  server_id INT NOT NULL,
  channel_tags TEXT[] NOT NULL,
  resolved_at TIMESTAMPTZ,
  PRIMARY KEY (source_table, row_id)
);

INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
SELECT 'server_memories',
       sm.server_memory_id,
       sm.server_id,
       ARRAY(SELECT tag FROM unnest(sm.tags) AS tag WHERE btrim(tag, '"'' ') LIKE '#%')
FROM server_memories sm
WHERE EXISTS (SELECT 1 FROM unnest(sm.tags) AS tag WHERE btrim(tag, '"'' ') LIKE '#%')
ON CONFLICT (source_table, row_id) DO NOTHING;

UPDATE server_memories sm
SET tags = ARRAY(SELECT tag FROM unnest(sm.tags) AS tag WHERE btrim(tag, '"'' ') NOT LIKE '#%')
WHERE EXISTS (SELECT 1 FROM unnest(sm.tags) AS tag WHERE btrim(tag, '"'' ') LIKE '#%');

-- documents exists only where pgvector is installed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'documents'
      AND column_name = 'channel_tags'
  ) THEN
    INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
    SELECT 'documents', d.document_id, d.server_id, d.channel_tags
    FROM documents d
    WHERE cardinality(d.channel_tags) > 0
    ON CONFLICT (source_table, row_id) DO NOTHING;

    ALTER TABLE documents DROP COLUMN channel_tags;
  END IF;
END $$;
