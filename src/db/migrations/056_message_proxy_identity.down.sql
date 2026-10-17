DROP TABLE IF EXISTS message_proxy_message_index;
DROP TABLE IF EXISTS message_proxy_namespace_accounts;
DROP TABLE IF EXISTS message_proxy_identities;
DROP TABLE IF EXISTS message_proxy_namespaces;
DROP TABLE IF EXISTS external_identities;

ALTER TABLE users DROP COLUMN IF EXISTS message_proxy_service;
