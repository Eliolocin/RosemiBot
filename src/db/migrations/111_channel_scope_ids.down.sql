-- Migration 111 down: Restore the legacy `#name` channel scopes from legacy_channel_scope_tags.
--
-- Every copied scope is restored, including rows already resolved, because the previous code reads
-- only the names. channel_disc_ids stays in place: schema.sql and schema_rag.sql own that column.
-- Once a later release drops legacy_channel_scope_tags, the names are no longer recoverable here.

DO $$
BEGIN
  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE documents ADD COLUMN IF NOT EXISTS channel_tags TEXT[] DEFAULT ARRAY[]::TEXT[];

    UPDATE documents d
    SET channel_tags = l.channel_tags
    FROM legacy_channel_scope_tags l
    WHERE l.source_table = 'documents'
      AND l.row_id = d.document_id;
  END IF;
END $$;

UPDATE server_memories sm
SET tags = COALESCE(sm.tags, ARRAY[]::TEXT[]) || l.channel_tags
FROM legacy_channel_scope_tags l
WHERE l.source_table = 'server_memories'
  AND l.row_id = sm.server_memory_id;

DROP TABLE IF EXISTS legacy_channel_scope_tags;
