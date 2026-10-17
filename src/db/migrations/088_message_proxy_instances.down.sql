DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM external_identities WHERE instance_id NOT IN ('pluralkit:official', 'pluralbuddy:official'))
    OR EXISTS (SELECT 1 FROM message_proxy_namespaces WHERE instance_id NOT IN ('pluralkit:official', 'pluralbuddy:official'))
    OR EXISTS (SELECT 1 FROM users WHERE message_proxy_instance_id NOT IN ('pluralkit:official', 'pluralbuddy:official'))
  THEN
    RAISE EXCEPTION 'Cannot roll back message-proxy instances while custom data is referenced';
  END IF;
END $$;

ALTER TABLE message_proxy_namespaces DROP CONSTRAINT message_proxy_namespaces_instance_id_namespace_key_key;
ALTER TABLE message_proxy_namespaces ADD CONSTRAINT message_proxy_namespaces_service_id_namespace_key_key
  UNIQUE (service_id, namespace_key);
ALTER TABLE message_proxy_namespaces DROP COLUMN instance_id;

ALTER TABLE external_identities DROP CONSTRAINT external_identities_kind_instance_id_external_key_key;
ALTER TABLE external_identities ADD CONSTRAINT external_identities_kind_external_key_key
  UNIQUE (kind, external_key);
ALTER TABLE external_identities DROP COLUMN instance_id;

ALTER TABLE users DROP COLUMN message_proxy_instance_id;
DROP TABLE message_proxy_instances;
DROP FUNCTION keep_message_proxy_instance_identity();
