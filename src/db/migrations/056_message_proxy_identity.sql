-- Migration 056: service-neutral message-proxy identity and attribution storage.

SELECT add_column_if_not_exists('users', 'message_proxy_service', 'TEXT');

CREATE TABLE IF NOT EXISTS external_identities (
  external_identity_id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  external_key TEXT NOT NULL,
  user_id INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, external_key)
);

DROP TRIGGER IF EXISTS update_external_identities_timestamp ON external_identities;
CREATE TRIGGER update_external_identities_timestamp
BEFORE UPDATE ON external_identities
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS message_proxy_namespaces (
  message_proxy_namespace_id SERIAL PRIMARY KEY,
  service_id TEXT NOT NULL,
  namespace_key TEXT NOT NULL,
  short_id TEXT,
  display_name TEXT,
  tag TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (service_id, namespace_key)
);

DROP TRIGGER IF EXISTS update_message_proxy_namespaces_timestamp ON message_proxy_namespaces;
CREATE TRIGGER update_message_proxy_namespaces_timestamp
BEFORE UPDATE ON message_proxy_namespaces
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS message_proxy_identities (
  message_proxy_identity_id SERIAL PRIMARY KEY,
  message_proxy_namespace_id INT NOT NULL REFERENCES message_proxy_namespaces(message_proxy_namespace_id) ON DELETE CASCADE,
  external_identity_id INT NOT NULL UNIQUE REFERENCES external_identities(external_identity_id) ON DELETE CASCADE,
  short_id TEXT,
  display_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_proxy_identities_namespace
  ON message_proxy_identities(message_proxy_namespace_id);

DROP TRIGGER IF EXISTS update_message_proxy_identities_timestamp ON message_proxy_identities;
CREATE TRIGGER update_message_proxy_identities_timestamp
BEFORE UPDATE ON message_proxy_identities
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE IF NOT EXISTS message_proxy_namespace_accounts (
  message_proxy_namespace_id INT NOT NULL REFERENCES message_proxy_namespaces(message_proxy_namespace_id) ON DELETE CASCADE,
  host_user_disc_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_proxy_namespace_id, host_user_disc_id)
);

CREATE INDEX IF NOT EXISTS idx_message_proxy_namespace_accounts_host
  ON message_proxy_namespace_accounts(host_user_disc_id);

CREATE TABLE IF NOT EXISTS message_proxy_message_index (
  message_disc_id TEXT PRIMARY KEY,
  external_identity_id INT NOT NULL REFERENCES external_identities(external_identity_id) ON DELETE CASCADE,
  sender_disc_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_proxy_message_index_created
  ON message_proxy_message_index(created_at);
