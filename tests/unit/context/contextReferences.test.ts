import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import {
  PrivacyLevel,
  type AssembledServerConfig,
  type ReminderRow,
  type TomoriState,
  type UserRow,
} from "@/types/db/schema";
import {
  buildPublicPersonaProfiles,
  discoverReferencedPersonaIds,
  resolveContextReferences,
} from "@/utils/text/contextReferences";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { buildParticipantContextItem } from "@/utils/text/context/participants";
import { isEligibleContextReferenceUserV1, userRepository } from "@/utils/db/repositories/UserRepository";
import { serverScheduleRepository, userNamingRepository } from "@/utils/db/repositories";
import { buildParticipantDiscoveryPlan, type ParticipantDiscoveryPlan } from "@/utils/text/participants/discoveryPlan";
import { createDiscordUserKey, createPersonaKey, type ParticipantSeed } from "@/utils/text/participants/identity";
import { buildDiscordUserAliases } from "@/utils/text/participants/aliases";
import { resolveUniqueParticipantAliasReferences } from "@/utils/text/participants/referenceDiscovery";
import { composeParticipantDiscoveryPlan } from "@/utils/text/participants/sources";
import type { PublicPersonaProfile } from "@/utils/text/context/types";

/**
 * Resolves textual references through the same alias catalog and matcher the
 * production resolver uses, so these cases cannot pass against a test-only
 * alias shape. Positional aliases map onto the real sources in catalog
 * priority order: saved nickname, guild nickname, guild display name, global
 * name, username.
 */
function resolveAliasReferences(
  historyText: string,
  candidates: readonly { userId: string; aliases: readonly string[] }[],
): Set<string> {
  const aliases = candidates.flatMap((candidate) => {
    const [savedNickname, guildNickname, guildDisplayName, globalName, username] = candidate.aliases;
    return buildDiscordUserAliases({
      owner: createDiscordUserKey(candidate.userId),
      userRow: { user_nickname: savedNickname ?? null },
      identity: {
        displayName: guildDisplayName ?? null,
        nickname: guildNickname ?? null,
        globalName: globalName ?? null,
        username: username ?? null,
      },
      exposeSavedNickname: false,
    });
  });

  return new Set(
    resolveUniqueParticipantAliasReferences(historyText, aliases).referencedOwners.flatMap((owner) =>
      owner.kind === "discord_user" ? [owner.discordId] : [],
    ),
  );
}

const message = (content: string, id: string = crypto.randomUUID()): SimplifiedMessageForContext => ({
  id,
  authorId: "author",
  authorName: "Author",
  authorType: "user",
  content,
  imageAttachments: [],
  videoAttachments: [],
});

const persona = (id: number, nickname: string, triggers: string[]): TomoriState =>
  ({
    persona_id: id,
    persona_nickname: nickname,
    trigger_words: triggers,
    persona_attributes: [],
    physical_appearance_tags: [],
  }) as unknown as TomoriState;

async function participantSeeds(params: {
  client: Client;
  activePersona: TomoriState;
  participantIds: readonly string[];
  publicPersonaProfiles?: readonly PublicPersonaProfile[];
  referencePlan?: ParticipantDiscoveryPlan;
}): Promise<readonly ParticipantSeed[]> {
  const referencePlan =
    params.referencePlan ??
    buildParticipantDiscoveryPlan({
      candidates: (params.publicPersonaProfiles ?? []).map((profile) => ({
        key: createPersonaKey(profile.personaId),
        reasons: new Set(["persona_trigger_reference"] as const),
        aliases: [],
        capabilities: new Set(),
        sourceDisplayName: profile.personaName,
        evidenceSources: ["persona_trigger_reference"] as const,
      })),
    });
  const { plan } = await composeParticipantDiscoveryPlan({
    visibleInput: {
      participantIds: params.participantIds,
      clientUserId: params.client.user?.id,
      activePersonaId: params.activePersona.persona_id,
      activePersonaIsAlter: params.activePersona.is_alter,
    },
    personas: [params.activePersona],
    referencePlan,
  });
  return plan.seeds;
}

const defaultUser = (): UserRow => ({
  user_id: 1,
  user_disc_id: "100",
  user_nickname: "Alice",
  language_pref: "en-US",
  registration_locale: "en-US",
  privacy_level: PrivacyLevel.MINIMAL,
  personal_memories: [],
  physical_appearance_tags: [],
  nai_char_ref_url: null,
  impersonation_prompt: null,
  shortterm_cache_crossserver_opt_in: false,
  personal_dtm: "follow",
  personal_deliberate_tool_mode: "follow",
  personal_server_fallback_enabled: true,
  timezone_offset: null,
  message_proxy_service: null,
  message_proxy_instance_id: null,
});

describe("context reference discovery", () => {
  it("uses routing trigger semantics without applying deliberate trigger mode", () => {
    const personas = [
      persona(1, "Plain", ["plain"]),
      persona(2, "At", ["atname"]),
      persona(3, "Multi", ["Lady Maria"]),
      persona(4, "Japanese", ["トモリ"]),
      persona(5, "Legacy", ['"quetz"']),
    ];
    const ids = discoverReferencedPersonaIds(
      [
        message("plain can stay contextual while DTM is enabled"),
        message("@atname is also contextual"),
        message("Laaady Maaaaria, hello"),
        message("トモリさん"),
        message("quetz appears from a legacy quoted trigger"),
      ],
      personas,
    );

    expect(ids).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("scans the whole visible window but ignores blocked-user replacement notices", () => {
    const personas = [persona(2, "Quetz", ["quetz"])];
    expect(discoverReferencedPersonaIds([message("quetz", "old-visible-message"), message("later")], personas)).toEqual(
      new Set([2]),
    );
    expect(
      discoverReferencedPersonaIds(
        [message("Blocked user quetz is excluded.", "synthetic-user-block-hidden-message")],
        personas,
      ),
    ).toEqual(new Set());
  });

  it("builds deduplicated tags-only profiles and excludes the active persona", () => {
    const active = persona(1, "Active", ["active"]);
    active.physical_appearance_tags = ["black hair"];
    const tagsOnly = persona(2, "Tags Only", ["tags"]);
    tagsOnly.physical_appearance_tags = [" silver hair ", "", "red eyes"];

    expect(buildPublicPersonaProfiles([active, tagsOnly], new Set([1, 2]), 1)).toEqual([
      {
        personaId: 2,
        personaName: "Tags Only",
        attributes: [],
        imageAppearanceTags: ["silver hair", "red eyes"],
      },
    ]);
  });

  it("resolves plain and textual-at aliases case-insensitively across all alias forms", () => {
    const candidates = [
      {
        userId: "100",
        aliases: ["Tomori nickname", "Guild Nick", "Display Name", "Global Name", "discord_username"],
      },
    ];

    for (const alias of candidates[0].aliases) {
      expect(resolveAliasReferences(`Please ask @${alias.toUpperCase()} about this.`, candidates)).toEqual(
        new Set(["100"]),
      );
      expect(resolveAliasReferences(`${alias} can help.`, candidates)).toEqual(new Set(["100"]));
    }
  });

  it("accepts unique common words but rejects partial words, emails, and shared aliases", () => {
    expect(resolveAliasReferences("Apple can help.", [{ userId: "100", aliases: ["Apple"] }])).toEqual(
      new Set(["100"]),
    );
    expect(resolveAliasReferences("Pineapple can help.", [{ userId: "100", aliases: ["Apple"] }])).toEqual(new Set());
    expect(resolveAliasReferences("mail x@Apple.example", [{ userId: "100", aliases: ["Apple"] }])).toEqual(new Set());
    expect(
      resolveAliasReferences("Ask Apple.", [
        { userId: "100", aliases: ["Apple"] },
        { userId: "200", aliases: ["apple"] },
      ]),
    ).toEqual(new Set());
  });

  it("matches Unicode and multi-word aliases across punctuation and repeated whitespace", () => {
    const candidates = [
      { userId: "100", aliases: ["José María"] },
      { userId: "200", aliases: ["山田 太郎"] },
    ];

    expect(resolveAliasReferences("(JOSÉ    MARÍA), can you help?", candidates)).toEqual(new Set(["100"]));
    expect(resolveAliasReferences("山田\t太郎さんではなく、@山田\t太郎 に聞いて。", candidates)).toEqual(
      new Set(["200"]),
    );
  });

  it("does not treat a persona nickname as a reference unless a trigger word matches", () => {
    const nicknameOnly = persona(9, "Ren", ["lilya"]);

    expect(discoverReferencedPersonaIds([message("Ren can stay in the story.")], [nicknameOnly])).toEqual(new Set());
    expect(discoverReferencedPersonaIds([message("Please ask lilya.")], [nicknameOnly])).toEqual(new Set([9]));
  });

  it("includes historical and co-responding persona IDs while excluding empty public profiles", () => {
    const historical = persona(2, "Historical", ["history"]);
    historical.persona_attributes = [{ attribute_text: "Public history", is_public: true }] as never;
    const responder = persona(3, "Responder", ["response"]);
    responder.physical_appearance_tags = ["gold eyes"];
    const empty = persona(4, "Empty", ["empty"]);

    expect(buildPublicPersonaProfiles([historical, responder, empty], new Set([2, 3, 4]), 1)).toEqual([
      {
        personaId: 2,
        personaName: "Historical",
        attributes: ["Public history"],
        imageAppearanceTags: [],
      },
      {
        personaId: 3,
        personaName: "Responder",
        attributes: [],
        imageAppearanceTags: ["gold eyes"],
      },
    ]);
  });

  it("keeps DM reference discovery persona-only when no guild is available", async () => {
    const referencedPersona = persona(2, "Ren", ["ren"]);
    referencedPersona.persona_attributes = [{ attribute_text: "Public profile", is_public: true }] as never;
    const client = { guilds: { cache: new Map() } } as unknown as Client;

    const resolved = await resolveContextReferences({
      client,
      guildId: "dm",
      simplifiedMessageHistory: [message("Ask ren and <@100>.")],
      personas: [referencedPersona],
      existingParticipantIds: new Set(),
    });

    expect(resolved.referencedUserIds).toEqual(new Set());
    expect(resolved.referencedUserRows).toEqual(new Map());
    expect(resolved.publicPersonaProfiles.map((profile) => profile.personaId)).toEqual([2]);
    expect(resolved.personaProfileReasons).toEqual(new Map([[2, new Set(["persona_trigger_reference"])]]));
  });

  it("retains every persona inclusion reason without duplicating its public profile", async () => {
    const referencedPersona = persona(2, "Ren", ["ren"]);
    referencedPersona.persona_attributes = [{ attribute_text: "Public profile", is_public: true }] as never;
    const client = { guilds: { cache: new Map() } } as unknown as Client;

    const resolved = await resolveContextReferences({
      client,
      guildId: "dm",
      simplifiedMessageHistory: [message("Ask ren.")],
      personas: [referencedPersona],
      existingParticipantIds: new Set(),
      existingPersonaIds: new Set([2]),
      responderPersonaIds: new Set([2]),
    });

    expect(resolved.publicPersonaProfiles).toHaveLength(1);
    expect(resolved.personaProfileReasons).toEqual(
      new Map([[2, new Set(["persona_trigger_reference", "historical_persona", "co_responder"])]]),
    );
  });

  it("resolves real mentions, verifies uncached membership, and skips bots and non-members", async () => {
    const rows = ["100", "200", "300", "400"].map((id) => ({
      ...defaultUser(),
      user_disc_id: id,
      user_nickname: id === "200" ? "Saved Alias" : `User ${id}`,
    }));
    const makeMember = (id: string, bot = false) =>
      ({
        id,
        displayName: id === "200" ? "Guild Alias" : `Display ${id}`,
        nickname: id === "200" ? "Guild Alias" : null,
        user: {
          id,
          bot,
          globalName: `Global ${id}`,
          username: id === "300" ? "Bot Alias" : `username_${id}`,
        },
      }) as never;
    const cachedMembers = new Map([
      ["200", makeMember("200")],
      ["300", makeMember("300", true)],
    ]);
    const guild = {
      members: {
        cache: cachedMembers,
        fetch: async (id: string) => (id === "100" ? makeMember("100") : null),
      },
    };
    const client = {
      guilds: { cache: new Map([["guild", guild]]) },
    } as unknown as Client;
    const originalLoadCandidates = userRepository.loadContextReferenceCandidates;
    userRepository.loadContextReferenceCandidates = async () =>
      rows.map((userRow) => ({
        userRow,
        evidence: { hasServerActivity: true, hasPersonalMemories: false, hasPendingTasks: false },
      }));

    try {
      const resolved = await resolveContextReferences({
        client,
        guildId: "guild",
        simplifiedMessageHistory: [message("<@100>, ask Guild Alias. Bot Alias and User 400 are also named.")],
        personas: [],
        existingParticipantIds: new Set(),
        messageProxyIdentitySource: { loadIdentities: async () => [] },
      });

      expect(resolved.referencedUserIds).toEqual(new Set(["200", "100"]));
      expect(Array.from(resolved.referencedUserRows.keys()).sort()).toEqual(["100", "200"]);
      expect(resolved.referencedUserReasons).toEqual(
        new Map<string, ReadonlySet<"real_mention" | "unique_text_alias">>([
          ["200", new Set(["unique_text_alias"])],
          ["100", new Set(["real_mention"])],
        ]),
      );
    } finally {
      userRepository.loadContextReferenceCandidates = originalLoadCandidates;
    }
  });
});

describe("message-proxy identity reference discovery", () => {
  const HOST_ID = "700";
  const MEMBER_ID = "pk:11111111-1111-4111-8111-111111111111";

  function guildClient(cachedMemberIds: readonly string[] = [HOST_ID]): Client {
    const makeMember = (id: string) =>
      ({
        id,
        displayName: `Display ${id}`,
        nickname: null,
        user: { id, bot: false, globalName: `Global ${id}`, username: `username_${id}` },
      }) as never;
    const cache = new Map(cachedMemberIds.map((id) => [id, makeMember(id)]));
    return {
      guilds: {
        cache: new Map([["guild", { members: { cache, fetch: async () => null } }]]),
      },
    } as unknown as Client;
  }

  async function resolveWithMembers(params: {
    content: string;
    identities: readonly {
      serviceId: string;
      userDiscId: string;
      displayName: string | null;
      savedNickname: string | null;
    }[];
    humanCandidates?: readonly UserRow[];
    existingParticipantIds?: ReadonlySet<string>;
    onQuery?: (query: { hostUserDiscIds: readonly string[]; normalizedHistoryText: string }) => void;
  }) {
    const originalLoadCandidates = userRepository.loadContextReferenceCandidates;
    userRepository.loadContextReferenceCandidates = async () =>
      (params.humanCandidates ?? []).map((userRow) => ({
        userRow,
        evidence: { hasServerActivity: true, hasPersonalMemories: false, hasPendingTasks: false },
      }));

    try {
      return await resolveContextReferences({
        client: guildClient(),
        guildId: "guild",
        simplifiedMessageHistory: [message(params.content)],
        personas: [],
        existingParticipantIds: params.existingParticipantIds ?? new Set(),
        messageProxyIdentitySource: {
          loadIdentities: async (query) => {
            params.onQuery?.(query);
            return params.identities;
          },
        },
      });
    } finally {
      userRepository.loadContextReferenceCandidates = originalLoadCandidates;
    }
  }

  it("discovers a member named in conversation that never spoke in the window", async () => {
    const observedQueries: Array<{ hostUserDiscIds: readonly string[]; normalizedHistoryText: string }> = [];
    const resolved = await resolveWithMembers({
      content: "What did Mirri say about that?",
      identities: [{ serviceId: "pluralkit", userDiscId: MEMBER_ID, displayName: "Mirri", savedNickname: null }],
      onQuery: (query) => {
        observedQueries.push(query);
      },
    });

    expect(resolved.referencedUserIds).toEqual(new Set([MEMBER_ID]));
    expect(resolved.referencedUserReasons).toEqual(new Map([[MEMBER_ID, new Set(["unique_text_alias"])]]));
    // Host scoping is what keeps member names from colliding across every system
    // the bot has ever seen; the pool is the guild's cached members.
    expect(observedQueries[0]?.hostUserDiscIds).toContain(HOST_ID);

    const seed = resolved.discoveryPlan.seeds.find(
      (candidate) => candidate.key.kind === "discord_user" && candidate.key.discordId === MEMBER_ID,
    );
    expect(seed?.sourceDisplayName).toBe("Mirri");
    expect(seed?.capabilities.has("mentionable")).toBe(false);
  });

  it("resolves a member by its saved nickname as well as its PluralKit display name", async () => {
    const resolved = await resolveWithMembers({
      content: "Ask Spar about it.",
      identities: [{ serviceId: "pluralkit", userDiscId: MEMBER_ID, displayName: "Mirri", savedNickname: "Spar" }],
    });

    expect(resolved.referencedUserIds).toEqual(new Set([MEMBER_ID]));
  });

  it("drops a name shared by a member and a human instead of guessing between them", async () => {
    const human: UserRow = { ...defaultUser(), user_disc_id: HOST_ID, user_nickname: "Mirri" };
    const resolved = await resolveWithMembers({
      content: "Mirri said so.",
      identities: [{ serviceId: "pluralkit", userDiscId: MEMBER_ID, displayName: "Mirri", savedNickname: null }],
      humanCandidates: [human],
    });

    expect(resolved.referencedUserIds).toEqual(new Set());
    expect(resolved.discoveryPlan.aliasReferenceDiagnostics.ambiguousAliasCount).toBe(1);
    expect(resolved.discoveryPlan.rejections).toContainEqual({ reason: "ambiguous_alias", count: 1 });
  });

  it("does not re-add a member that is already a visible participant", async () => {
    const resolved = await resolveWithMembers({
      content: "Mirri said so.",
      identities: [{ serviceId: "pluralkit", userDiscId: MEMBER_ID, displayName: "Mirri", savedNickname: null }],
      existingParticipantIds: new Set([MEMBER_ID]),
    });

    expect(resolved.referencedUserIds).toEqual(new Set());
    expect(resolved.discoveryPlan.rejections).toContainEqual({ reason: "existing_participant", count: 1 });
  });

  it("keeps a proxy identity row out of the guild-member lane", async () => {
    // The human candidate query selects by nickname and server activity, which a
    // member's real users row can satisfy. Reaching resolveMember would spend a
    // fetch on a non-snowflake and log an Unknown Member error.
    const memberRow: UserRow = { ...defaultUser(), user_disc_id: MEMBER_ID, user_nickname: "Mirri" };
    const resolved = await resolveWithMembers({
      content: "Mirri said so.",
      identities: [{ serviceId: "pluralkit", userDiscId: MEMBER_ID, displayName: "Mirri", savedNickname: null }],
      humanCandidates: [memberRow],
    });

    expect(resolved.referencedUserIds).toEqual(new Set([MEMBER_ID]));
    expect(resolved.discoveryPlan.rejections).not.toContainEqual({ reason: "non_member", count: 1 });
  });
});

describe("context reference user eligibility", () => {
  const noEvidence = {
    hasServerActivity: false,
    hasPersonalMemories: false,
    hasPendingTasks: false,
  };

  it("rejects an auto-created default-only user", () => {
    expect(isEligibleContextReferenceUserV1(defaultUser(), noEvidence)).toBe(false);
  });

  for (const [label, mutate, evidence] of [
    ["message or command activity", () => {}, { ...noEvidence, hasServerActivity: true }],
    ["personal memories", () => {}, { ...noEvidence, hasPersonalMemories: true }],
    ["pending reminders or tasks", () => {}, { ...noEvidence, hasPendingTasks: true }],
    ["cross-server personalization", (user: UserRow) => (user.shortterm_cache_crossserver_opt_in = true), noEvidence],
    ["physical appearance tags", (user: UserRow) => (user.physical_appearance_tags = ["blue hair"]), noEvidence],
    ["image reference", (user: UserRow) => (user.nai_char_ref_url = "https://example.com/ref.png"), noEvidence],
    ["impersonation prompt", (user: UserRow) => (user.impersonation_prompt = "Write as Alice"), noEvidence],
    ["personal DTM", (user: UserRow) => (user.personal_dtm = "on"), noEvidence],
    ["personal tool mode", (user: UserRow) => (user.personal_deliberate_tool_mode = "off"), noEvidence],
    ["timezone", (user: UserRow) => (user.timezone_offset = 8), noEvidence],
    ["privacy", (user: UserRow) => (user.privacy_level = PrivacyLevel.PARTIAL), noEvidence],
  ] as const) {
    it(`accepts ${label} as meaningful state`, () => {
      const user = defaultUser();
      mutate(user);
      expect(isEligibleContextReferenceUserV1(user, evidence)).toBe(true);
    });
  }

  it("does not treat registration language or the initial nickname alone as meaningful", () => {
    const user = defaultUser();
    user.language_pref = "ja";
    user.registration_locale = "ja";
    user.user_nickname = "Saved At Registration";
    expect(isEligibleContextReferenceUserV1(user, noEvidence)).toBe(false);
  });
});

describe("public persona profile rendering", () => {
  it("renders a non-mentionable persona that has image tags but no public attributes", async () => {
    const client = {
      user: { id: "999" },
      guilds: { cache: new Map() },
      options: { intents: { has: () => false } },
    } as unknown as Client;
    const activePersona = persona(1, "Active", ["active"]);
    activePersona.config = { timezone_offset: 0 } as AssembledServerConfig;
    const originalGetPendingReminders = serverScheduleRepository.getPendingRemindersForUser;
    serverScheduleRepository.getPendingRemindersForUser = async () => [];

    try {
      const publicPersonaProfiles = [
        {
          personaId: 2,
          personaName: "Tags Only",
          attributes: [],
          imageAppearanceTags: ["silver hair", "red eyes"],
        },
      ];
      const seeds = await participantSeeds({
        client,
        activePersona,
        participantIds: ["999"],
        publicPersonaProfiles,
      });
      const item = await buildParticipantContextItem({
        client,
        guildId: "guild",
        channelName: "general",
        channelId: "channel",
        participantSeeds: seeds,
        triggererName: "Author",
        botName: "Active",
        tomoriState: null,
        tomoriConfig: activePersona.config,
        isDMChannel: false,
        isUserImpersonation: false,
        impersonatedIdentityName: null,
        publicPersonaProfiles,
        toolPromptMacroResolver: { expand: async (text) => text },
        conversationCorpus: "",
        convertMentions: async (text) => text,
      });

      const text = item?.parts[0]?.type === "text" ? item.parts[0].text : "";
      expect(text).toContain("Tags Only");
      expect(text).toContain("Tags Only's Physical Appearance: silver hair, red eyes");
      expect(text).not.toContain("Mention: @{Tags Only}");
    } finally {
      serverScheduleRepository.getPendingRemindersForUser = originalGetPendingReminders;
    }
  });

  it("never auto-registers a missing user discovered only by reference", async () => {
    const originalLoad = userRepository.loadByDiscordId;
    const originalRegister = userRepository.register;
    const originalGetPendingReminders = serverScheduleRepository.getPendingRemindersForUser;
    let registerCalled = false;
    userRepository.loadByDiscordId = async () => null;
    userRepository.register = async () => {
      registerCalled = true;
      return defaultUser();
    };
    serverScheduleRepository.getPendingRemindersForUser = async () => [];
    const client = {
      user: { id: "999" },
      guilds: {
        cache: new Map([
          [
            "guild",
            {
              members: {
                cache: new Map(),
                fetch: async () => ({
                  displayName: "Unknown",
                  user: { username: "unknown", globalName: null },
                }),
              },
            },
          ],
        ]),
      },
      options: { intents: { has: () => false } },
    } as unknown as Client;
    const activePersona = persona(1, "Active", ["active"]);
    activePersona.config = { timezone_offset: 0 } as AssembledServerConfig;

    try {
      const referencePlan = buildParticipantDiscoveryPlan({
        candidates: [
          {
            key: createDiscordUserKey("404"),
            reasons: new Set(["real_mention"]),
            aliases: [],
            capabilities: new Set(["mentionable"]),
            evidenceSources: ["real_mention"],
          },
        ],
      });
      const seeds = await participantSeeds({ client, activePersona, participantIds: [], referencePlan });
      await buildParticipantContextItem({
        client,
        guildId: "guild",
        channelName: "general",
        channelId: "channel",
        participantSeeds: seeds,
        triggererName: "Author",
        botName: "Active",
        tomoriState: null,
        tomoriConfig: activePersona.config,
        isDMChannel: false,
        isUserImpersonation: false,
        impersonatedIdentityName: null,
        referencedUserIds: new Set(["404"]),
        toolPromptMacroResolver: { expand: async (text) => text },
        conversationCorpus: "",
        convertMentions: async (text) => text,
      });
      expect(registerCalled).toBe(false);
    } finally {
      userRepository.loadByDiscordId = originalLoad;
      userRepository.register = originalRegister;
      serverScheduleRepository.getPendingRemindersForUser = originalGetPendingReminders;
    }
  });
});

describe("persona task context", () => {
  it("keeps human reminders gated by context membership and the active persona", async () => {
    const user = { ...defaultUser(), privacy_level: PrivacyLevel.PARTIAL };
    const member = {
      displayName: "Alice",
      nickname: null,
      user: { username: "alice", globalName: "Alice" },
    };
    const client = {
      user: { id: "999" },
      users: { fetch: async () => null },
      guilds: {
        cache: new Map([
          [
            "guild",
            {
              members: {
                fetch: async () => member,
              },
            },
          ],
        ]),
      },
      options: { intents: { has: () => false } },
    } as unknown as Client;
    const activePersona = persona(7, "Active", ["active"]);
    activePersona.is_alter = true;
    activePersona.config = {
      timezone_offset: 0,
      personal_memories_enabled: false,
    } as AssembledServerConfig;
    const originalLoadByDiscordId = userRepository.loadByDiscordId;
    const originalGetPendingReminders = serverScheduleRepository.getPendingRemindersForUser;
    const originalLoadNamingPreferences = userNamingRepository.loadPreferences;
    userRepository.loadByDiscordId = async (discordId) => (discordId === "100" ? user : null);
    userNamingRepository.loadPreferences = async () => new Map();
    const calls: Array<Parameters<typeof serverScheduleRepository.getPendingRemindersForUser>> = [];
    serverScheduleRepository.getPendingRemindersForUser = async (...args) => {
      calls.push(args);
      if (args[0] !== "100") return [];
      return [
        {
          reminder_id: 41,
          reminder_purpose: "Take meds",
          reminder_time: new Date("2026-08-01T01:00:00.000Z"),
          repetition_interval_hours: null,
          self_reminder: false,
          channel_disc_id: "channel-1",
        } as ReminderRow,
      ];
    };

    try {
      const seeds = await participantSeeds({ client, activePersona, participantIds: ["100", "999"] });
      const item = await buildParticipantContextItem({
        client,
        guildId: "guild",
        channelName: "general",
        channelId: "channel-1",
        participantSeeds: seeds,
        triggererName: "Alice",
        botName: "Active",
        tomoriState: activePersona,
        tomoriConfig: activePersona.config,
        isDMChannel: false,
        isUserImpersonation: false,
        impersonatedIdentityName: null,
        preloadedReferencedUserRows: new Map([["100", user]]),
        referencedUserIds: new Set(["100"]),
        toolPromptMacroResolver: { expand: async (text) => text },
        conversationCorpus: "",
        snapshot: {
          triggererUserRow: user,
          triggererPrivacyLevel: PrivacyLevel.PARTIAL,
          isTriggererBlacklisted: false,
        } as never,
        convertMentions: async (text) => text,
      });

      const text = item?.parts[0]?.type === "text" ? item.parts[0].text : "";
      expect(calls).toEqual([
        ["100", "guild", 7, false],
        ["999", "guild", 7],
      ]);
      expect(text).toContain('ID:41 "Take meds"');
      expect(text).not.toContain("Pending Tasks Assigned to You:");
    } finally {
      userRepository.loadByDiscordId = originalLoadByDiscordId;
      userNamingRepository.loadPreferences = originalLoadNamingPreferences;
      serverScheduleRepository.getPendingRemindersForUser = originalGetPendingReminders;
    }
  });

  it("loads active-persona self tasks independently of human participants", async () => {
    const client = {
      user: { id: "999" },
      guilds: { cache: new Map() },
      options: { intents: { has: () => false } },
    } as unknown as Client;
    const activePersona = persona(7, "Active", ["active"]);
    activePersona.config = { timezone_offset: 8 } as AssembledServerConfig;
    const originalGetPendingReminders = serverScheduleRepository.getPendingRemindersForUser;
    const calls: Array<Parameters<typeof serverScheduleRepository.getPendingRemindersForUser>> = [];
    serverScheduleRepository.getPendingRemindersForUser = async (...args) => {
      calls.push(args);
      return [
        {
          reminder_id: 42,
          reminder_purpose: "Post the daily summary",
          reminder_time: new Date("2026-08-01T01:00:00.000Z"),
          repetition_interval_hours: 24,
          self_reminder: true,
          channel_disc_id: "channel-2",
        } as ReminderRow,
        {
          reminder_id: 43,
          reminder_purpose: "Notify Alice",
          reminder_time: new Date("2026-08-01T02:00:00.000Z"),
          repetition_interval_hours: null,
          self_reminder: false,
          channel_disc_id: "channel-1",
        } as ReminderRow,
      ];
    };

    try {
      const seeds = await participantSeeds({ client, activePersona, participantIds: ["999"] });
      const item = await buildParticipantContextItem({
        client,
        guildId: "guild",
        channelName: "general",
        channelId: "channel-1",
        participantSeeds: seeds,
        triggererName: "Author",
        botName: "Active",
        tomoriState: activePersona,
        tomoriConfig: activePersona.config,
        isDMChannel: false,
        isUserImpersonation: false,
        impersonatedIdentityName: null,
        toolPromptMacroResolver: { expand: async (text) => text },
        conversationCorpus: "",
        convertMentions: async (text) => text,
      });

      const text = item?.parts[0]?.type === "text" ? item.parts[0].text : "";
      expect(calls).toEqual([["999", "guild", 7]]);
      expect(text).toContain("Pending Tasks Assigned to You:");
      expect(text).toContain('ID:42 "Post the daily summary"');
      expect(text).toContain("destination: <#channel-2>");
      expect(text).not.toContain("Notify Alice");
    } finally {
      serverScheduleRepository.getPendingRemindersForUser = originalGetPendingReminders;
    }
  });
});
