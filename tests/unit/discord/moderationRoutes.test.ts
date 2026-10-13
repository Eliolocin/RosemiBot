import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ChannelType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { CooldownType } from "@/types/db/schema";
import {
  buildInitialModerationPanel,
  createModerationInteractionRoute,
  executeModerationCommand,
  type ModerationRouteDependencies,
} from "@/utils/discord/interactions/moderationRoutes";
import {
  MODERATION_ROUTE_CODECS,
  buildModerationRouteId,
  buildModerationRouteSegments,
  buildQuotaModalFieldId,
  parseModerationPanelRoute,
  type ModerationPanelRoute,
} from "@/utils/discord/moderationPanelCatalog";
import { parseInteractionRoute, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { MODERATION_PANEL_RANGE_SIZE } from "@/utils/discord/interactions/panelController";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import {
  buildMemberAccessModal,
  buildModerationPanelPayload,
  buildModerationRemovalModal,
  buildPersonaChannelAddModal,
  buildQuotaEditModal,
  buildUserBlacklistAddModal,
  buildWhitelistChannelAddModal,
  buildWhitelistRoleAddModal,
  type ModerationPanelRenderInput,
} from "@/utils/discord/ui/moderationPanel";
import { formatPanelProse } from "@/utils/discord/ui/panelProse";
import { moderationOperations, type ModerationScopeData } from "@/utils/moderation/moderationOperations";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy, localizedProse } from "../../helpers/localeCases";

function serializedPanelProse(markdown: string): string {
  return JSON.stringify(formatPanelProse(markdown)).slice(1, -1);
}

beforeAll(async () => initializeLocalizer());

function createScopeData(overrides: Partial<ModerationScopeData> = {}): ModerationScopeData {
  return {
    guildId: "guild-1",
    serverId: 1,
    readStatus: "fresh",
    memberAccess: {
      serverMemteachingEnabled: true,
      attributeMemteachingEnabled: false,
      sampledialogueMemteachingEnabled: true,
      promptSnapshotEnabled: false,
    },
    serverModelAccess: { allowServerModels: true },
    userBlacklist: {
      personalizationUserIds: ["u1"],
      personaBlocks: [],
    },
    whitelist: {
      channels: [],
      personaChannels: [],
      roles: [],
      personaNames: new Map(),
    },
    quotas: {
      image: { daily_user_quota: 5, serverwide_quota: 50, serverwide_quota_resets_in: 30 },
      text: { daily_user_quota: 10, serverwide_quota: 100, serverwide_quota_resets_in: 7 },
      video: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
    },
    ...overrides,
  };
}

function blacklistIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `1234567890123${String(index).padStart(5, "0")}`);
}

describe("moderation interaction routes", () => {
  it("acknowledges with deferUpdate and repaints on category switch without writing to database", async () => {
    const log: string[] = [];
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:category:en-US:user-blacklist",
      guildId: "guild-1",
      memberPermissions: {
        has: (perm: string) => perm === "ManageGuild",
      },
      deferUpdate: async () => {
        log.push("deferUpdate");
      },
      editReply: async (payload: unknown) => {
        log.push("editReply");
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const deps: Partial<ModerationRouteDependencies> = {
      resolveScope: async (_interaction, forceRefresh) => {
        log.push(forceRefresh ? "load-refresh" : "load");
        return createScopeData();
      },
    };

    const route = createModerationInteractionRoute(deps);
    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["category", "en-US", "user-blacklist"],
    });

    expect(log).toEqual(["deferUpdate", "load", "editReply"]);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.category_user_blacklist"));
  });

  it("handles page select menu interactions", async () => {
    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => false,
      isStringSelectMenu: () => true,
      isModalSubmit: () => false,
      customId: "moderation:v2:select-page:en-US",
      values: ["roles"],
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as StringSelectMenuInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["select-page", "en-US"],
    });

    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.remove_whitelist_role_group_title"));
  });

  it("handles range navigation route", async () => {
    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:range:en-US:user-blacklist:none:1",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["range", "en-US", "user-blacklist", "none", "1"],
    });

    expect(editReplyCalls).toHaveLength(1);
  });

  it("clamps out-of-range route when rows disappear and visibly renders the surviving row", async () => {
    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:range:en-US:user-blacklist:none:99",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const scopeWithSingleRow: ModerationScopeData = {
      ...createScopeData(),
      userBlacklist: {
        personalizationUserIds: ["surviving-member-123"],
        personaBlocks: [],
      },
    };

    const route = createModerationInteractionRoute({
      resolveScope: async () => scopeWithSingleRow,
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["range", "en-US", "user-blacklist", "none", "99"],
    });

    expect(editReplyCalls).toHaveLength(1);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain("surviving-member-123");
  });

  it("does not invoke write operations during navigation routes", async () => {
    let updateCalled = 0;
    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => {
          updateCalled++;
          return { status: "success", changes: [], patch: {} };
        },
      },
    });

    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:category:en-US:whitelist",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["category", "en-US", "whitelist"],
    });

    expect(editReplyCalls).toHaveLength(1);
    expect(updateCalled).toBe(0);
  });

  it("denies member-access-open when user lacks Manage Server without reading state or showing modal", async () => {
    let scopeRead = 0;
    let memberAccessRead = 0;
    let modalShown = 0;
    let replyPayload: unknown = null;

    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:member-access-open:en-US",
      guildId: "guild-1",
      memberPermissions: {
        has: () => false,
      },
      reply: async (payload: unknown) => {
        replyPayload = payload;
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => {
        scopeRead++;
        return createScopeData();
      },
      resolveMemberAccess: async () => {
        memberAccessRead++;
        return {
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          memberAccess: createScopeData().memberAccess,
        };
      },
      showMemberAccessModal: async () => {
        modalShown++;
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-open", "en-US"],
    });

    expect(scopeRead).toBe(0);
    expect(memberAccessRead).toBe(0);
    expect(modalShown).toBe(0);
    expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
  });

  it("rejects member-access-open when setup is missing or read is not fresh", async () => {
    let modalShown = 0;
    let replyPayload: unknown = null;

    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:member-access-open:en-US",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      reply: async (payload: unknown) => {
        replyPayload = payload;
      },
    } as unknown as ButtonInteraction;

    const missingRoute = createModerationInteractionRoute({
      resolveMemberAccess: async () => null,
      showMemberAccessModal: async () => {
        modalShown++;
      },
    });

    await missingRoute.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-open", "en-US"],
    });

    expect(modalShown).toBe(0);
    expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.not_setup"));

    const unavailableRoute = createModerationInteractionRoute({
      resolveMemberAccess: async () => ({
        guildId: "guild-1",
        serverId: 1,
        readStatus: "unavailable",
        memberAccess: createScopeData().memberAccess,
      }),
      showMemberAccessModal: async () => {
        modalShown++;
      },
    });

    await unavailableRoute.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-open", "en-US"],
    });

    expect(modalShown).toBe(0);
    expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));

    const staleRoute = createModerationInteractionRoute({
      resolveMemberAccess: async () => ({
        guildId: "guild-1",
        serverId: 1,
        readStatus: "stale",
        memberAccess: createScopeData().memberAccess,
      }),
      showMemberAccessModal: async () => {
        modalShown++;
      },
    });

    await staleRoute.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-open", "en-US"],
    });

    expect(modalShown).toBe(0);
    expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));
  });

  it("opens member-access modal with fresh state, nonce, and no pre-defer on valid button click without calling full scope resolver", async () => {
    const log: string[] = [];
    let modalState: unknown = null;
    let modalNonce = "";
    let scopeCalls = 0;

    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:member-access-open:en-US",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {
        log.push("deferUpdate");
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => {
        scopeCalls++;
        return createScopeData();
      },
      resolveMemberAccess: async () => {
        log.push("resolveMemberAccess");
        return {
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          memberAccess: createScopeData().memberAccess,
        };
      },
      createNonce: () => "nonceabc123",
      showMemberAccessModal: async (_interaction, _locale, state, nonce) => {
        log.push("showModal");
        modalState = state;
        modalNonce = nonce;
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-open", "en-US"],
    });

    expect(log).toEqual(["resolveMemberAccess", "showModal"]);
    expect(scopeCalls).toBe(0);
    expect(modalNonce).toBe("nonceabc123");
    expect(modalState).toEqual({
      serverMemteachingEnabled: true,
      attributeMemteachingEnabled: false,
      sampledialogueMemteachingEnabled: true,
      promptSnapshotEnabled: false,
    });
  });

  it("acknowledges the model-access write before it runs, not after", async () => {
    let acknowledgedAtWrite = false;
    const interaction = {
      id: "int-byok",
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:model-access-set:en-US:require-personal",
      guildId: "guild-1",
      user: { id: "u-manager" },
      memberPermissions: { has: () => true },
      deferred: false,
      replied: false,
      deferUpdate: async () => {
        interaction.deferred = true;
      },
      editReply: async () => undefined,
    } as unknown as Record<string, unknown> & { deferred: boolean; replied: boolean };

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      operations: {
        ...moderationOperations,
        // Sampled from inside the write: ordering is invisible in *what* was called, and Discord
        // drops an interaction that is not acknowledged within three seconds.
        updateServerModelAccess: async () => {
          acknowledgedAtWrite = interaction.deferred || interaction.replied;
          return { status: "success", allowServerModels: false };
        },
      },
    });

    await route.execute({} as Client, interaction as never, {
      namespace: "moderation",
      version: "v2",
      segments: ["model-access-set", "en-US", "require-personal"],
    });

    expect(acknowledgedAtWrite).toBe(true);
  });

  it("denies the model-access write without Manage Server and never touches the setting", async () => {
    let writeCalls = 0;
    const editReplyCalls: unknown[] = [];
    const interaction = {
      id: "int-byok-denied",
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:model-access-set:en-US:require-personal",
      guildId: "guild-1",
      user: { id: "u-member" },
      memberPermissions: { has: () => false },
      deferUpdate: async () => undefined,
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    };

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      operations: {
        ...moderationOperations,
        updateServerModelAccess: async () => {
          writeCalls += 1;
          return { status: "success", allowServerModels: false };
        },
      },
    });

    await route.execute({} as Client, interaction as never, {
      namespace: "moderation",
      version: "v2",
      segments: ["model-access-set", "en-US", "require-personal"],
    });

    expect(writeCalls).toBe(0);
    expect(editReplyCalls).toHaveLength(1);
  });

  it("blocks the model-access write on a stale read and says so", async () => {
    let writeCalls = 0;
    const editReplyCalls: unknown[] = [];
    const interaction = {
      id: "int-byok-stale",
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:model-access-set:en-US:allow",
      guildId: "guild-1",
      user: { id: "u-manager" },
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    };

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData({ readStatus: "stale" }),
      operations: {
        ...moderationOperations,
        updateServerModelAccess: async () => {
          writeCalls += 1;
          return { status: "success", allowServerModels: true };
        },
      },
    });

    await route.execute({} as Client, interaction as never, {
      namespace: "moderation",
      version: "v2",
      segments: ["model-access-set", "en-US", "allow"],
    });

    expect(writeCalls).toBe(0);
    expect(JSON.stringify(editReplyCalls[0])).toContain(
      localizedCopy("en-US", "commands.moderation.model_access_failed"),
    );
  });

  it("denies member-access-submit on permission loss between open and submit before any write", async () => {
    let updateCalled = 0;
    let cleanedNonce = "";
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-123",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => false,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      takeCheckboxValues: (_id, nonce) => {
        cleanedNonce = nonce;
        return ["servermemories"];
      },
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => {
          updateCalled++;
          return { status: "success", changes: [], patch: {} };
        },
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(cleanedNonce).toBe("nonce123");
    expect(updateCalled).toBe(0);
    expect(JSON.stringify(editReplyCalls[0])).toContain(
      localizedCopy("en-US", "commands.moderation.permission_denied"),
    );
  });

  it("treats missing checkbox transport as invalid/expired input with no write", async () => {
    let updateCalled = 0;
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-missing",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      takeCheckboxValues: () => undefined,
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => {
          updateCalled++;
          return { status: "success", changes: [], patch: {} };
        },
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(updateCalled).toBe(0);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_failed"));
    expect(serialized).toContain(
      serializedPanelProse("> The modal submission could not be processed. Open the editor again to retry."),
    );
  });

  it("blocks writes on submit when refreshed moderation scope is stale or unavailable", async () => {
    let updateCalled = 0;
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-stale",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => ({ ...createScopeData(), readStatus: "stale" }),
      takeCheckboxValues: () => ["servermemories"],
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => {
          updateCalled++;
          return { status: "success", changes: [], patch: {} };
        },
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(updateCalled).toBe(0);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_failed"));
    expect(serialized).toMatch(localizedProse("en-US", "commands.moderation.stale_warning"));
  });

  it("filters unknown/malformed checkbox values and writes recognized definitions", async () => {
    let passedSelectedValues: unknown = null;
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-valid",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      takeCheckboxValues: () => ["servermemories", "malicious_payload", "promptsnapshot", "unknown_option"],
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async (input) => {
          passedSelectedValues = input.selectedValues;
          return {
            status: "success",
            changes: [
              {
                dbColumn: "prompt_snapshot_enabled",
                isEnabled: true,
                value: "promptsnapshot",
                labelKey: "commands.server.member-permissions.promptsnapshot_label",
              },
            ],
            patch: { prompt_snapshot_enabled: true },
          };
        },
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(passedSelectedValues).toEqual(["servermemories", "promptsnapshot"]);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_updated"));
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_updated_detail"));
  });

  it("handles unchanged submission with informational receipt and no DB write", async () => {
    const resolveCalls: boolean[] = [];
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-unchanged",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async (_interaction, forceRefresh) => {
        resolveCalls.push(Boolean(forceRefresh));
        return createScopeData();
      },
      takeCheckboxValues: () => ["servermemories", "sampledialogues"],
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => ({
          status: "unchanged",
          changes: [],
          patch: {},
        }),
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(resolveCalls).toEqual([false, false]);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_unchanged"));
    expect(serialized).toContain(
      serializedPanelProse("> Member permissions already match the requested state. No write was needed."),
    );
  });

  it("handles repository failure on submit with failure receipt", async () => {
    const resolveCalls: boolean[] = [];
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-failure",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async (_interaction, forceRefresh) => {
        resolveCalls.push(Boolean(forceRefresh));
        return createScopeData();
      },
      takeCheckboxValues: () => [],
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => ({
          status: "failure",
          changes: [],
          patch: {},
        }),
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(resolveCalls).toEqual([false, false]);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_failed"));
    expect(serialized).toContain(
      serializedPanelProse("> The database write failed or permissions changed. Retry to refresh current settings."),
    );
  });

  it("reloads and repaints on successful submit, retaining receipt if post-write reload is unavailable", async () => {
    const resolveCalls: boolean[] = [];
    const editReplyCalls: unknown[] = [];

    const mockInteraction = {
      id: "int-postreload-unavail",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      customId: "moderation:v2:member-access-submit:en-US:nonce123",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async (_interaction, forceRefresh) => {
        resolveCalls.push(Boolean(forceRefresh));
        if (resolveCalls.length === 2) {
          return null;
        }
        return createScopeData();
      },
      takeCheckboxValues: () => ["attributelist"],
      operations: {
        ...moderationOperations,
        updateMemberPermissions: async () => ({
          status: "success",
          changes: [
            {
              dbColumn: "attribute_memteaching_enabled",
              isEnabled: true,
              value: "attributelist",
              labelKey: "commands.server.member-permissions.attributelist_label",
            },
          ],
          patch: { attribute_memteaching_enabled: true },
        }),
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["member-access-submit", "en-US", "nonce123"],
    });

    expect(resolveCalls).toEqual([false, false]);
    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_updated"));
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));
  });

  it("handles retry route with force refresh", async () => {
    const loadCalls: boolean[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:retry:en-US:member-access:none",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async () => {},
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async (_interaction, forceRefresh) => {
        loadCalls.push(Boolean(forceRefresh));
        return createScopeData();
      },
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["retry", "en-US", "member-access", "none"],
    });

    expect(loadCalls).toEqual([true]);
  });

  it("denies access when user lacks Manage Server permission", async () => {
    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:category:en-US:whitelist",
      guildId: "guild-1",
      memberPermissions: {
        has: () => false,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["category", "en-US", "whitelist"],
    });

    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
  });

  it("handles missing setup gracefully", async () => {
    const editReplyCalls: unknown[] = [];
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v2:category:en-US:whitelist",
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
      deferUpdate: async () => {},
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
    } as unknown as ButtonInteraction;

    const route = createModerationInteractionRoute({
      resolveScope: async () => null,
    });

    await route.execute({} as Client, mockInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["category", "en-US", "whitelist"],
    });

    const serialized = JSON.stringify(editReplyCalls[0]);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.not_setup"));
  });

  // v1 remove buttons carry no range index, which v2 requires; they must reach the outdated notice, not a crash.
  it("answers a v1 removal button with the outdated-panel notice", async () => {
    let replyPayload: unknown = null;
    const mockInteraction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "moderation:v1:user-blacklist-remove-open:en-US",
      locale: "en-US",
      reply: async (payload: unknown) => {
        replyPayload = payload;
      },
    } as unknown as ButtonInteraction;

    const handled = await dispatchGlobalInteraction({} as Client, mockInteraction);
    expect(handled).toBe(true);
    expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.outdated_panel"));
  });

  it("rejects slash command execution outside guild", async () => {
    const mockInteraction = {
      guildId: null,
      memberPermissions: null,
    } as unknown as ChatInputCommandInteraction;

    const payload = await buildInitialModerationPanel(mockInteraction, "en-US");
    expect(JSON.stringify(payload)).toContain(localizedCopy("en-US", "commands.moderation.guild_only"));
  });

  it("rejects slash command execution for non-managers", async () => {
    const mockInteraction = {
      guildId: "guild-1",
      memberPermissions: {
        has: () => false,
      },
    } as unknown as ChatInputCommandInteraction;

    const payload = await buildInitialModerationPanel(mockInteraction, "en-US");
    expect(JSON.stringify(payload)).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
  });

  it("renders initial panel on valid slash execution", async () => {
    const mockInteraction = {
      guildId: "guild-1",
      memberPermissions: {
        has: () => true,
      },
    } as unknown as ChatInputCommandInteraction;

    const payload = await buildInitialModerationPanel(mockInteraction, "en-US", {
      resolveScope: async () => createScopeData(),
    });

    const serialized = JSON.stringify(payload);
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.title"));
    expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.member_access_title"));
  });

  it("executes moderation command with ephemeral deferReply", async () => {
    const log: string[] = [];
    const mockInteraction = {
      deferReply: async (options: { flags?: number }) => {
        log.push(`deferReply:${options?.flags}`);
      },
      editReply: async () => {
        log.push("editReply");
      },
    } as unknown as ChatInputCommandInteraction;

    await executeModerationCommand(
      mockInteraction,
      "en-US",
      async () => ({ components: [], flags: MessageFlags.IsComponentsV2 }) as never,
    );

    expect(log).toEqual(["deferReply:64", "editReply"]);
  });

  describe("user-blacklist-add-open route", () => {
    it("denies user-blacklist-add-open when user lacks Manage Server without reading state or opening modal", async () => {
      let resolveUserBlacklistAddCalled = 0;
      let modalShown = 0;
      let replyPayload: unknown = null;

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => false,
        },
        reply: async (payload: unknown) => {
          replyPayload = payload;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveUserBlacklistAdd: async () => {
          resolveUserBlacklistAddCalled++;
          return { guildId: "guild-1", serverId: 1, readStatus: "fresh" };
        },
        showUserBlacklistAddModal: async () => {
          modalShown++;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-open", "en-US"],
      });

      expect(resolveUserBlacklistAddCalled).toBe(0);
      expect(modalShown).toBe(0);
      expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
    });

    it("rejects user-blacklist-add-open when workspace is not setup", async () => {
      let modalShown = 0;
      let replyPayload: unknown = null;

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        reply: async (payload: unknown) => {
          replyPayload = payload;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveUserBlacklistAdd: async () => null,
        showUserBlacklistAddModal: async () => {
          modalShown++;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-open", "en-US"],
      });

      expect(modalShown).toBe(0);
      expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.not_setup"));
    });

    it("rejects user-blacklist-add-open when read is unavailable or stale", async () => {
      let modalShown = 0;
      let replyPayload: unknown = null;

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        reply: async (payload: unknown) => {
          replyPayload = payload;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveUserBlacklistAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "unavailable",
        }),
        showUserBlacklistAddModal: async () => {
          modalShown++;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-open", "en-US"],
      });

      expect(modalShown).toBe(0);
      expect(JSON.stringify(replyPayload)).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));
    });

    it("opens user-blacklist-add without requiring server personalization", async () => {
      let modalShown = 0;
      let replyPayload: unknown = null;

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        reply: async (payload: unknown) => {
          replyPayload = payload;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveUserBlacklistAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
        }),
        showUserBlacklistAddModal: async () => {
          modalShown++;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-open", "en-US"],
      });

      expect(modalShown).toBe(1);
      expect(replyPayload).toBeNull();
    });

    it("opens User Blacklist Add raw modal with nonce without pre-deferral", async () => {
      let modalShownNonce = "";
      let replyCalled = 0;
      let deferCalled = 0;

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        reply: async () => {
          replyCalled++;
        },
        deferReply: async () => {
          deferCalled++;
        },
        deferUpdate: async () => {
          deferCalled++;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        createNonce: () => "testnonce_xyz",
        resolveUserBlacklistAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
        }),
        showUserBlacklistAddModal: async (_interaction, _locale, nonce) => {
          modalShownNonce = nonce;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-open", "en-US"],
      });

      expect(replyCalled).toBe(0);
      expect(deferCalled).toBe(0);
      expect(modalShownNonce).toBe("testnonce_xyz");
    });
  });

  describe("user-blacklist-add-submit route", () => {
    it("consumes transport on permission denial and editReplies terminal permission denied", async () => {
      let transportConsumed = 0;
      let editReplyPayload: unknown = null;

      const mockInteraction = {
        id: "interaction-deny-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => false,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyPayload = payload;
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        takeUserSelectValue: (interactionId, nonce) => {
          expect(interactionId).toBe("interaction-deny-1");
          expect(nonce).toBe("nonce123");
          transportConsumed++;
          return "123456789012345678";
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(transportConsumed).toBe(1);
      expect(JSON.stringify(editReplyPayload)).toContain(
        localizedCopy("en-US", "commands.moderation.permission_denied"),
      );
    });

    it("repaints with invalid_input receipt when user select transport is missing or malformed", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-malformed-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => undefined,
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toMatch(localizedProse("en-US", "commands.moderation.member_access_invalid_input"));
    });

    it("repaints with invalid_user receipt when user fetch fails", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-notfound-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => "123456789012345678",
        resolveUser: async () => null,
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(
        serializedPanelProse("> The selected user could not be found or is no longer in this server."),
      );
    });

    it("repaints with cannot_blacklist_bot receipt when target user is a bot", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-bot-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => "999999999999999999",
        resolveUser: async () => ({ id: "999999999999999999", username: "MusicBot", bot: true }),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(
        localizedCopy("en-US", "commands.moderation.user_blacklist_add_cannot_blacklist_bot"),
      );
      expect(serialized).toContain("MusicBot");
    });

    it("successfully adds user to blacklist, reloads scope without force refresh, and repaints user-blacklist page with success receipt", async () => {
      const editReplyCalls: unknown[] = [];
      const resolveCalls: boolean[] = [];
      let addOperationInput: unknown = null;

      const mockInteraction = {
        id: "interaction-success-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const initialScope = createScopeData();
      const updatedScope = {
        ...initialScope,
        userBlacklist: {
          personalizationUserIds: ["u1", "123456789012345678"],
          personaBlocks: [],
        },
      };

      const route = createModerationInteractionRoute({
        resolveScope: async (_interaction, forceRefresh) => {
          resolveCalls.push(Boolean(forceRefresh));
          return resolveCalls.length === 1 ? initialScope : updatedScope;
        },
        takeUserSelectValue: () => "123456789012345678",
        resolveUser: async () => ({ id: "123456789012345678", username: "AnonMember", bot: false }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "unchanged", changes: [], patch: {} }),
          addUserToBlacklist: async (input) => {
            addOperationInput = input;
            return { status: "success", targetUserId: "123456789012345678" };
          },
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(resolveCalls).toEqual([false, false]);
      expect(addOperationInput).toEqual({
        guildId: "guild-1",
        serverId: 1,
        targetUserId: "123456789012345678",
        isBot: false,
      });
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_add_success"));
      expect(serialized).toContain("Added AnonMember to the blacklist.");
      expect(serialized).toContain("Blacklisted Members `(2)`");
      expect(serialized).toContain("<@123456789012345678>");
    });

    it("repaints with already_blacklisted info receipt when user is already blacklisted", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-dup-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => "123456789012345678",
        resolveUser: async () => ({ id: "123456789012345678", username: "ExistingMember", bot: false }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "unchanged", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "already_blacklisted", targetUserId: "123456789012345678" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(
        localizedCopy("en-US", "commands.moderation.user_blacklist_add_already_blacklisted"),
      );
      expect(serialized).toContain("ExistingMember is already on the blacklist.");
    });

    it("resolves member through current guild membership using default user resolver", async () => {
      let fetchedMemberId = "";
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-guild-resolve-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        guild: {
          members: {
            fetch: async (id: string) => {
              fetchedMemberId = id;
              return {
                user: { id, username: "Mirri", bot: false },
              };
            },
          },
        },
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const initialScope = createScopeData();
      const updatedScope = {
        ...initialScope,
        userBlacklist: {
          personalizationUserIds: ["u1", "123456789012345678"],
          personaBlocks: [],
        },
      };

      let resolveCount = 0;
      const route = createModerationInteractionRoute({
        resolveScope: async () => {
          resolveCount++;
          return resolveCount === 1 ? initialScope : updatedScope;
        },
        takeUserSelectValue: () => "123456789012345678",
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "unchanged", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "123456789012345678" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(fetchedMemberId).toBe("123456789012345678");
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_add_success"));
      expect(serialized).toContain("Added Mirri to the blacklist.");
    });

    it("repaints with invalid_user receipt when default user resolver member fetch fails or outside guild", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        id: "interaction-guild-fail-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce123",
        guildId: "guild-1",
        guild: {
          members: {
            fetch: async () => {
              throw new Error("Unknown Member");
            },
          },
        },
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => "123456789012345678",
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce123"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(
        serializedPanelProse("> The selected user could not be found or is no longer in this server."),
      );
    });
  });

  describe("user-blacklist-remove-prompt route", () => {
    it("denies user-blacklist-remove-prompt when actor lacks Manage Server without reading state", async () => {
      let resolveCalled = 0;
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-prompt:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => false,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => {
          resolveCalled++;
          return createScopeData();
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-prompt", "en-US", "personalization", "123456789012345678"],
      });

      expect(resolveCalled).toBe(0);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
    });

    it("rejects user-blacklist-remove-prompt when workspace is not setup", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-prompt:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => null,
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-prompt", "en-US", "personalization", "123456789012345678"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.not_setup"));
    });

    it("repaints with changed_receipt when personalization target was already removed", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-prompt:en-US:personalization:999999999999999999",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          userBlacklist: {
            personalizationUserIds: ["other-user"],
            personaBlocks: [],
          },
        }),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-prompt", "en-US", "personalization", "999999999999999999"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.changed_receipt"));
      expect(serialized).toMatch(localizedProse("en-US", "commands.moderation.changed_receipt_detail"));
    });

    it("renders confirmation view when personalization target exists", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-prompt:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          userBlacklist: {
            personalizationUserIds: ["123456789012345678"],
            personaBlocks: [],
          },
        }),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-prompt", "en-US", "personalization", "123456789012345678"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_remove_title"));
      expect(serialized).toContain("Remove <@123456789012345678> from the blacklist?");
      expect(serialized).toContain("user-blacklist-remove-confirm");
      expect(serialized).toContain("user-blacklist-remove-cancel");
    });
  });

  describe("user-blacklist-remove-cancel route", () => {
    it("returns to canonical user-blacklist page without performing writes", async () => {
      let writeCalled = 0;
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-cancel:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => {
            writeCalled++;
            return { status: "success", changes: [], patch: {} };
          },
          addUserToBlacklist: async () => {
            writeCalled++;
            return { status: "success", targetUserId: "u" };
          },
          removeUserFromBlacklist: async () => {
            writeCalled++;
            return { status: "success", targetUserId: "u" };
          },
          removePersonaUserBlock: async () => {
            writeCalled++;
            return {
              status: "success",
              personaId: 1,
              targetUserId: "u",
              block: {
                server_id: 1,
                persona_id: 1,
                user_disc_id: "u",
                block_type: "mute",
                reason: "",
                expires_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
              },
            };
          },
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-cancel", "en-US"],
      });

      expect(writeCalled).toBe(0);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.category_user_blacklist"));
    });
  });

  describe("user-blacklist-remove-confirm route", () => {
    it("denies user-blacklist-remove-confirm when actor lacks Manage Server", async () => {
      let removeCalled = 0;
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => false,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => {
            removeCalled++;
            return { status: "success", targetUserId: "123456789012345678" };
          },
          removePersonaUserBlock: async () => ({ status: "not_found", personaId: 1, targetUserId: "u" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "personalization", "123456789012345678"],
      });

      expect(removeCalled).toBe(0);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
    });

    it("rejects user-blacklist-remove-confirm when readStatus is stale", async () => {
      let removeCalled = 0;
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          readStatus: "stale",
          userBlacklist: {
            personalizationUserIds: ["123456789012345678"],
            personaBlocks: [],
          },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => {
            removeCalled++;
            return { status: "success", targetUserId: "123456789012345678" };
          },
          removePersonaUserBlock: async () => ({ status: "not_found", personaId: 1, targetUserId: "u" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "personalization", "123456789012345678"],
      });

      expect(removeCalled).toBe(0);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_remove_failed"));
      expect(serialized).toMatch(localizedProse("en-US", "commands.moderation.stale_warning"));
    });

    it("returns changed_receipt without write when target disappeared before confirm", async () => {
      let removeCalled = 0;
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          userBlacklist: {
            personalizationUserIds: [],
            personaBlocks: [],
          },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => {
            removeCalled++;
            return { status: "success", targetUserId: "123456789012345678" };
          },
          removePersonaUserBlock: async () => ({ status: "not_found", personaId: 1, targetUserId: "u" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "personalization", "123456789012345678"],
      });

      expect(removeCalled).toBe(0);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.changed_receipt"));
    });

    it("successfully removes personalization entry, verifies forceRefresh=false on reload, and renders receipt", async () => {
      const scopeLoadLog: boolean[] = [];
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async (_interaction, forceRefresh) => {
          scopeLoadLog.push(Boolean(forceRefresh));
          return {
            ...createScopeData(),
            userBlacklist: {
              personalizationUserIds: scopeLoadLog.length === 1 ? ["123456789012345678"] : [],
              personaBlocks: [],
            },
          };
        },
        resolveUser: async () => ({ id: "123456789012345678", username: "alice", bot: false }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async ({ targetUserId }) => ({
            status: "success",
            targetUserId,
          }),
          removePersonaUserBlock: async () => ({ status: "not_found", personaId: 1, targetUserId: "u" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "personalization", "123456789012345678"],
      });

      expect(scopeLoadLog).toEqual([false, false]);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_remove_success"));
      expect(serialized).toContain("Removed alice from the blacklist.");
    });

    it("successfully removes persona block entry, verifies forceRefresh=false on reload, and renders receipt with persona name", async () => {
      const scopeLoadLog: boolean[] = [];
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:persona-block:2:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const mockBlock = {
        server_id: 1,
        persona_id: 2,
        user_disc_id: "123456789012345678",
        block_type: "mute" as const,
        reason: "spam",
        expires_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        persona_name: "Tomori",
      };

      const route = createModerationInteractionRoute({
        resolveScope: async (_interaction, forceRefresh) => {
          scopeLoadLog.push(Boolean(forceRefresh));
          return {
            ...createScopeData(),
            userBlacklist: {
              personalizationUserIds: [],
              personaBlocks: scopeLoadLog.length === 1 ? [mockBlock] : [],
            },
          };
        },
        resolveUser: async () => ({ id: "123456789012345678", username: "bob", bot: false }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "not_found", targetUserId: "u" }),
          removePersonaUserBlock: async ({ personaId, targetUserId }) => ({
            status: "success",
            personaId,
            targetUserId,
            block: mockBlock,
          }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "persona-block", "2", "123456789012345678"],
      });

      expect(scopeLoadLog).toEqual([false, false]);
      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_remove_success"));
      expect(serialized).toContain("Removed bob's restriction on **Tomori**.");
    });

    it("renders failure receipt when removal operation fails", async () => {
      const editReplyCalls: unknown[] = [];

      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplyCalls.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          userBlacklist: {
            personalizationUserIds: ["123456789012345678"],
            personaBlocks: [],
          },
        }),
        resolveUser: async () => ({ id: "123456789012345678", username: "alice", bot: false }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({
            status: "failure",
            targetUserId: "123456789012345678",
          }),
          removePersonaUserBlock: async () => ({ status: "failure", personaId: 1, targetUserId: "u" }),
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-remove-confirm", "en-US", "personalization", "123456789012345678"],
      });

      expect(editReplyCalls).toHaveLength(1);
      const serialized = JSON.stringify(editReplyCalls[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_remove_failed"));
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.user_blacklist_add_failed_detail"));
    });
  });

  describe("whitelist-channel-add-open route execution", () => {
    it("denies unauthorized button clicks before resolving channel add data", async () => {
      let resolveAddCalled = false;
      const replies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => false,
        },
        reply: async (payload: unknown) => {
          replies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveWhitelistChannelAdd: async () => {
          resolveAddCalled = true;
          return null;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-open", "en-US"],
      });

      expect(resolveAddCalled).toBe(false);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toEqual({
        content: "You need `Manage Server` permission to use this moderation panel.",
        flags: 64,
      });
    });

    it("opens whitelist channel add modal with nonce on fresh scope", async () => {
      let shownModalNonce = "";
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-add-open:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveWhitelistChannelAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          config: {
            cooldown_type: CooldownType.PER_CHANNEL,
            cooldown_length: 15,
          },
        }),
        createNonce: () => "testnonce789",
        showWhitelistChannelAddModal: async (_interaction, _locale, nonce) => {
          shownModalNonce = nonce;
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-open", "en-US"],
      });

      expect(shownModalNonce).toBe("testnonce789");
    });
  });

  describe("whitelist-channel-add-submit route execution", () => {
    it("validates channel type is GuildText, invokes upsert, and renders success receipt", async () => {
      let deferred = false;
      const editReplies: unknown[] = [];
      const mockModal = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {
          deferred = true;
        },
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "25",
        },
      } as unknown as ModalSubmitInteraction;

      let upsertArgs: unknown = null;
      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => "1",
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        resolveWhitelistChannelAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          config: { cooldown_type: null, cooldown_length: null },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async (args) => {
            upsertArgs = args;
            return {
              status: "success",
              channelId: args.channelId,
              cooldownType: args.requestedCooldownType ?? null,
              cooldownLength: args.requestedCooldownLength ?? null,
              isUpdate: false,
            };
          },
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      await route.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(deferred).toBe(true);
      expect(upsertArgs).toEqual({
        guildId: "guild-1",
        serverId: 1,
        channelId: "111222333444555666",
        requestedCooldownType: CooldownType.PER_USER,
        requestedCooldownLength: 25,
        serverConfig: { cooldown_type: null, cooldown_length: null },
      });
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_channel_add_success"));
      expect(serialized).toContain("Updated whitelist settings for #bot-lounge.");
    });

    it("rejects non-text channel types with error receipt", async () => {
      const editReplies: unknown[] = [];
      const mockModal = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "",
        },
      } as unknown as ModalSubmitInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => undefined,
        resolveChannel: async (_i, id) => ({ id, name: "general-voice", type: ChannelType.GuildVoice }),
        resolveWhitelistChannelAdd: async () => null,
      });

      await route.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(
        serializedPanelProse(
          "> The selected channel could not be found, is not a text channel, or is no longer in this server.",
        ),
      );
    });

    it("handles unchanged status with info receipt", async () => {
      const editReplies: unknown[] = [];
      const mockModal = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "",
        },
      } as unknown as ModalSubmitInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => undefined,
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        resolveWhitelistChannelAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          config: { cooldown_type: null, cooldown_length: null },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async (args) => ({
            status: "unchanged",
            channelId: args.channelId,
            cooldownType: null,
            cooldownLength: null,
          }),
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      await route.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_channel_add_unchanged"));
      expect(serialized).toContain(
        serializedPanelProse(
          "> Whitelist settings for #bot-lounge already match the requested state. No write was needed.",
        ),
      );
    });

    it("rejects add submit without upsert when resolveWhitelistChannelAdd returns null or stale", async () => {
      let upsertCalled = 0;
      const editReplies: unknown[] = [];
      const mockModal = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "10",
        },
      } as unknown as ModalSubmitInteraction;

      const nullRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => "1",
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        resolveWhitelistChannelAdd: async () => null,
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => {
            upsertCalled++;
            return { status: "success", channelId: "c", cooldownType: null, cooldownLength: null, isUpdate: false };
          },
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      await nullRoute.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(upsertCalled).toBe(0);
      expect(JSON.stringify(editReplies[0])).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));

      const staleRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => "1",
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        resolveWhitelistChannelAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "stale",
          config: { cooldown_type: null, cooldown_length: null },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => {
            upsertCalled++;
            return { status: "success", channelId: "c", cooldownType: null, cooldownLength: null, isUpdate: false };
          },
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      await staleRoute.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(upsertCalled).toBe(0);
      expect(JSON.stringify(editReplies[1])).toMatch(localizedProse("en-US", "commands.moderation.stale_warning"));
    });

    it("rejects add submit without upsert when resolveWhitelistChannelAdd has mismatched guild or server identity", async () => {
      let upsertCalled = 0;
      const editReplies: unknown[] = [];
      const mockModal = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "10",
        },
      } as unknown as ModalSubmitInteraction;

      const mismatchedRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => "1",
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        resolveWhitelistChannelAdd: async () => ({
          guildId: "other-guild",
          serverId: 999,
          readStatus: "fresh",
          config: { cooldown_type: null, cooldown_length: null },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => {
            upsertCalled++;
            return { status: "success", channelId: "c", cooldownType: null, cooldownLength: null, isUpdate: false };
          },
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      await mismatchedRoute.execute({} as Client, mockModal, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(upsertCalled).toBe(0);
      expect(JSON.stringify(editReplies[0])).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));
    });
  });

  describe("whitelist-channel-remove routes execution", () => {
    it("renders confirmation view on whitelist-channel-remove-prompt", async () => {
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-prompt:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-prompt", "en-US", "111222333444555666"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain("### Remove Whitelisted Channel");
      expect(serialized).toContain("moderation:v2:whitelist-channel-remove-confirm:en-US:111222333444555666");
      expect(serialized).toContain("moderation:v2:whitelist-channel-remove-cancel:en-US");
    });

    it("renders changed-state receipt and does not show confirmation when channel disappears before remove prompt", async () => {
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-prompt:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async () => null,
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-prompt", "en-US", "111222333444555666"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_changed_receipt"));
      expect(serialized).not.toContain("### Remove Whitelisted Channel");
      expect(serialized).not.toContain("whitelist-channel-remove-confirm");
    });

    it("renders changed-state receipt and does not show confirmation when channel type is not GuildText on prompt", async () => {
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-prompt:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async (_i, id) => ({ id, name: "voice-chat", type: ChannelType.GuildVoice }),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-prompt", "en-US", "111222333444555666"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_changed_receipt"));
      expect(serialized).not.toContain("### Remove Whitelisted Channel");
      expect(serialized).not.toContain("whitelist-channel-remove-confirm");
    });

    it("cancels removal and returns to normal panel on whitelist-channel-remove-cancel", async () => {
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-cancel:en-US",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-cancel", "en-US"],
      });

      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).not.toContain("### Remove Whitelisted Channel");
      expect(serialized).toContain("### Whitelisted Channels");
    });

    it("removes channel and renders success receipt on whitelist-channel-remove-confirm", async () => {
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-confirm:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      let removeArgs: unknown = null;
      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async (_i, id) => ({ id, name: "bot-lounge", type: ChannelType.GuildText }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => ({
            status: "success",
            channelId: "c",
            cooldownType: null,
            cooldownLength: null,
            isUpdate: false,
          }),
          removeWhitelistChannel: async (args) => {
            removeArgs = args;
            return { status: "success", channelId: args.channelId };
          },
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-confirm", "en-US", "111222333444555666"],
      });

      expect(removeArgs).toEqual({
        guildId: "guild-1",
        serverId: 1,
        channelId: "111222333444555666",
      });
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_channel_remove_success"));
      expect(serialized).toContain("Removed #bot-lounge from the whitelist.");
    });

    it("renders changed-state receipt and does not call remove operation when channel disappears immediately before confirm", async () => {
      let removeCalled = 0;
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-confirm:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async () => null,
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => ({
            status: "success",
            channelId: "c",
            cooldownType: null,
            cooldownLength: null,
            isUpdate: false,
          }),
          removeWhitelistChannel: async () => {
            removeCalled++;
            return { status: "success", channelId: "111222333444555666" };
          },
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-confirm", "en-US", "111222333444555666"],
      });

      expect(removeCalled).toBe(0);
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_changed_receipt"));
    });

    it("renders changed-state receipt and does not call remove operation when resolved channel is not GuildText immediately before confirm", async () => {
      let removeCalled = 0;
      const editReplies: unknown[] = [];
      const mockInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:whitelist-channel-remove-confirm:en-US:111222333444555666",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => ({
          ...createScopeData(),
          whitelist: {
            channels: [
              {
                server_id: 1,
                channel_disc_id: "111222333444555666",
                cooldown_type: null,
                cooldown_length: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
            personaChannels: [],
            roles: [],
            personaNames: new Map(),
          },
        }),
        resolveChannel: async (_i, id) => ({ id, name: "stage-channel", type: ChannelType.GuildStageVoice }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => ({
            status: "success",
            channelId: "c",
            cooldownType: null,
            cooldownLength: null,
            isUpdate: false,
          }),
          removeWhitelistChannel: async () => {
            removeCalled++;
            return { status: "success", channelId: "111222333444555666" };
          },
        },
      });

      await route.execute({} as Client, mockInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-remove-confirm", "en-US", "111222333444555666"],
      });

      expect(removeCalled).toBe(0);
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(localizedCopy("en-US", "commands.moderation.whitelist_changed_receipt"));
    });
  });

  describe("default Discord resolvers", () => {
    it("defaultResolveUser does not fall back to client.users.fetch when member is not in guild", async () => {
      let memberFetchCalled = false;
      let clientFetchCalled = false;

      const mockInteraction = {
        guild: {
          members: {
            fetch: async () => {
              memberFetchCalled = true;
              throw new Error("Unknown Member");
            },
          },
        },
        client: {
          users: {
            fetch: async (id: string) => {
              clientFetchCalled = true;
              return { id, username: "global-user", bot: false };
            },
          },
        },
      } as unknown as ModalSubmitInteraction;

      let addCalled = 0;
      const editReplies: unknown[] = [];

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeUserSelectValue: () => "123456789012345678",
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => {
            addCalled++;
            return { status: "success", targetUserId: "123456789012345678" };
          },
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => ({
            status: "success",
            channelId: "c",
            cooldownType: null,
            cooldownLength: null,
            isUpdate: false,
          }),
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      const modalSubmit = {
        ...mockInteraction,
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
      } as unknown as ModalSubmitInteraction;

      await route.execute({} as Client, modalSubmit, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "testnonce789"],
      });

      expect(memberFetchCalled).toBe(true);
      expect(clientFetchCalled).toBe(false);
      expect(addCalled).toBe(0);
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(
        serializedPanelProse("> The selected user could not be found or is no longer in this server."),
      );
    });

    it("defaultResolveChannel does not fall back to client.channels.fetch when channel is not in guild", async () => {
      let guildChannelFetchCalled = false;
      let clientChannelFetchCalled = false;

      const mockInteraction = {
        guild: {
          channels: {
            fetch: async () => {
              guildChannelFetchCalled = true;
              throw new Error("Unknown Channel");
            },
          },
        },
        client: {
          channels: {
            fetch: async (id: string) => {
              clientChannelFetchCalled = true;
              return { id, name: "external-channel", type: ChannelType.GuildText };
            },
          },
        },
      } as unknown as ModalSubmitInteraction;

      let upsertCalled = 0;
      const editReplies: unknown[] = [];

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        takeChannelSelectValue: () => "111222333444555666",
        takeCooldownTypeSelectValue: () => undefined,
        resolveWhitelistChannelAdd: async () => ({
          guildId: "guild-1",
          serverId: 1,
          readStatus: "fresh",
          config: { cooldown_type: null, cooldown_length: null },
        }),
        operations: {
          ...moderationOperations,
          updateMemberPermissions: async () => ({ status: "success", changes: [], patch: {} }),
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removeUserFromBlacklist: async () => ({ status: "success", targetUserId: "u" }),
          removePersonaUserBlock: async () => ({
            status: "success",
            personaId: 1,
            targetUserId: "u",
            block: {
              server_id: 1,
              persona_id: 1,
              user_disc_id: "u",
              block_type: "mute",
              reason: "",
              expires_at: new Date(),
            },
          }),
          upsertWhitelistChannel: async () => {
            upsertCalled++;
            return { status: "success", channelId: "c", cooldownType: null, cooldownLength: null, isUpdate: false };
          },
          removeWhitelistChannel: async () => ({ status: "success", channelId: "c" }),
        },
      });

      const modalSubmit = {
        ...mockInteraction,
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:whitelist-channel-add-submit:en-US:testnonce789",
        guildId: "guild-1",
        memberPermissions: {
          has: () => true,
        },
        deferUpdate: async () => {},
        editReply: async (payload: unknown) => {
          editReplies.push(payload);
        },
        fields: {
          getTextInputValue: () => "",
        },
      } as unknown as ModalSubmitInteraction;

      await route.execute({} as Client, modalSubmit, {
        namespace: "moderation",
        version: "v2",
        segments: ["whitelist-channel-add-submit", "en-US", "testnonce789"],
      });

      expect(guildChannelFetchCalled).toBe(true);
      expect(clientChannelFetchCalled).toBe(false);
      expect(upsertCalled).toBe(0);
      expect(editReplies).toHaveLength(1);
      const serialized = JSON.stringify(editReplies[0]);
      expect(serialized).toContain(
        serializedPanelProse(
          "> The selected channel could not be found, is not a text channel, or is no longer in this server.",
        ),
      );
    });
  });
});

describe("moderation bulk removal routes", () => {
  it("opens one blacklist checklist modal without pre-deferring and snapshots the presented entries", async () => {
    const events: string[] = [];
    const interaction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      reply: async () => events.push("reply"),
      deferUpdate: async () => events.push("defer"),
    } as unknown as ButtonInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () =>
        createScopeData({
          userBlacklist: {
            personalizationUserIds: ["123456789012345678"],
            personaBlocks: [],
          },
        }),
      resolveUser: async () => ({
        id: "123456789012345678",
        username: "bau_h",
        displayName: "Bau",
        bot: false,
      }),
      createNonce: () => "bulk_nonce",
      storeRemovalSnapshot: (nonce, values) => events.push(`snapshot:${nonce}:${values.join(",")}`),
      showRemovalModal: async (_interaction, _locale, nonce, action, options) => {
        events.push(`modal:${nonce}:${action}:${options[0]?.label}`);
      },
    });
    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["user-blacklist-remove-open", "en-US", "0"],
    });
    expect(events).toEqual(["snapshot:bulk_nonce:u:123456789012345678", "modal:bulk_nonce:user-blacklist:Bau (bau_h)"]);
  });

  it("removes only unchecked entries from the modal snapshot", async () => {
    const writes: unknown[] = [];
    const scope = createScopeData({
      userBlacklist: {
        personalizationUserIds: ["123456789012345678", "223456789012345678"],
        personaBlocks: [],
      },
    });
    const interaction = {
      id: "submit-1",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async () => undefined,
    } as unknown as ModalSubmitInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () => scope,
      takeRemovalSnapshot: () => ["u:123456789012345678", "u:223456789012345678"],
      takeRemovalCheckboxValues: (_id, _nonce, index) => (index === 0 ? ["u:223456789012345678"] : undefined),
      operations: {
        ...moderationOperations,
        removeUserBlacklistBatch: async (input) => {
          writes.push(input);
          return { status: "success", removedPersonalizationCount: 1, removedPersonaBlocks: [] };
        },
      },
    });
    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["user-blacklist-remove-submit", "en-US", "bulk_nonce"],
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ personalizationUserIds: ["123456789012345678"], personaBlockKeys: [] });
  });

  it("gives Remove the page the panel shows", () => {
    const ids = blacklistIds(MODERATION_PANEL_RANGE_SIZE * 5 + 1);
    const payload = buildModerationPanelPayload({
      locale: "en-US",
      category: "user-blacklist",
      whitelistPage: "channels",
      rangeIndex: 5,
      data: createScopeData({ userBlacklist: { personalizationUserIds: ids, personaBlocks: [] } }),
    });
    expect(JSON.stringify(payload)).toContain(
      buildModerationRouteId({ action: "user-blacklist-remove-open", locale: "en-US", rangeIndex: 5 }),
    );
  });

  it("opens a later page's removal modal with only that page's entries", async () => {
    const ids = blacklistIds(MODERATION_PANEL_RANGE_SIZE * 5 + 1);
    const events: string[] = [];
    const interaction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      reply: async () => events.push("reply"),
    } as unknown as ButtonInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData({ userBlacklist: { personalizationUserIds: ids, personaBlocks: [] } }),
      resolveUser: async () => null,
      createNonce: () => "page_nonce",
      storeRemovalSnapshot: (nonce, values) => events.push(`snapshot:${nonce}:${values.join(",")}`),
      showRemovalModal: async (_interaction, _locale, nonce, action, options) => {
        events.push(`modal:${nonce}:${action}:${options.length}`);
      },
    });
    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["user-blacklist-remove-open", "en-US", "5"],
    });
    expect(events).toEqual([`snapshot:page_nonce:u:${ids.at(-1)}`, "modal:page_nonce:user-blacklist:1"]);
  });
});

describe("moderation whitelist role routes", () => {
  it("opens the Role Select modal without pre-deferring or loading the full moderation scope", async () => {
    let deferred = false;
    let fullScopeReads = 0;
    let shownNonce = "";
    const interaction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      deferUpdate: async () => {
        deferred = true;
      },
      reply: async () => undefined,
    } as unknown as ButtonInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () => {
        fullScopeReads++;
        return createScopeData();
      },
      resolveWhitelistRoleAdd: async () => ({
        guildId: "guild-1",
        serverId: 1,
        readStatus: "fresh",
        config: { cooldown_type: null, cooldown_length: null },
      }),
      createNonce: () => "roleNonce",
      showWhitelistRoleAddModal: async (_interaction, _locale, nonce) => {
        shownNonce = nonce;
      },
    });

    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-add-open", "en-US"],
    });

    expect(deferred).toBe(false);
    expect(fullScopeReads).toBe(0);
    expect(shownNonce).toBe("roleNonce");
  });

  it("adds a current guild role and rejects the everyone role before writing", async () => {
    const writes: string[] = [];
    const edits: unknown[] = [];
    const interaction = {
      id: "modal-role",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
    } as unknown as ModalSubmitInteraction;
    const roleScope = {
      guildId: "guild-1",
      serverId: 1,
      readStatus: "fresh" as const,
      config: { cooldown_type: null, cooldown_length: null },
    };
    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      resolveWhitelistRoleAdd: async () => roleScope,
      takeRoleSelectValue: () => "123456789012345678",
      resolveRole: async (_interaction, id) => ({ id, name: "Members" }),
      operations: {
        ...moderationOperations,
        addWhitelistRole: async (input) => {
          writes.push(input.roleId);
          return { status: "success", roleId: input.roleId };
        },
      },
    });

    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-add-submit", "en-US", "nonce123"],
    });
    expect(writes).toEqual(["123456789012345678"]);
    expect(JSON.stringify(edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.moderation.whitelist_role_add_success"),
    );

    const everyoneRoute = createModerationInteractionRoute({
      resolveScope: async () => createScopeData({ guildId: "123456789012345678" }),
      resolveWhitelistRoleAdd: async () => ({ ...roleScope, guildId: "123456789012345678" }),
      takeRoleSelectValue: () => "123456789012345678",
      resolveRole: async (_interaction, id) => ({ id, name: "@everyone" }),
      operations: {
        ...moderationOperations,
        addWhitelistRole: async (input) => {
          writes.push(input.roleId);
          return { status: "success", roleId: input.roleId };
        },
      },
    });
    const everyoneInteraction = {
      ...interaction,
      guildId: "123456789012345678",
    } as unknown as ModalSubmitInteraction;
    await everyoneRoute.execute({} as Client, everyoneInteraction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-add-submit", "en-US", "nonce123"],
    });
    expect(writes).toHaveLength(1);
    expect(JSON.stringify(edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.moderation.whitelist_role_add_everyone"),
    );
  });

  it("re-resolves a whitelisted role before prompt and again before the confirmed write", async () => {
    let resolves = 0;
    let removes = 0;
    const edits: unknown[] = [];
    const roleId = "123456789012345678";
    const scope = createScopeData({
      whitelist: {
        channels: [],
        personaChannels: [],
        roles: [{ server_id: 1, role_disc_id: roleId, created_at: new Date(), updated_at: new Date() }],
        personaNames: new Map(),
      },
    });
    const interaction = {
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      guildId: "guild-1",
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
    } as unknown as ButtonInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () => scope,
      resolveRole: async (_interaction, id) => {
        resolves++;
        return { id, name: "Members" };
      },
      operations: {
        ...moderationOperations,
        removeWhitelistRole: async (input) => {
          removes++;
          return { status: "success", roleId: input.roleId };
        },
      },
    });

    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-remove-prompt", "en-US", roleId],
    });
    expect(JSON.stringify(edits.at(-1))).toContain("whitelist-role-remove-confirm");

    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-remove-confirm", "en-US", roleId],
    });
    expect(resolves).toBe(2);
    expect(removes).toBe(1);
    expect(JSON.stringify(edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.moderation.whitelist_role_remove_success"),
    );
  });

  it("uses the current guild role manager and does not write when the selected role disappeared", async () => {
    let writes = 0;
    let fetches = 0;
    const edits: unknown[] = [];
    const interaction = {
      id: "modal-role-default-resolver",
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => true,
      guildId: "guild-1",
      guild: {
        roles: {
          fetch: async () => {
            fetches++;
            return null;
          },
        },
      },
      memberPermissions: { has: () => true },
      deferUpdate: async () => undefined,
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
    } as unknown as ModalSubmitInteraction;
    const route = createModerationInteractionRoute({
      resolveScope: async () => createScopeData(),
      resolveWhitelistRoleAdd: async () => ({
        guildId: "guild-1",
        serverId: 1,
        readStatus: "fresh",
        config: { cooldown_type: null, cooldown_length: null },
      }),
      takeRoleSelectValue: () => "123456789012345678",
      operations: {
        ...moderationOperations,
        addWhitelistRole: async (input) => {
          writes++;
          return { status: "success", roleId: input.roleId };
        },
      },
    });

    await route.execute({} as Client, interaction, {
      namespace: "moderation",
      version: "v2",
      segments: ["whitelist-role-add-submit", "en-US", "nonce123"],
    });

    expect(fetches).toBe(1);
    expect(writes).toBe(0);
    expect(JSON.stringify(edits.at(-1))).toContain(
      localizedCopy("en-US", "commands.moderation.whitelist_role_add_invalid_input"),
    );
  });

  describe("quota interaction routes", () => {
    it("quota-edit-open denies permission when member lacks ManageGuild", async () => {
      let modalOpened = false;
      const replies: unknown[] = [];
      const interaction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        guildId: "guild-1",
        memberPermissions: { has: () => false },
        reply: async (payload: unknown) => {
          replies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        showQuotaEditModal: async () => {
          modalOpened = true;
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-open", "en-US", "image"],
      });

      expect(modalOpened).toBe(false);
      expect(JSON.stringify(replies[0])).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
    });

    it("quota-edit-open refuses non-fresh read status", async () => {
      let modalOpened = false;
      const replies: unknown[] = [];
      const interaction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        guildId: "guild-1",
        memberPermissions: { has: () => true },
        reply: async (payload: unknown) => {
          replies.push(payload);
        },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData({ readStatus: "stale" }),
        showQuotaEditModal: async () => {
          modalOpened = true;
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-open", "en-US", "image"],
      });

      expect(modalOpened).toBe(false);
      expect(JSON.stringify(replies[0])).toContain(localizedCopy("en-US", "commands.moderation.unavailable"));
    });

    it("quota-edit-open opens modal with prefilled current quota values", async () => {
      let capturedLocale = "";
      let capturedQuotaType = "";
      let capturedConfig: unknown = null;
      let capturedNonce = "";

      const interaction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        guildId: "guild-1",
        memberPermissions: { has: () => true },
      } as unknown as ButtonInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () =>
          createScopeData({
            quotas: {
              image: { daily_user_quota: 15, serverwide_quota: 300, serverwide_quota_resets_in: 60 },
              text: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
              video: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
            },
          }),
        createNonce: () => "nonce_quota_open",
        showQuotaEditModal: async (_interaction, locale, quotaType, currentConfig, nonce) => {
          capturedLocale = locale;
          capturedQuotaType = quotaType;
          capturedConfig = currentConfig;
          capturedNonce = nonce;
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-open", "en-US", "image"],
      });

      expect(capturedLocale).toBe("en-US");
      expect(capturedQuotaType).toBe("image");
      expect(capturedConfig).toEqual({ daily_user_quota: 15, serverwide_quota: 300, serverwide_quota_resets_in: 60 });
      expect(capturedNonce).toBe("nonce_quota_open");
    });

    it("quota-edit-submit denies and does not write when permission is lost", async () => {
      let writes = 0;
      const edits: unknown[] = [];
      const interaction = {
        id: "modal-1",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        guildId: "guild-1",
        memberPermissions: { has: () => false },
        deferUpdate: async () => undefined,
        editReply: async (payload: unknown) => {
          edits.push(payload);
        },
        fields: {
          getTextInputValue: (fieldId: string) => {
            if (fieldId === buildQuotaModalFieldId("nonce_submit", "daily_user_quota")) return "10";
            if (fieldId === buildQuotaModalFieldId("nonce_submit", "serverwide_quota")) return "100";
            if (fieldId === buildQuotaModalFieldId("nonce_submit", "serverwide_quota_resets_in")) return "30";
            return "";
          },
        },
      } as unknown as ModalSubmitInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        operations: {
          ...moderationOperations,
          updateQuotaSettings: async () => {
            writes++;
            return { status: "success", quotaType: "image", appliedFields: ["daily_user_quota"] };
          },
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-submit", "en-US", "image", "nonce_submit"],
      });

      expect(writes).toBe(0);
      expect(JSON.stringify(edits[0])).toContain(localizedCopy("en-US", "commands.moderation.permission_denied"));
    });

    /** One submitted triple per bound the quota modal must refuse, with the field it violates. */
    const INVALID_QUOTA_VALUES: ReadonlyArray<readonly [string, string, string, string]> = [
      ["a daily quota below zero", "-1", "100", "30"],
      ["a daily quota above its cap", "101", "100", "30"],
      ["a fractional daily quota", "10.5", "100", "30"],
      ["a non-numeric daily quota", "abc", "100", "30"],
      ["a serverwide quota below zero", "10", "-5", "30"],
      ["a serverwide quota above its cap", "10", "100000", "30"],
      ["a reset window of zero days", "10", "100", "0"],
      ["a reset window beyond a year", "10", "100", "366"],
    ];

    /** The quota modal submit the table drives, carrying one submitted triple and its edit sink. */
    function quotaSubmitInteraction(
      daily: string,
      serverwide: string,
      resets: string,
      edits: unknown[],
    ): ModalSubmitInteraction {
      return {
        id: "modal-val",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        guildId: "guild-1",
        memberPermissions: { has: () => true },
        deferUpdate: async () => undefined,
        editReply: async (payload: unknown) => {
          edits.push(payload);
        },
        fields: {
          getTextInputValue: (fieldId: string) => {
            if (fieldId === buildQuotaModalFieldId("nonce_val", "daily_user_quota")) return daily;
            if (fieldId === buildQuotaModalFieldId("nonce_val", "serverwide_quota")) return serverwide;
            if (fieldId === buildQuotaModalFieldId("nonce_val", "serverwide_quota_resets_in")) return resets;
            return "";
          },
        },
      } as unknown as ModalSubmitInteraction;
    }

    it.each(
      INVALID_QUOTA_VALUES,
    )("quota-edit-submit refuses the write for %s", async (_label, daily, serverwide, resets) => {
      let writes = 0;
      const edits: unknown[] = [];
      const route = createModerationInteractionRoute({
        resolveScope: async () => createScopeData(),
        operations: {
          ...moderationOperations,
          updateQuotaSettings: async () => {
            writes++;
            return { status: "success", quotaType: "image", appliedFields: [] };
          },
        },
      });

      await route.execute({} as Client, quotaSubmitInteraction(daily, serverwide, resets, edits), {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-submit", "en-US", "image", "nonce_val"],
      });

      expect(writes).toBe(0);
      expect(JSON.stringify(edits.at(-1))).toMatch(
        localizedProse("en-US", "commands.moderation.quota_edit_invalid_input"),
      );
    });

    it("quota-edit-submit performs no write and repaints unchanged receipt when submitted values match stored values", async () => {
      let writes = 0;
      const edits: unknown[] = [];
      const interaction = {
        id: "modal-unchanged",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        guildId: "guild-1",
        memberPermissions: { has: () => true },
        deferUpdate: async () => undefined,
        editReply: async (payload: unknown) => {
          edits.push(payload);
        },
        fields: {
          getTextInputValue: (fieldId: string) => {
            if (fieldId === buildQuotaModalFieldId("nonce_unchanged", "daily_user_quota")) return "5";
            if (fieldId === buildQuotaModalFieldId("nonce_unchanged", "serverwide_quota")) return "50";
            if (fieldId === buildQuotaModalFieldId("nonce_unchanged", "serverwide_quota_resets_in")) return "30";
            return "";
          },
        },
      } as unknown as ModalSubmitInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () =>
          createScopeData({
            quotas: {
              image: { daily_user_quota: 5, serverwide_quota: 50, serverwide_quota_resets_in: 30 },
              text: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
              video: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
            },
          }),
        operations: {
          ...moderationOperations,
          updateQuotaSettings: async () => {
            writes++;
            return { status: "success", quotaType: "image", appliedFields: [] };
          },
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-submit", "en-US", "image", "nonce_unchanged"],
      });

      expect(writes).toBe(0);
      expect(JSON.stringify(edits.at(-1))).toMatch(localizedProse("en-US", "commands.moderation.quota_edit_unchanged"));
      expect(JSON.stringify(edits.at(-1))).toMatch(
        localizedProse("en-US", "commands.moderation.quota_edit_unchanged_detail"),
      );
    });

    it("quota-edit-submit calls updateQuotaSettings with parsed numbers and repaints success receipt", async () => {
      let capturedInput: unknown = null;
      let writes = 0;
      let resolves = 0;
      const edits: unknown[] = [];
      const interaction = {
        id: "modal-success",
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        guildId: "guild-1",
        memberPermissions: { has: () => true },
        deferUpdate: async () => undefined,
        editReply: async (payload: unknown) => {
          edits.push(payload);
        },
        fields: {
          getTextInputValue: (fieldId: string) => {
            if (fieldId === buildQuotaModalFieldId("nonce_success", "daily_user_quota")) return "20";
            if (fieldId === buildQuotaModalFieldId("nonce_success", "serverwide_quota")) return "500";
            if (fieldId === buildQuotaModalFieldId("nonce_success", "serverwide_quota_resets_in")) return "14";
            return "";
          },
        },
      } as unknown as ModalSubmitInteraction;

      const route = createModerationInteractionRoute({
        resolveScope: async () => {
          resolves++;
          return createScopeData({
            serverId: 42,
            quotas: {
              image: { daily_user_quota: 5, serverwide_quota: 50, serverwide_quota_resets_in: 30 },
              text: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
              video: { daily_user_quota: 0, serverwide_quota: 0, serverwide_quota_resets_in: 365 },
            },
          });
        },
        operations: {
          ...moderationOperations,
          updateQuotaSettings: async (input) => {
            writes++;
            capturedInput = input;
            return {
              status: "success",
              quotaType: input.quotaType,
              appliedFields: ["daily_user_quota", "serverwide_quota", "serverwide_quota_resets_in"],
            };
          },
        },
      });

      await route.execute({} as Client, interaction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-submit", "en-US", "image", "nonce_success"],
      });

      expect(writes).toBe(1);
      expect(resolves).toBe(2);
      expect(capturedInput).toEqual({
        serverId: 42,
        quotaType: "image",
        dailyUserQuota: 20,
        serverwideQuota: 500,
        serverwideQuotaResetsIn: 14,
      });
      expect(JSON.stringify(edits.at(-1))).toContain("Image Generation quotas updated");
    });

    /**
     * A `recordAction` that flattens each recorded action, so one case asserts exactly the one
     * panel_action its own route writes rather than a shared transcript of three routes.
     */
    function collectPanelActions(): {
      recorded: string[];
      recordAction: (input: { action: string; serverId: number; userDiscId: string }) => void;
    } {
      const recorded: string[] = [];
      return {
        recorded,
        recordAction: (input) => {
          recorded.push(`${input.action}:${input.serverId}:${input.userDiscId}`);
        },
      };
    }

    it("records panel_action telemetry for a user blacklist add", async () => {
      const { recorded, recordAction } = collectPanelActions();
      const addRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData({ serverId: 55 }),
        resolveUser: async () => ({ id: "123456789012345678", username: "target", bot: false }) as never,
        takeUserSelectValue: () => "123456789012345678",
        operations: {
          ...moderationOperations,
          addUserToBlacklist: async () => ({ status: "success", targetUserId: "123456789012345678" }),
        },
        recordAction,
      });
      const addInteraction = {
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:user-blacklist-add-submit:en-US:nonce12345678",
        guildId: "guild-1",
        user: { id: "mod-1" },
        memberPermissions: { has: () => true },
        deferUpdate: async () => {},
        editReply: async () => {},
        fields: { getTextInputValue: () => "123456789012345678" },
      } as unknown as ModalSubmitInteraction;

      await addRoute.execute({} as Client, addInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["user-blacklist-add-submit", "en-US", "nonce12345678"],
      });

      expect(recorded).toContain("moderation.workspace.user-blacklist.add:55:mod-1");
    });

    it("records panel_action telemetry for a model access set", async () => {
      const { recorded, recordAction } = collectPanelActions();
      const modelRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData({ serverId: 55 }),
        operations: {
          ...moderationOperations,
          updateServerModelAccess: async () => ({ status: "success", allowServerModels: false }),
        },
        recordAction,
      });
      const modelInteraction = {
        isButton: () => true,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        customId: "moderation:v2:model-access-set:en-US:allow",
        guildId: "guild-1",
        user: { id: "mod-1" },
        memberPermissions: { has: () => true },
        deferUpdate: async () => {},
        editReply: async () => {},
      } as unknown as ButtonInteraction;

      await modelRoute.execute({} as Client, modelInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["model-access-set", "en-US", "allow"],
      });

      expect(recorded).toContain("moderation.workspace.model-access.set:55:mod-1");
    });

    it("records panel_action telemetry for a quota edit", async () => {
      const { recorded, recordAction } = collectPanelActions();
      const quotaRoute = createModerationInteractionRoute({
        resolveScope: async () => createScopeData({ serverId: 55 }),
        operations: {
          ...moderationOperations,
          updateQuotaSettings: async () => ({
            status: "success",
            quotaType: "text",
            appliedFields: ["daily_user_quota"],
          }),
        },
        recordAction,
      });
      const quotaInteraction = {
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => true,
        customId: "moderation:v2:quota-edit-submit:en-US:text:nonce1234",
        guildId: "guild-1",
        user: { id: "mod-1" },
        memberPermissions: { has: () => true },
        deferUpdate: async () => {},
        editReply: async () => {},
        fields: {
          getTextInputValue: (fieldId: string) => {
            if (fieldId === buildQuotaModalFieldId("nonce1234", "daily_user_quota")) return "20";
            if (fieldId === buildQuotaModalFieldId("nonce1234", "serverwide_quota")) return "500";
            if (fieldId === buildQuotaModalFieldId("nonce1234", "serverwide_quota_resets_in")) return "14";
            return "";
          },
        },
      } as unknown as ModalSubmitInteraction;

      await quotaRoute.execute({} as Client, quotaInteraction, {
        namespace: "moderation",
        version: "v2",
        segments: ["quota-edit-submit", "en-US", "text", "nonce1234"],
      });

      expect(recorded).toContain("moderation.workspace.quota.set:55:mod-1");
    });
  });
});

const WIRE_CONTRACT_V1: ReadonlyArray<readonly [string, ModerationPanelRoute]> = [
  ["moderation:v2:category:en-US:member-access", { action: "category", locale: "en-US", category: "member-access" }],
  ["moderation:v2:select-page:en-US", { action: "select-page", locale: "en-US" }],
  ["moderation:v2:page:en-US:channels", { action: "page", locale: "en-US", page: "channels" }],
  [
    "moderation:v2:range:en-US:whitelist:channels:2",
    { action: "range", locale: "en-US", category: "whitelist", page: "channels", rangeIndex: 2 },
  ],
  [
    "moderation:v2:retry:en-US:user-blacklist:none",
    { action: "retry", locale: "en-US", category: "user-blacklist", page: "none" },
  ],
  ["moderation:v2:member-access-open:en-US", { action: "member-access-open", locale: "en-US" }],
  [
    "moderation:v2:member-access-submit:en-US:nonce12345678",
    { action: "member-access-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:model-access-set:en-US:allow",
    { action: "model-access-set", locale: "en-US", allowServerModels: true },
  ],
  [
    "moderation:v2:model-access-set:en-US:require-personal",
    { action: "model-access-set", locale: "en-US", allowServerModels: false },
  ],
  ["moderation:v2:user-blacklist-add-open:en-US", { action: "user-blacklist-add-open", locale: "en-US" }],
  [
    "moderation:v2:user-blacklist-add-submit:en-US:nonce12345678",
    { action: "user-blacklist-add-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:user-blacklist-remove-open:en-US:2",
    { action: "user-blacklist-remove-open", locale: "en-US", rangeIndex: 2 },
  ],
  [
    "moderation:v2:user-blacklist-remove-submit:en-US:nonce12345678",
    { action: "user-blacklist-remove-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:user-blacklist-remove-prompt:en-US:personalization:123456789012345678",
    {
      action: "user-blacklist-remove-prompt",
      locale: "en-US",
      target: { source: "personalization", userId: "123456789012345678" },
    },
  ],
  [
    "moderation:v2:user-blacklist-remove-prompt:en-US:persona-block:42:123456789012345678",
    {
      action: "user-blacklist-remove-prompt",
      locale: "en-US",
      target: { source: "persona-block", personaId: 42, userId: "123456789012345678" },
    },
  ],
  [
    "moderation:v2:user-blacklist-remove-confirm:en-US:personalization:123456789012345678",
    {
      action: "user-blacklist-remove-confirm",
      locale: "en-US",
      target: { source: "personalization", userId: "123456789012345678" },
    },
  ],
  [
    "moderation:v2:user-blacklist-remove-confirm:en-US:persona-block:42:123456789012345678",
    {
      action: "user-blacklist-remove-confirm",
      locale: "en-US",
      target: { source: "persona-block", personaId: 42, userId: "123456789012345678" },
    },
  ],
  ["moderation:v2:user-blacklist-remove-cancel:en-US", { action: "user-blacklist-remove-cancel", locale: "en-US" }],
  ["moderation:v2:whitelist-channel-add-open:en-US", { action: "whitelist-channel-add-open", locale: "en-US" }],
  [
    "moderation:v2:whitelist-channel-add-submit:en-US:nonce12345678",
    { action: "whitelist-channel-add-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:whitelist-channel-remove-open:en-US:2",
    { action: "whitelist-channel-remove-open", locale: "en-US", rangeIndex: 2 },
  ],
  [
    "moderation:v2:whitelist-channel-remove-submit:en-US:nonce12345678",
    { action: "whitelist-channel-remove-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:whitelist-channel-remove-prompt:en-US:123456789012345678",
    { action: "whitelist-channel-remove-prompt", locale: "en-US", channelId: "123456789012345678" },
  ],
  [
    "moderation:v2:whitelist-channel-remove-confirm:en-US:123456789012345678",
    { action: "whitelist-channel-remove-confirm", locale: "en-US", channelId: "123456789012345678" },
  ],
  [
    "moderation:v2:whitelist-channel-remove-cancel:en-US",
    { action: "whitelist-channel-remove-cancel", locale: "en-US" },
  ],
  ["moderation:v2:whitelist-role-add-open:en-US", { action: "whitelist-role-add-open", locale: "en-US" }],
  [
    "moderation:v2:whitelist-role-add-submit:en-US:nonce12345678",
    { action: "whitelist-role-add-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:whitelist-role-remove-open:en-US:2",
    { action: "whitelist-role-remove-open", locale: "en-US", rangeIndex: 2 },
  ],
  [
    "moderation:v2:whitelist-role-remove-submit:en-US:nonce12345678",
    { action: "whitelist-role-remove-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:whitelist-role-remove-prompt:en-US:123456789012345678",
    { action: "whitelist-role-remove-prompt", locale: "en-US", roleId: "123456789012345678" },
  ],
  [
    "moderation:v2:whitelist-role-remove-confirm:en-US:123456789012345678",
    { action: "whitelist-role-remove-confirm", locale: "en-US", roleId: "123456789012345678" },
  ],
  ["moderation:v2:whitelist-role-remove-cancel:en-US", { action: "whitelist-role-remove-cancel", locale: "en-US" }],
  ["moderation:v2:persona-channel-add-open:en-US", { action: "persona-channel-add-open", locale: "en-US" }],
  [
    "moderation:v2:persona-channel-add-submit:en-US:nonce12345678",
    { action: "persona-channel-add-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  [
    "moderation:v2:persona-channel-remove-open:en-US:2",
    { action: "persona-channel-remove-open", locale: "en-US", rangeIndex: 2 },
  ],
  [
    "moderation:v2:persona-channel-remove-submit:en-US:nonce12345678",
    { action: "persona-channel-remove-submit", locale: "en-US", nonce: "nonce12345678" },
  ],
  ["moderation:v2:quota-edit-open:en-US:image", { action: "quota-edit-open", locale: "en-US", quotaType: "image" }],
  [
    "moderation:v2:quota-edit-submit:en-US:text:nonce12345678",
    { action: "quota-edit-submit", locale: "en-US", quotaType: "text", nonce: "nonce12345678" },
  ],
];

function parsedRoute(customId: string) {
  const route = parseInteractionRoute(customId);
  if (!route) throw new Error(`Expected a parsed route for ${customId}`);
  return route;
}

const ACCEPTED_35_ACTIONS: readonly ModerationPanelRoute["action"][] = [
  "category",
  "member-access-open",
  "member-access-submit",
  "model-access-set",
  "page",
  "persona-channel-add-open",
  "persona-channel-add-submit",
  "persona-channel-remove-open",
  "persona-channel-remove-submit",
  "quota-edit-open",
  "quota-edit-submit",
  "range",
  "retry",
  "select-page",
  "user-blacklist-add-open",
  "user-blacklist-add-submit",
  "user-blacklist-remove-cancel",
  "user-blacklist-remove-confirm",
  "user-blacklist-remove-open",
  "user-blacklist-remove-prompt",
  "user-blacklist-remove-submit",
  "whitelist-channel-add-open",
  "whitelist-channel-add-submit",
  "whitelist-channel-remove-cancel",
  "whitelist-channel-remove-confirm",
  "whitelist-channel-remove-open",
  "whitelist-channel-remove-prompt",
  "whitelist-channel-remove-submit",
  "whitelist-role-add-open",
  "whitelist-role-add-submit",
  "whitelist-role-remove-cancel",
  "whitelist-role-remove-confirm",
  "whitelist-role-remove-open",
  "whitelist-role-remove-prompt",
  "whitelist-role-remove-submit",
];

describe("moderation route codec wire contract, exhaustiveness, and producer coverage", () => {
  it.each(WIRE_CONTRACT_V1)("decodes the pinned wire string %s to its exact route object", (customId, expected) => {
    expect(parseModerationPanelRoute(parsedRoute(customId))).toEqual(expected);
  });

  it.each(WIRE_CONTRACT_V1)("encodes %s to its exact literal wire bytes", (customId, expected) => {
    expect(buildModerationRouteId(expected)).toBe(customId);
    expect(buildModerationRouteSegments(expected)).toEqual(customId.split(":").slice(2));
  });

  it("guarantees 35-action exhaustiveness across accepted actions, wire contract, codecs, and route handlers", () => {
    const sortedAccepted = [...ACCEPTED_35_ACTIONS].sort();
    const wireActions = [...new Set(WIRE_CONTRACT_V1.map(([, route]) => route.action))].sort();

    const fixedCodecActions = Object.keys(MODERATION_ROUTE_CODECS);
    const allCodecActions = [
      ...fixedCodecActions,
      "user-blacklist-remove-prompt",
      "user-blacklist-remove-confirm",
    ].sort();

    const routesSource = readFileSync(
      new URL("../../../src/utils/discord/interactions/moderationRoutes.ts", import.meta.url),
      "utf8",
    );
    const handlerActions = new Set([...routesSource.matchAll(/route\.action === "([a-z0-9-]+)"/g)].map((m) => m[1]));

    expect(wireActions).toEqual(sortedAccepted);
    expect(allCodecActions).toEqual(sortedAccepted);

    expect(handlerActions.size).toBe(35);
    expect([...handlerActions].sort()).toEqual(sortedAccepted);
  });

  /** Actions a compatibility surface renders no button for; the allowlist the union check closes over. */
  const PRODUCERLESS_ACTIONS = [
    "page",
    "user-blacklist-remove-prompt",
    "whitelist-channel-remove-prompt",
    "whitelist-role-remove-prompt",
  ] as const;

  /**
   * Every custom ID the production modal builders and panel renderers emit, collected from the modal
   * surfaces and from one panel payload per category, page, and removal state. The cases below share
   * this collection so a new surface is still added in one place.
   */
  function collectPanelSurfaceCustomIds(): string[] {
    const customIds: string[] = [];

    customIds.push(
      buildMemberAccessModal(
        "en-US",
        {
          serverMemteachingEnabled: true,
          attributeMemteachingEnabled: false,
          sampledialogueMemteachingEnabled: true,
          promptSnapshotEnabled: false,
        },
        "nonce12345678",
      ).custom_id,
    );
    customIds.push(buildUserBlacklistAddModal("en-US", "nonce12345678").custom_id);
    customIds.push(buildWhitelistChannelAddModal("en-US", "nonce12345678").custom_id);
    customIds.push(buildWhitelistRoleAddModal("en-US", "nonce12345678").custom_id);
    customIds.push(
      buildModerationRemovalModal("en-US", "nonce12345678", "user-blacklist", [{ value: "u1", label: "User 1" }])
        .custom_id,
    );
    customIds.push(
      buildModerationRemovalModal("en-US", "nonce12345678", "whitelist-channel", [{ value: "c1", label: "Channel 1" }])
        .custom_id,
    );
    customIds.push(
      buildModerationRemovalModal("en-US", "nonce12345678", "whitelist-role", [{ value: "r1", label: "Role 1" }])
        .custom_id,
    );
    customIds.push(
      buildModerationRemovalModal("en-US", "nonce12345678", "persona-channel", [{ value: "p1", label: "Persona 1" }])
        .custom_id,
    );
    customIds.push(buildPersonaChannelAddModal("en-US", "nonce12345678", new Map([[1, "Tomori"]])).custom_id);
    customIds.push(
      buildQuotaEditModal(
        "en-US",
        "image",
        { daily_user_quota: 5, serverwide_quota: 50, serverwide_quota_resets_in: 30 },
        "nonce12345678",
      ).custom_id,
    );

    const baseScope = createScopeData({
      whitelist: {
        channels: [
          {
            server_id: 1,
            channel_disc_id: "123456789012345678",
            cooldown_type: CooldownType.PER_USER,
            cooldown_length: 10,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        personaChannels: [
          {
            server_id: 1,
            persona_id: 1,
            channel_disc_id: "123456789012345678",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        roles: [
          {
            server_id: 1,
            role_disc_id: "123456789012345678",
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        personaNames: new Map([[1, "Tomori"]]),
      },
      userBlacklist: {
        personalizationUserIds: ["123456789012345678"],
        personaBlocks: [
          {
            server_id: 1,
            persona_id: 1,
            user_disc_id: "123456789012345678",
            block_type: "mute",
            reason: "spam",
            expires_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
            persona_name: "Tomori",
          },
        ],
      },
    });

    const panelInputs: ModerationPanelRenderInput[] = [
      {
        locale: "en-US",
        category: "member-access",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "user-blacklist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "user-blacklist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
        removeTarget: { source: "personalization", userId: "123456789012345678" },
      },
      {
        locale: "en-US",
        category: "user-blacklist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
        removeTarget: { source: "persona-block", personaId: 1, userId: "123456789012345678" },
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
        channelRemoveTarget: "123456789012345678",
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "persona-channels",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "roles",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "roles",
        rangeIndex: 0,
        data: baseScope,
        roleRemoveTarget: "123456789012345678",
      },
      {
        locale: "en-US",
        category: "whitelist",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: createScopeData({
          whitelist: {
            channels: Array.from({ length: 15 }, (_, i) => ({
              server_id: 1,
              channel_disc_id: `1234567890123456${i.toString().padStart(2, "0")}`,
              cooldown_type: CooldownType.PER_USER,
              cooldown_length: 10,
              created_at: new Date(),
              updated_at: new Date(),
            })),
            personaChannels: [],
            roles: [],
            personaNames: new Map([[1, "Tomori"]]),
          },
        }),
      },
      {
        locale: "en-US",
        category: "quotas",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: baseScope,
      },
      {
        locale: "en-US",
        category: "quotas",
        whitelistPage: "channels",
        rangeIndex: 0,
        data: createScopeData({ readStatus: "unavailable" }),
      },
    ];

    for (const input of panelInputs) {
      const payload = buildModerationPanelPayload(input);
      const extractCustomIds = (obj: unknown): void => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const item of obj) extractCustomIds(item);
        } else {
          const record = obj as Record<string, unknown>;
          if (typeof record.customId === "string") customIds.push(record.customId);
          if (typeof record.custom_id === "string") customIds.push(record.custom_id);
          for (const val of Object.values(record)) extractCustomIds(val);
        }
      };
      extractCustomIds(payload);
    }

    return customIds;
  }

  /** The actions the collected custom IDs decode to, ignoring the pagination indicator's own ID. */
  function collectedProducedActions(customIds: string[]): Set<string> {
    const producedActions = new Set<string>();
    for (const id of customIds) {
      if (id.startsWith("pagination-indicator-")) continue;
      const parsed = parseModerationPanelRoute(parsedRoute(id));
      if (parsed) producedActions.add(parsed.action);
    }
    return producedActions;
  }

  it("surfaces only custom IDs the moderation codec can decode", () => {
    const customIds = collectPanelSurfaceCustomIds();

    let routable = 0;
    for (const id of customIds) {
      if (id.startsWith("pagination-indicator-")) continue;
      expect(parseModerationPanelRoute(parsedRoute(id))).not.toBeNull();
      routable += 1;
    }
    // Without this the loop would pass over an empty collection, hiding a renderer that silently
    // stopped emitting custom IDs at all.
    expect(routable).toBeGreaterThan(0);
  });

  it("leaves the compatibility actions without a rendered producer", () => {
    const producedActions = collectedProducedActions(collectPanelSurfaceCustomIds());

    for (const producerless of PRODUCERLESS_ACTIONS) {
      expect(producedActions.has(producerless)).toBe(false);
    }
  });

  it("unions the rendered producers and the compatibility allowlist to every accepted action", () => {
    const producedActions = collectedProducedActions(collectPanelSurfaceCustomIds());

    const unionedActions = [...new Set([...producedActions, ...PRODUCERLESS_ACTIONS])].sort();
    expect(unionedActions).toEqual([...ACCEPTED_35_ACTIONS].sort());
  });

  it("enforces exact 97-character bound for the maximum persona-block removal route and all IDs under 100", () => {
    const maxPersonaBlockRoute: ModerationPanelRoute = {
      action: "user-blacklist-remove-confirm",
      locale: "zh-Hans",
      target: {
        source: "persona-block",
        personaId: 2147483647,
        userId: "12345678901234567890",
      },
    };

    const maxCustomId = buildModerationRouteId(maxPersonaBlockRoute);
    expect(maxCustomId).toBe(
      "moderation:v2:user-blacklist-remove-confirm:zh-Hans:persona-block:2147483647:12345678901234567890",
    );
    expect(maxCustomId.length).toBe(97);
    expect(maxCustomId.length).toBeLessThanOrEqual(100);

    const maxEnUsRoute: ModerationPanelRoute = {
      ...maxPersonaBlockRoute,
      locale: "en-US",
    };
    const maxEnUsCustomId = buildModerationRouteId(maxEnUsRoute);
    const parsed = parseModerationPanelRoute(parsedRoute(maxEnUsCustomId));
    expect(parsed).toEqual(maxEnUsRoute);

    for (const [customId] of WIRE_CONTRACT_V1) {
      expect(customId.length).toBeLessThanOrEqual(100);
    }
  });

  /** Route objects the router would accept but the panel codec must refuse on identity alone. */
  const REJECTED_ROUTE_OBJECTS: Array<{ label: string; route: ParsedInteractionRoute }> = [
    {
      label: "a foreign namespace",
      route: { namespace: "wrong", version: "v2", segments: ["category", "en-US", "member-access"] },
    },
    {
      label: "a future version",
      route: { namespace: "moderation", version: "v3", segments: ["category", "en-US", "member-access"] },
    },
  ];

  /**
   * Every string the router parses into segments but the panel codec must still refuse, paired with
   * the field that makes it invalid. Each row is one arity or enum case: a new action adds one row.
   */
  const REJECTED_WIRE_STRINGS: ReadonlyArray<readonly [string, string]> = [
    ["moderation:v2:category:invalid-locale:member-access", "an unknown locale"],
    ["moderation:v2:unknown-action:en-US", "an action no codec declares"],
    ["moderation:v2:category:en-US:invalid-category", "a category outside the accepted set"],
    ["moderation:v2:page:en-US:invalid-page", "a whitelist page outside the accepted set"],
    ["moderation:v2:quota-edit-open:en-US:invalid-quota", "a quota type outside the accepted set"],
    ["moderation:v2:model-access-set:en-US:invalid-choice", "a model-access choice outside the accepted set"],
    ["moderation:v2:range:en-US:whitelist:channels:-1", "a negative range index"],
    ["moderation:v2:range:en-US:whitelist:channels:abc", "a non-numeric range index"],
    ["moderation:v2:user-blacklist-remove-open:en-US:-1", "a negative removal page"],
    ["moderation:v2:whitelist-channel-remove-confirm:en-US:not-a-snowflake", "a channel id that is not a snowflake"],
    ["moderation:v2:whitelist-role-remove-confirm:en-US:short", "a role id that is too short to be a snowflake"],
    [
      "moderation:v2:user-blacklist-remove-prompt:en-US:unknown-source:123456789012345678",
      "a removal source outside the accepted set",
    ],
    [
      "moderation:v2:user-blacklist-remove-prompt:en-US:persona-block:-1:123456789012345678",
      "a negative persona id in a persona-block target",
    ],
    [
      "moderation:v2:user-blacklist-remove-prompt:en-US:persona-block:0:123456789012345678",
      "a zero persona id in a persona-block target",
    ],
    ["moderation:v2:member-access-submit:en-US:bad!nonce#", "a nonce carrying characters a custom ID cannot hold"],
    ["moderation:v2:user-blacklist-add-submit:en-US:short", "a nonce shorter than the declared minimum"],
    ["moderation:v2:select-page:en-US:extra-segment", "a trailing segment the action does not declare"],
    ["moderation:v2:member-access-open:en-US:extra", "a trailing segment the action does not declare"],
    ["moderation:v2:user-blacklist-remove-cancel:en-US:extra", "a trailing segment the action does not declare"],
  ];

  it.each(REJECTED_ROUTE_OBJECTS)("rejects a route object carrying $label", (entry) => {
    expect(parseModerationPanelRoute(entry.route)).toBeNull();
  });

  it.each(REJECTED_WIRE_STRINGS)("rejects the malformed custom ID %s (%s)", (customId, _reason) => {
    expect(parseModerationPanelRoute(parsedRoute(customId))).toBeNull();
  });
});
