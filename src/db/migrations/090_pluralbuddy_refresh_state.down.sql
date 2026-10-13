ALTER TABLE pluralbuddy_oauth_connections
  DROP CONSTRAINT pluralbuddy_access_token_complete,
  DROP COLUMN refresh_retry_after,
  DROP COLUMN refresh_blocked_at,
  DROP COLUMN access_expires_at,
  DROP COLUMN access_token_key_version,
  DROP COLUMN access_token;
