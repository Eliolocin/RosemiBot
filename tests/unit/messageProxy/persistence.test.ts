import { afterEach, describe, expect, it, mock } from "bun:test";
import type { UserRow } from "@/types/db/schema";
import {
  persistMessageProxyAttestationIdentity,
  type MessageProxyIdentityPersistenceDependencies,
} from "@/utils/messageProxy/persistence";
import {
  clearNegativeMessageProxyMessageIdentityCacheForTests,
  hasNegativeMessageProxyMessageIdentity,
  rememberNegativeMessageProxyMessageIdentity,
} from "@/utils/messageProxy/messageIdentityNegativeCache";
import type {
  ProxyIdentityUpsertInput,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
  ProxyServicePresentation,
} from "@/utils/messageProxy/types";
import type { MessageProxyIdentityUpsertResult } from "@/utils/db/repositories/MessageProxyRepository";

const presentation: ProxyServicePresentation = {
  identityMembershipLine: () => "- Linked identity",
  namespacePresentation: () => ({
    sectionHeading: "Linked accounts:",
    entry: "- Linked account",
  }),
};

function descriptor(identityBio: "inline" | "none"): ProxyServiceDescriptor<string> {
  return {
    serviceId: "fixture",
    settingsLocaleKey: "fixture_option",
    enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.fixture_enabled_success_description",
    syntheticUserPrefix: "fx:",
    externalIdentityKind: "fixture_profile",
    validateExternalKey: (key) => /^profile-[a-z0-9]+$/.test(key),
    capabilities: {
      correlation: "attested",
      identity: "stable",
      identityBio,
      namespaceBio: "none",
    },
    presentation,
    attestMessage: async () => null,
  };
}

const identityInput: ProxyIdentityUpsertInput = {
  serviceId: "fixture",
  externalIdentityKind: "fixture_profile",
  externalKey: "profile-one",
  shortId: null,
  displayName: "Mirri",
  bio: "Public profile.",
  pronouns: "she/her",
  namespace: {
    namespaceKey: "account-one",
    shortId: null,
    displayName: "Lighthouse",
    tag: null,
    description: null,
  },
};

function attestation(identity: ProxyIdentityUpsertInput | null): ProxyMessageAttestation {
  return {
    serviceId: "fixture",
    instanceId: "fixture:official",
    proxyMessageId: "proxy-1",
    originalMessageId: "original-1",
    senderDiscordId: "sender-1",
    identity,
  };
}

function persistedIdentity(): MessageProxyIdentityUpsertResult {
  return {
    userRow: {
      user_id: 41,
      user_disc_id: "fx:profile-one",
      user_nickname: "Mirri",
    } as UserRow,
    namespace: {
      message_proxy_namespace_id: 51,
      service_id: "fixture",
      instance_id: "fixture:official",
      namespace_key: "account-one",
    },
    identity: {
      message_proxy_identity_id: 61,
      message_proxy_namespace_id: 51,
      external_identity_id: 71,
    },
    isNewIdentity: true,
  };
}

function dependencies(identityBio: "inline" | "none" = "inline") {
  const persistIdentity = mock(async (): Promise<MessageProxyIdentityUpsertResult | null> => persistedIdentity());
  const seedIdentityBio = mock(async () => {});
  const value: MessageProxyIdentityPersistenceDependencies = {
    getDescriptor: () => descriptor(identityBio),
    persistIdentity,
    seedIdentityBio,
  };
  return { value, persistIdentity, seedIdentityBio };
}

afterEach(clearNegativeMessageProxyMessageIdentityCacheForTests);

describe("message-proxy identity persistence orchestration", () => {
  it("performs no identity or bio write for an identity-free attestation", async () => {
    const deps = dependencies();

    expect(
      await persistMessageProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(null), serverDiscId: "guild-1" },
        deps.value,
      ),
    ).toBe("identity_free");
    expect(deps.persistIdentity).not.toHaveBeenCalled();
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
  });

  it("persists stable identity and starts inline bio seeding", async () => {
    const deps = dependencies("inline");
    rememberNegativeMessageProxyMessageIdentity("proxy-1");

    expect(
      await persistMessageProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: "guild-1" },
        deps.value,
      ),
    ).toBe("persisted");
    expect(deps.persistIdentity).toHaveBeenCalledWith({
      input: identityInput,
      messageDiscId: "proxy-1",
      senderDiscId: "sender-1",
    });
    expect(deps.seedIdentityBio).toHaveBeenCalledTimes(1);
    expect(hasNegativeMessageProxyMessageIdentity("proxy-1")).toBe(false);
  });

  it("does not seed a bio when the stable service disables that capability", async () => {
    const deps = dependencies("none");

    expect(
      await persistMessageProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: null },
        deps.value,
      ),
    ).toBe("persisted");
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
  });

  it("does not seed or report success when the canonical transaction fails", async () => {
    const deps = dependencies();
    deps.persistIdentity.mockImplementation(async () => null);
    rememberNegativeMessageProxyMessageIdentity("proxy-1");

    expect(
      await persistMessageProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: null },
        deps.value,
      ),
    ).toBe("persistence_failed");
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
    expect(hasNegativeMessageProxyMessageIdentity("proxy-1")).toBe(true);
  });

  it("passes service pronouns through on the one write that can seed them", async () => {
    const deps = dependencies();

    await persistMessageProxyAttestationIdentity(
      { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: null },
      deps.value,
    );

    // The seed decision belongs to the identity transaction, which alone knows whether this
    // attestation created the identity. This layer must not drop or rewrite the value.
    expect(deps.persistIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ pronouns: "she/her" }) }),
    );
  });
});
