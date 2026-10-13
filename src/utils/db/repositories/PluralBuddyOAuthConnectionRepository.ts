import type { SQL } from "bun";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

type PluralBuddyOAuthConnectionRow = {
  client_id: string;
  client_secret: Buffer;
  client_secret_key_version: number;
  refresh_token: Buffer;
  refresh_token_key_version: number;
  access_token: Buffer | null;
  access_token_key_version: number | null;
  access_expires_at: Date | null;
  refresh_blocked_at: Date | null;
  refresh_retry_after: Date | null;
};

type RejectedTokenRow = { access_token: Buffer | null; access_token_key_version: number | null };

class PluralBuddyOAuthConnectionRepository {
  async loadForRefresh(tx: SQL, instance: MessageProxyInstanceContext): Promise<PluralBuddyOAuthConnectionRow | null> {
    const [connection] = await tx<PluralBuddyOAuthConnectionRow[]>`
      SELECT connection.client_id, connection.client_secret, connection.client_secret_key_version,
        connection.refresh_token, connection.refresh_token_key_version,
        connection.access_token, connection.access_token_key_version, connection.access_expires_at,
        connection.refresh_blocked_at, connection.refresh_retry_after
      FROM pluralbuddy_oauth_connections AS connection
      JOIN message_proxy_instances AS instance ON instance.instance_id = connection.instance_id
      WHERE connection.instance_id = ${instance.instanceId}
        AND connection.origin = ${instance.origin}
        AND instance.origin = ${instance.origin}
        AND instance.service_id = 'pluralbuddy'
        AND instance.removed_at IS NULL
      FOR UPDATE OF connection
    `;
    return connection ?? null;
  }

  async decryptAccessToken(tx: SQL, encrypted: Buffer, key: string): Promise<string | null> {
    const [stored] = await tx<{ access_token: string }[]>`
      SELECT pgp_sym_decrypt(${encrypted}, ${key}) AS access_token
    `;
    return stored?.access_token ?? null;
  }

  async decryptCredentials(
    tx: SQL,
    connection: PluralBuddyOAuthConnectionRow,
    clientSecretKey: string,
    refreshTokenKey: string,
  ): Promise<{ client_secret: string; refresh_token: string } | null> {
    const [decrypted] = await tx<{ client_secret: string; refresh_token: string }[]>`
      SELECT pgp_sym_decrypt(${connection.client_secret}, ${clientSecretKey}) AS client_secret,
        pgp_sym_decrypt(${connection.refresh_token}, ${refreshTokenKey}) AS refresh_token
    `;
    return decrypted ?? null;
  }

  async rotateClientSecret(
    tx: SQL,
    instanceId: string,
    clientSecret: string,
    key: string,
    version: number,
  ): Promise<void> {
    await tx`
      UPDATE pluralbuddy_oauth_connections
      SET client_secret = pgp_sym_encrypt(${clientSecret}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        client_secret_key_version = ${version}
      WHERE instance_id = ${instanceId}
    `;
  }

  async setRefreshState(tx: SQL, instanceId: string, blockedAt: Date | null, retryAfter: Date | null): Promise<void> {
    await tx`
      UPDATE pluralbuddy_oauth_connections
      SET refresh_blocked_at = ${blockedAt}, refresh_retry_after = ${retryAfter}
      WHERE instance_id = ${instanceId}
    `;
  }

  async setRefreshRetryAfter(tx: SQL, instanceId: string, retryAfter: Date): Promise<void> {
    await tx`
      UPDATE pluralbuddy_oauth_connections
      SET refresh_retry_after = ${retryAfter}
      WHERE instance_id = ${instanceId}
    `;
  }

  async storeRefreshedTokens(
    tx: SQL,
    instanceId: string,
    refreshToken: string,
    accessToken: string,
    key: string,
    version: number,
    expiresAt: Date,
  ): Promise<void> {
    await tx`
      UPDATE pluralbuddy_oauth_connections
      SET refresh_token = pgp_sym_encrypt(${refreshToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        refresh_token_key_version = ${version},
        access_token = pgp_sym_encrypt(${accessToken}, ${key}, 'compress-algo=1, cipher-algo=aes256'),
        access_token_key_version = ${version},
        access_expires_at = ${expiresAt},
        refresh_retry_after = NULL
      WHERE instance_id = ${instanceId}
    `;
  }

  async loadForTokenRejection(tx: SQL, instance: MessageProxyInstanceContext): Promise<RejectedTokenRow | null> {
    const [connection] = await tx<RejectedTokenRow[]>`
      SELECT access_token, access_token_key_version
      FROM pluralbuddy_oauth_connections
      WHERE instance_id = ${instance.instanceId} AND origin = ${instance.origin}
        AND refresh_blocked_at IS NULL
      FOR UPDATE
    `;
    return connection ?? null;
  }

  async blockRejectedToken(tx: SQL, instance: MessageProxyInstanceContext): Promise<void> {
    await tx`
      UPDATE pluralbuddy_oauth_connections
      SET refresh_blocked_at = NOW(), access_token = NULL,
        access_token_key_version = NULL, access_expires_at = NULL
      WHERE instance_id = ${instance.instanceId} AND origin = ${instance.origin}
    `;
  }
}

export const pluralBuddyOAuthConnectionRepository = new PluralBuddyOAuthConnectionRepository();
