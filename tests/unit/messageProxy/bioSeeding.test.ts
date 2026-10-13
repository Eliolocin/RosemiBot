import { afterEach, describe, expect, it } from "bun:test";
import {
  composeMessageProxyBioSeedContent,
  seedMessageProxyIdentityBio,
  type MessageProxyBioSeedDeps,
} from "@/utils/messageProxy/bioSeeding";

function makeDeps(overrides: Partial<MessageProxyBioSeedDeps> = {}): {
  deps: MessageProxyBioSeedDeps;
  addCalls: Array<{ userId: number; personaLineageId: number; content: string }>;
  invalidateCalls: string[];
} {
  const addCalls: Array<{ userId: number; personaLineageId: number; content: string }> = [];
  const invalidateCalls: string[] = [];

  const deps: MessageProxyBioSeedDeps = {
    getHostProtection: async () => ({ protected: false, isMessageProxyIdentity: true }),
    addPersonalMemory: async (userId, personaLineageId, content) => {
      addCalls.push({ userId, personaLineageId, content });
      return { personal_memory_id: 1 };
    },
    invalidateCache: (userDiscId: string) => {
      invalidateCalls.push(userDiscId);
    },
    ...overrides,
  };

  return { deps, addCalls, invalidateCalls };
}

const originalBioSeedMaxChars = process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS;

afterEach(() => {
  if (originalBioSeedMaxChars === undefined) delete process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS;
  else process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS = originalBioSeedMaxChars;
});

describe("composeMessageProxyBioSeedContent", () => {
  it("flattens newlines and repeated whitespace to single spaces", () => {
    const content = composeMessageProxyBioSeedContent("line one\n\nline   two\tline three");
    expect(content).toBe("line one line two line three");
  });

  it("stores the bio verbatim, with no provenance prefix", () => {
    expect(composeMessageProxyBioSeedContent("pronouns: she/her")).toBe("pronouns: she/her");
  });

  it("truncates to MESSAGE_PROXY_BIO_SEED_MAX_CHARS", () => {
    process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS = "20";
    const content = composeMessageProxyBioSeedContent("a very long bio that exceeds the cap");
    expect(content).toHaveLength(20);
    expect(content).toBe("a very long bio that");
  });
});

describe("seedMessageProxyIdentityBio", () => {
  it("inserts a memory and invalidates the cache on a new member with a bio", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]?.userId).toBe(42);
    expect(addCalls[0]?.personaLineageId).toBe(0);
    expect(addCalls[0]?.content).toBe("pronouns: she/her");
    expect(invalidateCalls).toEqual(["fixture:identity-1"]);
  });

  it("does not insert when the description is empty or absent", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "   ",
        serverDiscId: "server_1",
      },
      deps,
    );
    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: undefined,
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
    expect(invalidateCalls).toHaveLength(0);
  });

  it("does not insert when isNewIdentity is false", async () => {
    const { deps, addCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: false,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
  });

  it("does not insert when the host is protected", async () => {
    const { deps, addCalls } = makeDeps({
      getHostProtection: async () => ({
        protected: true,
        isMessageProxyIdentity: true,
        reason: "host_full_privacy",
        hostUserDiscId: "host_1",
      }),
    });

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
  });

  it("does not invalidate the cache when the personal-memory limit is reached", async () => {
    const { deps, invalidateCalls } = makeDeps({
      addPersonalMemory: async () => null,
    });

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(invalidateCalls).toHaveLength(0);
  });
});
