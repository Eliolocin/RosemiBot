import type { SQL } from "bun";
import { sql as defaultSql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export const SUPPORTER_BILLING_TABLE_NAMES = [
  "supporter_identities",
  "supporter_entitlements",
  "supporter_server_sponsorships",
  "supporter_webhook_events",
  "supporter_patreon_creator_tokens",
  "supporter_member_keys",
  "supporter_usage_statistics",
] as const;

export type SupporterBillingTableName = (typeof SUPPORTER_BILLING_TABLE_NAMES)[number];

export interface SupporterBillingSchemaInitializationResult {
  initializedTables: readonly SupporterBillingTableName[];
}

const SUPPORTER_BILLING_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS supporter_identities (
      supporter_identity_id SERIAL PRIMARY KEY,
      discord_user_id TEXT NOT NULL,
      patreon_user_id TEXT NOT NULL,
      patreon_member_id TEXT NOT NULL,
      patreon_campaign_id TEXT NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_oauth_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT supporter_identities_discord_user_id_key UNIQUE (discord_user_id),
      CONSTRAINT supporter_identities_patreon_member_id_key UNIQUE (patreon_member_id)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_supporter_identities_patreon_user ON supporter_identities(patreon_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_supporter_identities_campaign ON supporter_identities(patreon_campaign_id)",
  "DROP TRIGGER IF EXISTS update_supporter_identities_timestamp ON supporter_identities",
  `
    CREATE TRIGGER update_supporter_identities_timestamp
    BEFORE UPDATE ON supporter_identities
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp()
  `,
  `
    CREATE TABLE IF NOT EXISTS supporter_entitlements (
      supporter_entitlement_id SERIAL PRIMARY KEY,
      supporter_identity_id INTEGER NOT NULL REFERENCES supporter_identities(supporter_identity_id) ON DELETE CASCADE,
      tier_key TEXT NOT NULL,
      patreon_tier_id TEXT NOT NULL,
      patron_status TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT false,
      cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
      period_start TIMESTAMPTZ,
      period_end TIMESTAMPTZ,
      last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT supporter_entitlements_identity_key UNIQUE (supporter_identity_id),
      CONSTRAINT supporter_entitlements_source_check CHECK (source IN ('oauth', 'webhook', 'reconcile', 'manual_admin')),
      CONSTRAINT supporter_entitlements_period_order_check CHECK (
        period_start IS NULL OR period_end IS NULL OR period_end > period_start
      )
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_supporter_entitlements_active ON supporter_entitlements(is_active, tier_key)",
  "CREATE INDEX IF NOT EXISTS idx_supporter_entitlements_period_end ON supporter_entitlements(period_end)",
  "ALTER TABLE supporter_entitlements ADD COLUMN IF NOT EXISTS last_successful_charge_at TIMESTAMPTZ",
  "ALTER TABLE supporter_entitlements ADD COLUMN IF NOT EXISTS next_charge_at TIMESTAMPTZ",
  "ALTER TABLE supporter_entitlements ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false",
  "DROP TRIGGER IF EXISTS update_supporter_entitlements_timestamp ON supporter_entitlements",
  `
    CREATE TRIGGER update_supporter_entitlements_timestamp
    BEFORE UPDATE ON supporter_entitlements
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp()
  `,
  `DO $$ BEGIN
    IF to_regclass('public.supporter_usage_periods') IS NOT NULL
      OR to_regclass('public.supporter_usage_reservations') IS NOT NULL
      OR to_regclass('public.supporter_usage_events') IS NOT NULL THEN
      CREATE SCHEMA IF NOT EXISTS supporter_accounting_archive;
      REVOKE ALL ON SCHEMA supporter_accounting_archive FROM PUBLIC;
      ALTER TABLE IF EXISTS public.supporter_usage_periods SET SCHEMA supporter_accounting_archive;
      ALTER TABLE IF EXISTS public.supporter_usage_reservations SET SCHEMA supporter_accounting_archive;
      ALTER TABLE IF EXISTS public.supporter_usage_events SET SCHEMA supporter_accounting_archive;
      REVOKE ALL ON ALL TABLES IN SCHEMA supporter_accounting_archive FROM PUBLIC;
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA supporter_accounting_archive FROM PUBLIC;
    END IF;
  END $$`,
  `
    CREATE TABLE IF NOT EXISTS supporter_server_sponsorships (
      sponsorship_id SERIAL PRIMARY KEY,
      server_id INTEGER NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
      server_disc_id TEXT NOT NULL,
      sponsor_identity_id INTEGER NOT NULL REFERENCES supporter_identities(supporter_identity_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_disc_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT supporter_server_sponsorships_status_check CHECK (
        status IN ('active', 'revoked', 'inactive_entitlement', 'exhausted', 'replaced')
      )
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supporter_server_sponsorships_one_active
    ON supporter_server_sponsorships(server_id)
    WHERE status = 'active'
  `,
  "CREATE INDEX IF NOT EXISTS idx_supporter_server_sponsorships_sponsor ON supporter_server_sponsorships(sponsor_identity_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_supporter_server_sponsorships_server_disc ON supporter_server_sponsorships(server_disc_id)",
  "DROP TRIGGER IF EXISTS update_supporter_server_sponsorships_timestamp ON supporter_server_sponsorships",
  `
    CREATE TRIGGER update_supporter_server_sponsorships_timestamp
    BEFORE UPDATE ON supporter_server_sponsorships
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp()
  `,
  `CREATE TABLE IF NOT EXISTS supporter_patreon_creator_tokens (
    creator_token_id SERIAL PRIMARY KEY,
    campaign_id TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    refresh_token BYTEA NOT NULL,
    refresh_token_key_version INTEGER NOT NULL CHECK (refresh_token_key_version > 0),
    access_token BYTEA,
    access_token_key_version INTEGER CHECK (access_token_key_version > 0),
    access_expires_at TIMESTAMPTZ,
    refresh_blocked_at TIMESTAMPTZ,
    refresh_retry_after TIMESTAMPTZ,
    CHECK ((access_token IS NULL) = (access_token_key_version IS NULL)),
    CHECK ((access_token IS NULL) = (access_expires_at IS NULL))
  )`,
  `CREATE TABLE IF NOT EXISTS supporter_member_keys (
    member_key_id SERIAL PRIMARY KEY,
    patreon_member_id TEXT NOT NULL UNIQUE,
    supporter_identity_id INTEGER UNIQUE REFERENCES supporter_identities(supporter_identity_id) ON DELETE SET NULL,
    key_hash TEXT UNIQUE,
    api_key BYTEA,
    key_version INTEGER CHECK (key_version > 0),
    disabled BOOLEAN NOT NULL DEFAULT true,
    applied_charge_at TIMESTAMPTZ,
    renewal_due_at TIMESTAMPTZ,
    applied_limit DOUBLE PRECISION CHECK (applied_limit >= 0 AND applied_limit < 'Infinity'::float8),
    key_created_at TIMESTAMPTZ,
    pending_action TEXT CHECK (pending_action IN ('create', 'activate', 'renew', 'disable', 'delete', 'rotate')),
    operation_id TEXT,
    target_limit DOUBLE PRECISION CHECK (target_limit >= 0 AND target_limit < 'Infinity'::float8),
    target_charge_at TIMESTAMPTZ,
    target_period_end TIMESTAMPTZ,
    retired_hash TEXT,
    CHECK ((api_key IS NULL) = (key_version IS NULL)),
    CHECK ((api_key IS NULL) = (key_hash IS NULL))
  )`,
  "ALTER TABLE supporter_member_keys ADD COLUMN IF NOT EXISTS applied_limit DOUBLE PRECISION CHECK (applied_limit >= 0 AND applied_limit < 'Infinity'::float8)",
  "ALTER TABLE supporter_member_keys ADD COLUMN IF NOT EXISTS key_created_at TIMESTAMPTZ",
  "ALTER TABLE supporter_member_keys ADD COLUMN IF NOT EXISTS retained_cost DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (retained_cost >= 0 AND retained_cost < 'Infinity'::float8)",
  "ALTER TABLE supporter_member_keys ADD COLUMN IF NOT EXISTS applied_allowance DOUBLE PRECISION",
  "ALTER TABLE supporter_member_keys ADD COLUMN IF NOT EXISTS target_allowance DOUBLE PRECISION",
  // Existing keys lack a creation timestamp, so count all retained statistics until their next rotation.
  `UPDATE supporter_member_keys SET key_created_at = 'epoch'
    WHERE key_hash IS NOT NULL AND key_created_at IS NULL`,
  `UPDATE supporter_member_keys SET applied_limit = target_limit
    WHERE key_hash IS NOT NULL AND applied_limit IS NULL
      AND (pending_action IS NULL OR pending_action IN ('rotate', 'disable'))`,
  `CREATE TABLE IF NOT EXISTS supporter_usage_statistics (
    usage_statistic_id BIGSERIAL PRIMARY KEY,
    supporter_identity_id INTEGER NOT NULL REFERENCES supporter_identities(supporter_identity_id) ON DELETE CASCADE,
    funding_scope TEXT NOT NULL CHECK (funding_scope IN ('personal', 'server')),
    server_id INTEGER REFERENCES servers(server_id) ON DELETE SET NULL,
    capability TEXT NOT NULL,
    model_codename TEXT NOT NULL,
    cost_usd DOUBLE PRECISION NOT NULL CHECK (cost_usd >= 0 AND cost_usd < 'Infinity'::float8),
    provider_request_id TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_supporter_usage_statistics_request
    ON supporter_usage_statistics(provider_request_id)
    WHERE provider_request_id IS NOT NULL`,
  "ALTER TABLE supporter_usage_statistics ADD COLUMN IF NOT EXISTS input_tokens BIGINT CHECK (input_tokens >= 0)",
  "ALTER TABLE supporter_usage_statistics ADD COLUMN IF NOT EXISTS output_tokens BIGINT CHECK (output_tokens >= 0)",
  "CREATE INDEX IF NOT EXISTS idx_supporter_usage_statistics_identity ON supporter_usage_statistics(supporter_identity_id, recorded_at)",
  `DO $$ BEGIN
    IF to_regclass('public.supporter_oauth_states') IS NOT NULL THEN
      INSERT INTO oauth_states (nonce_hash, flow, subject, expires_at, consumed_at, created_at)
      SELECT nonce_hash, 'patreon', discord_user_id, expires_at, consumed_at, created_at FROM supporter_oauth_states
      ON CONFLICT (nonce_hash) DO NOTHING;
      DROP TABLE supporter_oauth_states;
    END IF;
  END $$`,
  `
    CREATE TABLE IF NOT EXISTS supporter_webhook_events (
      webhook_event_id SERIAL PRIMARY KEY,
      patreon_event_id TEXT,
      event_type TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'received',
      error_message TEXT,
      idempotency_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      CONSTRAINT supporter_webhook_events_status_check CHECK (status IN ('received', 'processed', 'failed', 'ignored'))
    )
  `,
  "ALTER TABLE supporter_webhook_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT",
  `
    UPDATE supporter_webhook_events
    SET idempotency_key = COALESCE('event:' || patreon_event_id, 'payload:' || event_type || ':' || payload_hash)
    WHERE idempotency_key IS NULL
      OR (patreon_event_id IS NULL AND idempotency_key = 'payload:' || payload_hash)
  `,
  "ALTER TABLE supporter_webhook_events ALTER COLUMN idempotency_key SET NOT NULL",
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supporter_webhook_events_patreon_event_id
    ON supporter_webhook_events(patreon_event_id)
    WHERE patreon_event_id IS NOT NULL
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_supporter_webhook_events_idempotency_key
    ON supporter_webhook_events(idempotency_key)
  `,
  "CREATE INDEX IF NOT EXISTS idx_supporter_webhook_events_payload_hash ON supporter_webhook_events(payload_hash)",
  "CREATE INDEX IF NOT EXISTS idx_supporter_webhook_events_type_received ON supporter_webhook_events(event_type, received_at DESC)",
] as const;

export async function initializeSupporterBillingSchema(
  client: SQL = defaultSql,
): Promise<SupporterBillingSchemaInitializationResult> {
  for (const statement of SUPPORTER_BILLING_SCHEMA_STATEMENTS) {
    await client.unsafe(statement);
  }

  log.success("Supporter billing schema verified");

  return {
    initializedTables: SUPPORTER_BILLING_TABLE_NAMES,
  };
}

export async function checkSupporterBillingTablesExist(
  client: SQL = defaultSql,
): Promise<Record<SupporterBillingTableName, boolean>> {
  const existsEntries: Array<[SupporterBillingTableName, boolean]> = [];

  for (const tableName of SUPPORTER_BILLING_TABLE_NAMES) {
    const [row] = await client<Array<{ exists: boolean }>>`
      SELECT to_regclass(${`public.${tableName}`}) IS NOT NULL AS exists
    `;
    existsEntries.push([tableName, Boolean(row?.exists)]);
  }

  return Object.fromEntries(existsEntries) as Record<SupporterBillingTableName, boolean>;
}

export async function validateSupporterBillingSchema(
  client: SQL = defaultSql,
): Promise<SupporterBillingSchemaInitializationResult> {
  const presence = await checkSupporterBillingTablesExist(client);
  const missing = SUPPORTER_BILLING_TABLE_NAMES.filter((name) => !presence[name]);
  if (missing.length > 0) {
    throw new Error(`Supporter billing requires privileged schema initialization: ${missing.join(", ")}`);
  }

  const denied = await client<Array<{ table_name: string }>>`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${client.array([...SUPPORTER_BILLING_TABLE_NAMES, "oauth_states"], "TEXT")})
      AND (
        NOT has_table_privilege(c.oid, 'SELECT')
        OR NOT has_table_privilege(c.oid, 'INSERT')
        OR NOT has_table_privilege(c.oid, 'UPDATE')
        OR NOT has_table_privilege(c.oid, 'DELETE')
        OR NOT has_function_privilege('public.update_timestamp()', 'EXECUTE')
        OR EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL
            AND NOT has_sequence_privilege(
              pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname), 'USAGE'
            )
        )
      )
  `;
  if (denied.length > 0) {
    throw new Error(`Supporter billing requires runtime grants: ${denied.map((row) => row.table_name).join(", ")}`);
  }

  await client`
    SELECT e.last_successful_charge_at, e.next_charge_at, e.cancel_at_period_end,
      k.applied_limit, k.key_created_at, k.retained_cost, k.applied_allowance, k.target_allowance,
      u.input_tokens, u.output_tokens, w.idempotency_key
    FROM supporter_entitlements e, supporter_member_keys k,
      supporter_usage_statistics u, supporter_webhook_events w, oauth_states o
    LIMIT 0
  `;

  return { initializedTables: SUPPORTER_BILLING_TABLE_NAMES };
}
