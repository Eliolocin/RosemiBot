import { z } from "zod";
import { sql } from "@/utils/db/client";
import { pluralBuddyOAuthConnectionRepository } from "@/utils/db/repositories/PluralBuddyOAuthConnectionRepository";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { log } from "@/utils/misc/logger";
import { keyManager } from "@/utils/security/keyManager";
import { fetchUserRemoteUrl, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";
import { readBoundedMessageProxyResponse } from "@/utils/messageProxy/boundedResponse";

const REFRESH_TIMEOUT_MS = 10_000;
const TRANSIENT_RETRY_MS = 30_000;
const RATE_LIMIT_RETRY_MS = 60_000;
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.literal("bearer")),
  expires_in: z.number().finite().positive(),
});

type AccessToken = { value: string; refreshAt: number };
const tokens = new Map<string, { origin: string; token: AccessToken }>();
const pending = new Map<string, { origin: string; promise: Promise<string | null> }>();

function validInstance(instance: MessageProxyInstanceContext): boolean {
  return instance.serviceId === "pluralbuddy" && canonicalMessageProxyOrigin(instance.origin) === instance.origin;
}

async function refresh(instance: MessageProxyInstanceContext): Promise<string | null> {
  try {
    const renewed = await sql.begin(async (tx) => {
      // The row lock covers the provider exchange and the encrypted write, so another
      // process reads the replacement refresh token only after this transaction commits.
      const connection = await pluralBuddyOAuthConnectionRepository.loadForRefresh(tx, instance);
      if (!connection || connection.refresh_blocked_at) return null;
      const accessExpiresAt = connection.access_expires_at && new Date(connection.access_expires_at).getTime();
      if (
        connection.access_token &&
        connection.access_token_key_version !== null &&
        accessExpiresAt &&
        accessExpiresAt > Date.now() + 30_000
      ) {
        const key = keyManager.getKey(connection.access_token_key_version);
        const storedToken = await pluralBuddyOAuthConnectionRepository.decryptAccessToken(
          tx,
          connection.access_token,
          key,
        );
        if (storedToken) return { value: storedToken, expiresAt: accessExpiresAt };
      }
      if (connection.refresh_retry_after && new Date(connection.refresh_retry_after).getTime() > Date.now())
        return null;

      const clientSecretKey = keyManager.getKey(connection.client_secret_key_version);
      const refreshTokenKey = keyManager.getKey(connection.refresh_token_key_version);
      const decrypted = await pluralBuddyOAuthConnectionRepository.decryptCredentials(
        tx,
        connection,
        clientSecretKey,
        refreshTokenKey,
      );
      if (!decrypted?.client_secret || !decrypted.refresh_token) return null;
      const currentKey = keyManager.getCurrentKey();
      const currentVersion = keyManager.getCurrentVersion();
      if (connection.client_secret_key_version !== currentVersion) {
        await pluralBuddyOAuthConnectionRepository.rotateClientSecret(
          tx,
          instance.instanceId,
          decrypted.client_secret,
          currentKey,
          currentVersion,
        );
      }

      let response: Response;
      try {
        const credentials = Buffer.from(`${connection.client_id}:${decrypted.client_secret}`, "utf8").toString(
          "base64",
        );
        response = await fetchUserRemoteUrl(
          `${instance.origin}/api/auth/oauth2/token`,
          {
            method: "POST",
            redirect: "manual",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: decrypted.refresh_token,
              resource: instance.origin,
            }),
            signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
          },
          { strict: true },
        );
      } catch (error) {
        log.warn("PluralBuddy refresh request failed", undefined, {
          metadata: {
            instanceId: instance.instanceId,
            errorClass: error instanceof RemoteUrlPolicyError ? "url_policy" : "network",
          },
        });
        await pluralBuddyOAuthConnectionRepository.setRefreshRetryAfter(
          tx,
          instance.instanceId,
          new Date(Date.now() + TRANSIENT_RETRY_MS),
        );
        return null;
      }

      if (!response.ok) {
        const revoked = response.status === 400 || response.status === 401;
        log.warn("PluralBuddy refresh was rejected", undefined, {
          metadata: {
            instanceId: instance.instanceId,
            status: response.status,
            errorClass:
              response.status === 400
                ? "credentials_or_resource"
                : response.status === 401
                  ? "credentials"
                  : response.status === 429
                    ? "rate_limit"
                    : "provider",
          },
        });
        await pluralBuddyOAuthConnectionRepository.setRefreshState(
          tx,
          instance.instanceId,
          revoked ? new Date() : null,
          revoked ? null : new Date(Date.now() + (response.status === 429 ? RATE_LIMIT_RETRY_MS : TRANSIENT_RETRY_MS)),
        );
        return null;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(await readBoundedMessageProxyResponse(response));
      } catch {
        raw = null;
      }
      const parsed = tokenSchema.safeParse(raw);
      if (!parsed.success) {
        log.warn("PluralBuddy refresh returned an invalid token response", undefined, {
          metadata: {
            instanceId: instance.instanceId,
            errorClass: "invalid_response",
          },
        });
        await pluralBuddyOAuthConnectionRepository.setRefreshRetryAfter(
          tx,
          instance.instanceId,
          new Date(Date.now() + TRANSIENT_RETRY_MS),
        );
        return null;
      }

      const expiresAt = new Date(Date.now() + parsed.data.expires_in * 1000);
      await pluralBuddyOAuthConnectionRepository.storeRefreshedTokens(
        tx,
        instance.instanceId,
        parsed.data.refresh_token ?? decrypted.refresh_token,
        parsed.data.access_token,
        currentKey,
        currentVersion,
        expiresAt,
      );
      return { value: parsed.data.access_token, expiresAt: expiresAt.getTime() };
    });
    if (!renewed) return null;
    const token = {
      value: renewed.value,
      refreshAt: renewed.expiresAt - Math.min(30_000, (renewed.expiresAt - Date.now()) / 2),
    };
    tokens.set(instance.instanceId, { origin: instance.origin, token });
    return token.value;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    log.warn("PluralBuddy refresh storage failed", undefined, {
      metadata: {
        instanceId: instance.instanceId,
        errorClass: "storage",
        exceptionClass: error instanceof Error ? error.name : "unknown",
        sqlState: typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : undefined,
      },
    });
    return null;
  }
}

export async function getPluralBuddyAccessToken(instance: MessageProxyInstanceContext): Promise<string | null> {
  if (!validInstance(instance)) return null;
  const cached = tokens.get(instance.instanceId);
  if (cached?.origin === instance.origin && cached.token.refreshAt > Date.now()) return cached.token.value;
  const inFlight = pending.get(instance.instanceId);
  if (inFlight) return inFlight.origin === instance.origin ? inFlight.promise : null;
  const renewal = refresh(instance).finally(() => pending.delete(instance.instanceId));
  pending.set(instance.instanceId, { origin: instance.origin, promise: renewal });
  return renewal;
}

export function clearPluralBuddyAccessToken(instance: MessageProxyInstanceContext, rejectedToken: string): void {
  const cached = tokens.get(instance.instanceId);
  if (cached?.origin === instance.origin && cached.token.value === rejectedToken) tokens.delete(instance.instanceId);
}

export async function rejectPluralBuddyAccessToken(
  instance: MessageProxyInstanceContext,
  rejectedToken: string,
): Promise<void> {
  clearPluralBuddyAccessToken(instance, rejectedToken);
  try {
    await sql.begin(async (tx) => {
      const connection = await pluralBuddyOAuthConnectionRepository.loadForTokenRejection(tx, instance);
      if (!connection?.access_token || connection.access_token_key_version === null) return;
      const key = keyManager.getKey(connection.access_token_key_version);
      const storedToken = await pluralBuddyOAuthConnectionRepository.decryptAccessToken(
        tx,
        connection.access_token,
        key,
      );
      if (storedToken !== rejectedToken) return;
      await pluralBuddyOAuthConnectionRepository.blockRejectedToken(tx, instance);
    });
  } catch {
    log.warn("PluralBuddy rejected token could not be blocked", undefined, {
      metadata: { instanceId: instance.instanceId, errorClass: "storage" },
    });
  }
}

export function clearPluralBuddyOAuthTokenStateForTests(): void {
  tokens.clear();
  pending.clear();
}
