import { sql } from "@/utils/db/client";
import { pluralBuddyOAuthConnectionRepository as repository } from "@/utils/db/repositories/PluralBuddyOAuthConnectionRepository";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { log } from "@/utils/misc/logger";
import { keyManager } from "@/utils/security/keyManager";
import { OAuthRefreshCoordinator, type OAuthTokenStore } from "@/utils/oauth/refreshCoordinator";

const coordinator = new OAuthRefreshCoordinator();
const tokenKey = (instance: MessageProxyInstanceContext): string => `${instance.instanceId}:${instance.origin}`;

function tokenStore(instance: MessageProxyInstanceContext): OAuthTokenStore {
  return {
    withLock: (operation) =>
      sql.begin(async (tx) =>
        operation({
          load: async () => {
            const connection = await repository.loadForRefresh(tx, instance);
            if (!connection || connection.refresh_blocked_at) return null;
            const decrypted = await repository.decryptCredentials(
              tx,
              connection,
              keyManager.getKey(connection.client_secret_key_version),
              keyManager.getKey(connection.refresh_token_key_version),
            );
            if (!decrypted) return null;
            if (connection.client_secret_key_version !== keyManager.getCurrentVersion()) {
              await repository.rotateClientSecret(
                tx,
                instance.instanceId,
                decrypted.client_secret,
                keyManager.getCurrentKey(),
                keyManager.getCurrentVersion(),
              );
            }
            const accessToken =
              connection.access_token && connection.access_token_key_version !== null
                ? await repository.decryptAccessToken(
                    tx,
                    connection.access_token,
                    keyManager.getKey(connection.access_token_key_version),
                  )
                : null;
            return {
              accessToken,
              expiresAt: connection.access_expires_at ? new Date(connection.access_expires_at).getTime() : null,
              refreshToken: decrypted.refresh_token,
              blocked: false,
              retryAt: connection.refresh_retry_after ? new Date(connection.refresh_retry_after).getTime() : null,
              authentication: {
                method: "basic",
                clientId: connection.client_id,
                clientSecret: decrypted.client_secret,
              },
            };
          },
          persist: async (token, refreshToken, expiresAt) =>
            repository.storeRefreshedTokens(
              tx,
              instance.instanceId,
              refreshToken,
              token.access_token,
              keyManager.getCurrentKey(),
              keyManager.getCurrentVersion(),
              expiresAt,
            ),
          fail: async (error) =>
            repository.setRefreshState(
              tx,
              instance.instanceId,
              error.disposition === "blocked" ? new Date() : null,
              error.disposition === "retry" ? error.retryAt : null,
            ),
        }),
      ),
  };
}

export async function getPluralBuddyAccessToken(instance: MessageProxyInstanceContext): Promise<string | null> {
  if (instance.serviceId !== "pluralbuddy" || canonicalMessageProxyOrigin(instance.origin) !== instance.origin)
    return null;
  return coordinator.getAccessToken({
    key: tokenKey(instance),
    store: tokenStore(instance),
    endpoint: `${instance.origin}/api/auth/oauth2/token`,
    allowedOrigins: [instance.origin],
    parameters: new URLSearchParams({ resource: instance.origin }),
    onFailure: (reason, disposition, diagnostics) =>
      log.warn("PluralBuddy OAuth refresh failed", undefined, {
        metadata: { instanceId: instance.instanceId, errorClass: reason, disposition, ...diagnostics },
      }),
  });
}

export function clearPluralBuddyAccessToken(instance: MessageProxyInstanceContext, rejectedToken: string): void {
  coordinator.invalidate(tokenKey(instance), rejectedToken);
}

export async function rejectPluralBuddyAccessToken(
  instance: MessageProxyInstanceContext,
  rejectedToken: string,
): Promise<void> {
  clearPluralBuddyAccessToken(instance, rejectedToken);
  try {
    await sql.begin(async (tx) => {
      const connection = await repository.loadForTokenRejection(tx, instance);
      if (!connection?.access_token || connection.access_token_key_version === null) return;
      const key = keyManager.getKey(connection.access_token_key_version);
      const storedToken = await repository.decryptAccessToken(tx, connection.access_token, key);
      if (storedToken !== rejectedToken) return;
      await repository.blockRejectedToken(tx, instance);
    });
  } catch {
    log.warn("PluralBuddy rejected token could not be blocked", undefined, {
      metadata: { instanceId: instance.instanceId, errorClass: "storage" },
    });
  }
}

export function clearPluralBuddyOAuthTokenStateForTests(): void {
  coordinator.clear();
}
