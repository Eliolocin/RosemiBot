ALTER TABLE pluralbuddy_oauth_connections
  ADD COLUMN IF NOT EXISTS access_token BYTEA,
  ADD COLUMN IF NOT EXISTS access_token_key_version INTEGER,
  ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_blocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_retry_after TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pluralbuddy_access_token_complete') THEN
    ALTER TABLE pluralbuddy_oauth_connections
      ADD CONSTRAINT pluralbuddy_access_token_complete CHECK (
        (access_token IS NULL AND access_token_key_version IS NULL AND access_expires_at IS NULL)
        OR (access_token IS NOT NULL AND access_token_key_version IS NOT NULL AND access_expires_at IS NOT NULL)
      );
  END IF;
END $$;
