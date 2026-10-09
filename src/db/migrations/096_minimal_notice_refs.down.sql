-- Rollback 096: drop Minimal notice references.
--
-- Minimal memory and task notices already in Discord fall back to their bare title in context.

DROP TABLE IF EXISTS minimal_notice_refs;
