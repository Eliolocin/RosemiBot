CREATE TABLE IF NOT EXISTS oauth_states (
  oauth_state_id SERIAL PRIMARY KEY,
  nonce_hash TEXT NOT NULL UNIQUE,
  flow TEXT NOT NULL CHECK (flow ~ '^[a-z][a-z0-9_-]{0,63}$'),
  subject TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
