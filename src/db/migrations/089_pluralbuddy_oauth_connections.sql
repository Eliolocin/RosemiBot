CREATE TABLE IF NOT EXISTS pluralbuddy_oauth_connections (
  instance_id TEXT PRIMARY KEY REFERENCES message_proxy_instances(instance_id),
  origin TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret BYTEA NOT NULL,
  client_secret_key_version INTEGER NOT NULL,
  refresh_token BYTEA NOT NULL,
  refresh_token_key_version INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION validate_pluralbuddy_oauth_connection()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM message_proxy_instances
    WHERE instance_id = NEW.instance_id
      AND service_id = 'pluralbuddy'
      AND origin = NEW.origin
  ) THEN
    RAISE EXCEPTION 'PluralBuddy OAuth connection must match its instance and origin';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_pluralbuddy_oauth_connection_before_write ON pluralbuddy_oauth_connections;
CREATE TRIGGER validate_pluralbuddy_oauth_connection_before_write
BEFORE INSERT OR UPDATE ON pluralbuddy_oauth_connections
FOR EACH ROW EXECUTE FUNCTION validate_pluralbuddy_oauth_connection();

DROP TRIGGER IF EXISTS update_pluralbuddy_oauth_connections_timestamp ON pluralbuddy_oauth_connections;
CREATE TRIGGER update_pluralbuddy_oauth_connections_timestamp
BEFORE UPDATE ON pluralbuddy_oauth_connections
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
