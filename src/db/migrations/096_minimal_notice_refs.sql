-- Migration 096: references from Minimal tool notices to the memory or task they confirmed.
--
-- A Minimal notice posts only its title, so the model rebuilding context from Discord history could
-- not see what it had saved and saved it again. Each row lets context rebuilding join the notice
-- message to the live memory or task row and restore its body. Only the reference is stored, so a
-- deleted memory or a `/personal nuke` stops it resolving without any extra cleanup.

CREATE TABLE IF NOT EXISTS minimal_notice_refs (
  message_disc_id TEXT PRIMARY KEY,
  ref_kind TEXT NOT NULL CHECK (ref_kind IN ('server_memory', 'personal_memory', 'task')),
  ref_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_minimal_notice_refs_created
  ON minimal_notice_refs(created_at);
