import { afterAll, afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { runMigrations } from "@/db/migrationRunner";
import { decryptApiKey, encryptApiKey } from "@/utils/security/crypto";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { log } from "@/utils/misc/logger";
import { createScopedModuleMocker } from "../../helpers/mockSurface";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const request = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  Response.json({ access_token: "access-one", refresh_token: "refresh-two", token_type: "Bearer", expires_in: 3600 }),
);
const scopedMock = createScopedModuleMocker(mock, { "@/utils/security/userRemoteFetch": realRemoteFetch });
scopedMock.module("@/utils/security/userRemoteFetch", () => ({
  ...realRemoteFetch,
  fetchUserRemoteUrl: request,
}));

const { clearPluralBuddyOAuthTokenStateForTests, getPluralBuddyAccessToken } = await import(
  "@/utils/messageProxy/services/pluralbuddy/oauthTokens"
);
const { clearPluralBuddyApiStateForTests, fetchPluralBuddyMessage, PluralBuddyLookupUnavailableError } = await import(
  "@/utils/messageProxy/services/pluralbuddy/api"
);

const official: MessageProxyInstanceContext = {
  serviceId: "pluralbuddy",
  instanceId: "pluralbuddy:official",
  origin: "https://pluralbuddy.app",
};
const custom: MessageProxyInstanceContext = {
  serviceId: "pluralbuddy",
  instanceId: "pluralbuddy:11111111-2222-4333-8444-555555555555",
  origin: "https://other.example",
};

async function storeConnection(
  instance: MessageProxyInstanceContext,
  secret: string,
  refreshToken: string,
): Promise<void> {
  const encryptedSecret = await encryptApiKey(secret);
  const encryptedRefresh = await encryptApiKey(refreshToken);
  await testSql`
    INSERT INTO pluralbuddy_oauth_connections (
      instance_id, origin, client_id, client_secret, client_secret_key_version,
      refresh_token, refresh_token_key_version
    ) VALUES (
      ${instance.instanceId}, ${instance.origin}, ${`client-${instance.instanceId}`},
      ${encryptedSecret.encrypted}, ${encryptedSecret.version},
      ${encryptedRefresh.encrypted}, ${encryptedRefresh.version}
    )
  `;
}

async function cleanup(): Promise<void> {
  await testSql`DELETE FROM pluralbuddy_oauth_connections WHERE instance_id IN (${official.instanceId}, ${custom.instanceId})`;
  await testSql`DELETE FROM message_proxy_instances WHERE instance_id = ${custom.instanceId}`;
  clearPluralBuddyOAuthTokenStateForTests();
  clearPluralBuddyApiStateForTests();
  request.mockClear();
  request.mockImplementation(async () =>
    Response.json({ access_token: "access-one", refresh_token: "refresh-two", token_type: "Bearer", expires_in: 3600 }),
  );
}

describe.skipIf(!DB_TESTS_AVAILABLE)("PluralBuddy OAuth refresh persistence", () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });
  afterEach(cleanup);
  afterAll(cleanup);

  it("applies pending instance and OAuth migrations after the current schema snapshot", async () => {
    await storeConnection(official, "secret-one", "refresh-one");
    await testSql`
      DELETE FROM schema_migrations
      WHERE name IN (
        '088_message_proxy_instances',
        '089_pluralbuddy_oauth_connections',
        '090_pluralbuddy_refresh_state',
        '091_message_proxy_instance_removal',
        '092_message_proxy_instance_bot_user_id'
      )
    `;

    await runMigrations(testSql);

    const markers = await testSql<{ name: string }[]>`
      SELECT name FROM schema_migrations
      WHERE name IN (
        '088_message_proxy_instances',
        '089_pluralbuddy_oauth_connections',
        '090_pluralbuddy_refresh_state',
        '091_message_proxy_instance_removal',
        '092_message_proxy_instance_bot_user_id'
      )
    `;
    expect(markers.map(({ name }) => name).sort()).toEqual([
      "088_message_proxy_instances",
      "089_pluralbuddy_oauth_connections",
      "090_pluralbuddy_refresh_state",
      "091_message_proxy_instance_removal",
      "092_message_proxy_instance_bot_user_id",
    ]);
    const [connection] = await testSql<{ refresh_token: Buffer; refresh_token_key_version: number }[]>`
      SELECT refresh_token, refresh_token_key_version
      FROM pluralbuddy_oauth_connections WHERE instance_id = ${official.instanceId}
    `;
    expect(connection && (await decryptApiKey(connection.refresh_token, connection.refresh_token_key_version))).toBe(
      "refresh-one",
    );
  });

  it("does not contact the provider without a bot host connection", async () => {
    expect(await getPluralBuddyAccessToken(official)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("stores a rotated refresh token before serving access and reads it after restart", async () => {
    await storeConnection(official, "secret-one", "refresh-one");
    request.mockImplementationOnce(async (input, init) => {
      expect(String(input)).toBe(`${official.origin}/api/auth/oauth2/token`);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Basic ${btoa(`client-${official.instanceId}:secret-one`)}`,
      );
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("refresh-one");
      expect(body.get("resource")).toBe(official.origin);
      return Response.json({
        access_token: "access-one",
        refresh_token: "refresh-two",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    expect(await getPluralBuddyAccessToken(official)).toBe("access-one");
    const [stored] = await testSql<{ refresh_token: Buffer; refresh_token_key_version: number }[]>`
      SELECT refresh_token, refresh_token_key_version
      FROM pluralbuddy_oauth_connections WHERE instance_id = ${official.instanceId}
    `;
    expect(stored && (await decryptApiKey(stored.refresh_token, stored.refresh_token_key_version))).toBe("refresh-two");

    clearPluralBuddyOAuthTokenStateForTests();
    expect(await getPluralBuddyAccessToken(official)).toBe("access-one");
    expect(request).toHaveBeenCalledTimes(1);
    await testSql`
      UPDATE pluralbuddy_oauth_connections
      SET access_expires_at = ${new Date(Date.now() - 1000)}
      WHERE instance_id = ${official.instanceId}
    `;
    clearPluralBuddyOAuthTokenStateForTests();
    request.mockImplementationOnce(async (_input, init) => {
      expect(new URLSearchParams(String(init?.body)).get("refresh_token")).toBe("refresh-two");
      return Response.json({
        access_token: "access-two",
        refresh_token: "refresh-three",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    expect(await getPluralBuddyAccessToken(official)).toBe("access-two");
  });

  it("coalesces concurrent refreshes and keeps each instance on its own origin", async () => {
    await storeConnection(official, "secret-one", "refresh-one");
    await testSql`
      INSERT INTO message_proxy_instances (instance_id, service_id, origin, display_name, enabled)
      VALUES (${custom.instanceId}, 'pluralbuddy', ${custom.origin}, 'Other', true)
    `;
    await storeConnection(custom, "secret-other", "refresh-other");
    request.mockImplementation(async (input, init) => {
      const origin = new URL(String(input)).origin;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("resource")).toBe(origin);
      expect(body.get("refresh_token")).toBe(origin === official.origin ? "refresh-one" : "refresh-other");
      return Response.json({ access_token: origin, refresh_token: "next", token_type: "Bearer", expires_in: 3600 });
    });
    const [first, second, other] = await Promise.all([
      getPluralBuddyAccessToken(official),
      getPluralBuddyAccessToken(official),
      getPluralBuddyAccessToken(custom),
    ]);
    expect([first, second, other]).toEqual([official.origin, official.origin, custom.origin]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(await getPluralBuddyAccessToken({ ...official, origin: custom.origin })).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("blocks revoked credentials and pauses after a rate limit", async () => {
    await storeConnection(official, "secret-one", "refresh-one");
    request.mockImplementationOnce(async () => new Response(null, { status: 401 }));
    expect(await getPluralBuddyAccessToken(official)).toBeNull();
    expect(await getPluralBuddyAccessToken(official)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    const [blocked] = await testSql<{ refresh_blocked_at: Date | null }[]>`
      SELECT refresh_blocked_at FROM pluralbuddy_oauth_connections WHERE instance_id = ${official.instanceId}
    `;
    expect(blocked?.refresh_blocked_at).not.toBeNull();

    await testSql`
      UPDATE pluralbuddy_oauth_connections SET refresh_blocked_at = NULL WHERE instance_id = ${official.instanceId}
    `;
    request.mockImplementationOnce(async () => new Response(null, { status: 429 }));
    expect(await getPluralBuddyAccessToken(official)).toBeNull();
    expect(await getPluralBuddyAccessToken(official)).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("treats a self-issued token rejected by the message API as unusable", async () => {
    await storeConnection(official, "secret-one", "refresh-one");
    const messageId = "123456789012345678";
    request.mockImplementation(async (input) => {
      if (String(input).endsWith("/oauth2/token")) {
        return Response.json({
          access_token: "unusable-access",
          refresh_token: "refresh-two",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      expect(String(input)).toBe(`${official.origin}/api/v1/messages/${messageId}`);
      return new Response(null, { status: 401 });
    });

    const warning = spyOn(log, "warn").mockImplementation(() => {});

    try {
      await expect(fetchPluralBuddyMessage(official, messageId)).rejects.toThrow(PluralBuddyLookupUnavailableError);
      expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
    }
    const [connection] = await testSql<{ refresh_blocked_at: Date | null }[]>`
      SELECT refresh_blocked_at FROM pluralbuddy_oauth_connections WHERE instance_id = ${official.instanceId}
    `;
    expect(connection?.refresh_blocked_at).not.toBeNull();
  });

  it("backs off after a refresh timeout without logging credentials", async () => {
    await storeConnection(official, "sensitive-client-secret", "sensitive-refresh-token");
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    request.mockImplementationOnce(async () => {
      throw new DOMException("sensitive-refresh-token", "TimeoutError");
    });

    try {
      expect(await getPluralBuddyAccessToken(official)).toBeNull();
      expect(await getPluralBuddyAccessToken(official)).toBeNull();
      expect(request).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive-refresh-token");
      expect(JSON.stringify(warning.mock.calls)).not.toContain("sensitive-client-secret");
    } finally {
      warning.mockRestore();
    }
  });
});
