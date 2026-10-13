CREATE TABLE IF NOT EXISTS message_proxy_instances (
  instance_id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL CHECK (service_id IN ('pluralkit', 'pluralbuddy')),
  origin TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT message_proxy_instances_id_format CHECK (
    instance_id = service_id || ':official'
    OR instance_id ~ ('^' || service_id || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  )
);

INSERT INTO message_proxy_instances (instance_id, service_id, origin, display_name, enabled)
VALUES
  ('pluralkit:official', 'pluralkit', 'https://api.pluralkit.me', 'PluralKit', true),
  ('pluralbuddy:official', 'pluralbuddy', 'https://pluralbuddy.app', 'PluralBuddy', true)
ON CONFLICT (instance_id) DO NOTHING;

CREATE OR REPLACE FUNCTION keep_message_proxy_instance_identity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.instance_id <> OLD.instance_id OR NEW.service_id <> OLD.service_id OR NEW.origin <> OLD.origin THEN
    RAISE EXCEPTION 'Message-proxy instance identity and origin are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS keep_message_proxy_instance_identity_before_update ON message_proxy_instances;
CREATE TRIGGER keep_message_proxy_instance_identity_before_update
BEFORE UPDATE ON message_proxy_instances
FOR EACH ROW EXECUTE FUNCTION keep_message_proxy_instance_identity();

DROP TRIGGER IF EXISTS update_message_proxy_instances_timestamp ON message_proxy_instances;
CREATE TRIGGER update_message_proxy_instances_timestamp
BEFORE UPDATE ON message_proxy_instances
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

SELECT add_column_if_not_exists('users', 'message_proxy_instance_id', 'TEXT');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_message_proxy_instance_id_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_message_proxy_instance_id_fkey
      FOREIGN KEY (message_proxy_instance_id) REFERENCES message_proxy_instances(instance_id);
  END IF;
END $$;
UPDATE users SET message_proxy_instance_id = message_proxy_service || ':official'
WHERE message_proxy_instance_id IS NULL AND message_proxy_service IN ('pluralkit', 'pluralbuddy');

ALTER TABLE external_identities ADD COLUMN IF NOT EXISTS instance_id TEXT REFERENCES message_proxy_instances(instance_id);
UPDATE external_identities SET instance_id = CASE kind
  WHEN 'pluralkit_member' THEN 'pluralkit:official'
  WHEN 'pluralbuddy_alter' THEN 'pluralbuddy:official'
END WHERE instance_id IS NULL;
ALTER TABLE external_identities ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE external_identities DROP CONSTRAINT IF EXISTS external_identities_kind_external_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'external_identities_kind_instance_id_external_key_key') THEN
    ALTER TABLE external_identities ADD CONSTRAINT external_identities_kind_instance_id_external_key_key
      UNIQUE (kind, instance_id, external_key);
  END IF;
END $$;

ALTER TABLE message_proxy_namespaces ADD COLUMN IF NOT EXISTS instance_id TEXT REFERENCES message_proxy_instances(instance_id);
UPDATE message_proxy_namespaces SET instance_id = service_id || ':official' WHERE instance_id IS NULL;
ALTER TABLE message_proxy_namespaces ALTER COLUMN instance_id SET NOT NULL;
ALTER TABLE message_proxy_namespaces DROP CONSTRAINT IF EXISTS message_proxy_namespaces_service_id_namespace_key_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_proxy_namespaces_instance_id_namespace_key_key') THEN
    ALTER TABLE message_proxy_namespaces ADD CONSTRAINT message_proxy_namespaces_instance_id_namespace_key_key
      UNIQUE (instance_id, namespace_key);
  END IF;
END $$;
