import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { getMessageProxyHostProtection } from "@/utils/messageProxy/hostProtection";
import { seedMessageProxyIdentityBio } from "@/utils/messageProxy/bioSeeding";
import type { MessageProxyIdentityContext } from "@/utils/messageProxy/types";

const identityId = "pk:11111111-2222-4333-8444-555555555555";
const unlinkedIdentity: MessageProxyIdentityContext = {
  serviceId: "pluralkit",
  instanceId: "pluralkit:official",
  userDiscId: identityId,
  externalIdentityId: 1,
  externalKey: identityId.slice(3),
  identityShortId: null,
  displayName: "Mirri",
  namespaceId: 1,
  namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  namespaceShortId: null,
  namespaceDisplayName: null,
  namespaceTag: null,
  namespaceDescription: null,
  hostUserDiscIds: [],
};
let lookup: ReturnType<typeof spyOn<typeof messageProxyRepository, "getIdentityContextByUserDiscId">> | undefined;
afterEach(() => lookup?.mockRestore());

describe("message-proxy host protection", () => {
  it.each([
    ["lookup fails or identity is missing", null],
    ["identity has no host links", unlinkedIdentity],
  ] as const)("denies memory writes when %s", async (_label, context) => {
    lookup = spyOn(messageProxyRepository, "getIdentityContextByUserDiscId").mockResolvedValue(context);
    expect(await getMessageProxyHostProtection(identityId, "guild-1")).toMatchObject({
      protected: true,
      reason: "host_unresolved",
    });
    let writes = 0;
    let invalidations = 0;
    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: identityId,
        identityUserId: 42,
        description: "A public member bio",
        serverDiscId: "guild-1",
      },
      {
        getHostProtection: getMessageProxyHostProtection,
        addPersonalMemory: async () => {
          writes++;
          return {};
        },
        invalidateCache: () => {
          invalidations++;
        },
      },
    );
    expect(writes).toBe(0);
    expect(invalidations).toBe(0);
  });

  it("leaves ordinary Discord accounts to the normal privacy checks", async () => {
    lookup = spyOn(messageProxyRepository, "getIdentityContextByUserDiscId");
    expect(await getMessageProxyHostProtection("123456789012345678", "guild-1")).toEqual({
      protected: false,
      isMessageProxyIdentity: false,
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});
