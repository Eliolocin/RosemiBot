ALTER TABLE discord_managed_webhooks ADD COLUMN IF NOT EXISTS avatar_fingerprint TEXT;
ALTER TABLE discord_managed_webhooks ADD COLUMN IF NOT EXISTS discord_avatar_hash TEXT;
