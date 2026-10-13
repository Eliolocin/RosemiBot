import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ProxyIdentityUpsertInput } from "@/utils/messageProxy/types";
import { getCachedUserRow, invalidateUserCache } from "@/utils/cache/userCache";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

/**
 * One-time pronoun seed regression. A PluralKit member's public pronouns reach the synthetic
 * user's own `pronouns` setting on the attestation that first registers the identity, and no
 * later attestation touches that column again.
 */
const SEED_KEY = "0f1e2d3c-4b5a-4968-8778-99aabbccddee";
const EMPTY_KEY = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const EDIT_KEY = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const FAILED_KEY = "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f";

const SEED_NAMESPACE = "_rt_pronoun_seed_namespace";
const EMPTY_NAMESPACE = "_rt_pronoun_empty_namespace";
const EDIT_NAMESPACE = "_rt_pronoun_edit_namespace";
const FAILED_NAMESPACE = "_rt_pronoun_failed_namespace";

function identityInput(
  externalKey: string,
  namespaceKey: string,
  overrides: Partial<ProxyIdentityUpsertInput> = {},
): ProxyIdentityUpsertInput {
  return {
    serviceId: "pluralkit",
    externalIdentityKind: "pluralkit_member",
    externalKey,
    shortId: "Mirri",
    displayName: "Mirri",
    bio: "Keeps field notes.",
    namespace: {
      namespaceKey,
      shortId: "light",
      displayName: "Lighthouse",
      tag: "[LH]",
      description: "An archival collective.",
    },
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await testSql`
    DELETE FROM users
    WHERE user_disc_id IN (${`pk:${SEED_KEY}`}, ${`pk:${EMPTY_KEY}`}, ${`pk:${EDIT_KEY}`}, ${`pk:${FAILED_KEY}`})
  `;
  await testSql`
    DELETE FROM message_proxy_namespaces
    WHERE service_id = 'pluralkit'
      AND namespace_key IN (${SEED_NAMESPACE}, ${EMPTY_NAMESPACE}, ${EDIT_NAMESPACE}, ${FAILED_NAMESPACE})
  `;
}

describe.skipIf(!DB_TESTS_AVAILABLE)("message-proxy pronoun seed regression", () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(cleanup);

  it("seeds a new member's public pronouns into their identity profile and cached row", async () => {
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(SEED_KEY, SEED_NAMESPACE, { pronouns: "she/her" }),
      messageDiscId: "_rt_pronoun_message_seed",
      senderDiscId: "_rt_pronoun_host_seed",
    });

    expect(result?.isNewIdentity).toBe(true);
    // The prompt reads the cached row, so the seed is only visible once that cache is rebuilt.
    expect((await getCachedUserRow(`pk:${SEED_KEY}`))?.pronouns).toBe("she/her");
    expect((await userRepository.loadByDiscordId(`pk:${SEED_KEY}`))?.pronouns).toBe("she/her");
  });

  it("leaves pronouns unset for an absent, empty, or private value", async () => {
    const reportedValues = [undefined, "", "   ", null] as const;

    for (const [index, pronouns] of reportedValues.entries()) {
      const userDiscId = `pk:${EMPTY_KEY}`;
      await messageProxyRepository.persistAttestedIdentity({
        input: identityInput(EMPTY_KEY, EMPTY_NAMESPACE, { pronouns }),
        messageDiscId: `_rt_pronoun_message_empty_${index}`,
        senderDiscId: "_rt_pronoun_host_empty",
      });

      expect((await getCachedUserRow(userDiscId))?.pronouns).toBeNull();
      await testSql`DELETE FROM users WHERE user_disc_id = ${userDiscId}`;
    }
  });

  it("keeps a locally edited value across later attestations that report different pronouns", async () => {
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(EDIT_KEY, EDIT_NAMESPACE, { pronouns: "she/her" }),
      messageDiscId: "_rt_pronoun_message_edit_1",
      senderDiscId: "_rt_pronoun_host_edit",
    });
    const userDiscId = `pk:${EDIT_KEY}`;
    const user = await userRepository.loadByDiscordId(userDiscId);
    if (!user?.user_id) throw new Error("Synthetic user was not registered");

    // The host edit path behind `/personal config identity:` owns every change after the seed.
    await userNamingRepository.applyUserInfoBatch(user.user_id, { global: { pronouns: "they/them" } });
    invalidateUserCache(userDiscId);

    const repeat = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(EDIT_KEY, EDIT_NAMESPACE, { pronouns: "she/her" }),
      messageDiscId: "_rt_pronoun_message_edit_2",
      senderDiscId: "_rt_pronoun_host_edit",
    });

    expect(repeat?.isNewIdentity).toBe(false);
    expect((await getCachedUserRow(userDiscId))?.pronouns).toBe("they/them");
    // Clearing the local value also sticks: a service value must never come back.
    await userNamingRepository.applyUserInfoBatch(user.user_id, { global: { pronouns: null } });
    invalidateUserCache(userDiscId);
    await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(EDIT_KEY, EDIT_NAMESPACE, { pronouns: "she/her" }),
      messageDiscId: "_rt_pronoun_message_edit_3",
      senderDiscId: "_rt_pronoun_host_edit",
    });

    expect((await getCachedUserRow(userDiscId))?.pronouns).toBeNull();
  });

  it("writes no pronoun seed when the first identity transaction fails", async () => {
    const result = await messageProxyRepository.persistAttestedIdentity({
      input: identityInput(FAILED_KEY, FAILED_NAMESPACE, { pronouns: "she/her" }),
      messageDiscId: "_rt_pronoun_message_failed",
      senderDiscId: null as unknown as string,
    });

    expect(result).toBeNull();
    const [counts] = await testSql`
      SELECT
        (SELECT COUNT(*)::INT FROM users WHERE user_disc_id = ${`pk:${FAILED_KEY}`}) AS users,
        (SELECT COUNT(*)::INT FROM user_personalization_configs upc
          JOIN users u ON u.user_id = upc.user_id
          WHERE u.user_disc_id = ${`pk:${FAILED_KEY}`}) AS personalizations
    `;
    expect(counts).toMatchObject({ users: 0, personalizations: 0 });
  });
});
