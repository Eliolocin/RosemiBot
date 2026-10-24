import { beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { ComponentType, PermissionsBitField, type Client, type ContainerComponentData } from "discord.js";
import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftRecord } from "@/types/discord/setupWizard";
import { readSetupDraft, resetSetupDrafts, storeSetupDraft } from "@/utils/discord/interactions/setupDraftStore";
import { buildSetupFinishRouteId, buildSetupProviderModeRouteId } from "@/utils/discord/interactions/setupRoutes";
import { configRepository, llmModelRepo, personaRepository, serverRepository } from "@/utils/db/repositories";
import type { SystemPromptPresetRow, TomoriPresetRow } from "@/types/db/schema";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import * as cacheStore from "@/utils/cache/tomoriStateCache";
import * as avatarHelper from "@/utils/image/avatarHelper";
import * as emojiLazySync from "@/utils/cache/emojiLazySync";
import * as stickerLazySync from "@/utils/cache/stickerLazySync";
import * as panelActionMetrics from "@/utils/stats/panelActionMetrics";
import * as sponsorshipModule from "@/modules/supporter-billing/discord/sponsorship";
import * as subscriptionUsageModule from "@/modules/supporter-billing/subscribe/usage";
import * as subscriptionStateModule from "@/modules/supporter-billing/subscribe/state";
import * as patreonOAuthModule from "@/modules/supporter-billing/patreon/oauth";
import { localizedCopy } from "../../helpers/localeCases";

function makeDraft(overrides: Partial<SetupDraftRecord> = {}): SetupDraftRecord {
  return {
    schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
    actorDiscId: "actor-1",
    workspaceKey: "guild-1",
    context: "guild",
    providerAccess: null,
    startingSettings: null,
    policiesAccepted: false,
    requiresPolicies: false,
    ...overrides,
  };
}

describe("subscription setup wizard routes", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  beforeEach(() => {
    resetSetupDrafts();
  });

  interface MockInteractionOptions {
    customId: string;
    kind?: "button" | "string" | "modal";
    actorDiscId?: string;
    guildId?: string | null;
    canManageGuild?: boolean;
    values?: string[];
    fields?: Record<string, string>;
    interactionId?: string;
    guild?: unknown;
    appPermissions?: bigint[];
  }

  function makeMockInteraction({
    customId,
    kind = "button",
    actorDiscId = "actor-1",
    guildId = "guild-1",
    canManageGuild = true,
    values = [],
    fields = {},
    interactionId,
    guild,
    appPermissions = [
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
    ],
  }: MockInteractionOptions): GlobalRoutableInteraction & {
    replyCalls: unknown[];
    updateCalls: unknown[];
    editReplyCalls: unknown[];
  } {
    const replyCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const editReplyCalls: unknown[] = [];

    const id = interactionId ?? `interaction-${customId}`;
    const interaction = {
      id,
      customId,
      locale: "en-US",
      guildLocale: "en-US",
      user: { id: actorDiscId },
      guildId,
      guild,
      memberPermissions: {
        has: (perm: unknown) =>
          (perm === "ManageGuild" || perm === PermissionsBitField.Flags.ManageGuild) && canManageGuild,
      },
      appPermissions: new PermissionsBitField(appPermissions),
      replied: false,
      deferred: false,
      isMessageComponent: () => kind === "button" || kind === "string",
      isModalSubmit: () => kind === "modal",
      isButton: () => kind === "button",
      isStringSelectMenu: () => kind === "string",
      values,
      fields: {
        getTextInputValue: (fieldId: string) => {
          if (!(fieldId in fields)) {
            throw new Error(`Modal submit field not found: ${fieldId}`);
          }
          return fields[fieldId] ?? "";
        },
      },
      reply: async (payload: unknown) => {
        interaction.replied = true;
        replyCalls.push(payload);
      },
      deferReply: async () => {
        interaction.deferred = true;
      },
      deferUpdate: async () => {
        interaction.deferred = true;
      },
      update: async (payload: unknown) => {
        interaction.replied = true;
        updateCalls.push(payload);
      },
      editReply: async (payload: unknown) => {
        editReplyCalls.push(payload);
      },
      followUp: async (payload: unknown) => {
        replyCalls.push(payload);
      },
      replyCalls,
      updateCalls,
      editReplyCalls,
    };

    return interaction as unknown as GlobalRoutableInteraction & {
      replyCalls: unknown[];
      updateCalls: unknown[];
      editReplyCalls: unknown[];
    };
  }

  const PERSONA_PRESET_ROWS = [
    {
      persona_preset_id: 1770,
      persona_preset_name: "Lighthouse",
      persona_preset_desc: "A steady, watchful companion.",
      preset_language: "en-US",
    },
    {
      persona_preset_id: 3585,
      persona_preset_name: "Mirri",
      persona_preset_desc: "Quick, curious, and a little bratty.",
      preset_language: "en-US",
    },
  ] as unknown as TomoriPresetRow[];

  const SYSTEM_PROMPT_ROWS = [
    {
      system_prompt_preset_id: 1,
      system_prompt_preset_name: "Tomori Default",
      system_prompt_preset_desc: "The standard reply style.",
      descriptions: { "en-US": "The standard reply style.", ja: "標準の返信スタイル。" },
      preset_prompt_text: "You are Tomori.",
    },
    {
      system_prompt_preset_id: 2,
      system_prompt_preset_name: "Concise",
      system_prompt_preset_desc: "Shorter replies.",
      descriptions: { "en-US": "Shorter replies." },
      preset_prompt_text: "Reply briefly.",
    },
  ] as unknown as SystemPromptPresetRow[];

  const COMMIT_NONCE = "nonce-finish-commit-1";
  const COMMIT_CATALOGS = {
    persona: PERSONA_PRESET_ROWS[0],
    prompt: SYSTEM_PROMPT_ROWS[0],
  };

  const COMMIT_GUILD = {
    id: "guild-1",
    name: "Wizard Guild",
    emojis: { cache: new Map() },
    stickers: { cache: new Map() },
  };

  function makeCompleteDraft(overrides: Partial<SetupDraftRecord> = {}): SetupDraftRecord {
    return makeDraft({
      providerAccess: {
        mode: "catalog",
        provider: "anthropic",
        encryptedApiKey: Buffer.from("encrypted-key"),
        keyVersion: 1,
      },
      startingSettings: {
        presetId: COMMIT_CATALOGS.persona.persona_preset_id,
        humanizer: 2,
        timezoneOffset: 9,
        systemPrompt: { kind: "preset", presetName: COMMIT_CATALOGS.prompt.system_prompt_preset_name },
      },
      ...overrides,
    });
  }

  function stubCommitDependencies() {
    const setupSpy = spyOn(serverRepository, "setup").mockResolvedValue({
      server: { server_id: 42 },
      tomori: {},
      emojis: [],
      stickers: [],
    } as never);
    const spies = [
      spyOn(serverRepository, "loadServerIdByDiscId").mockResolvedValue(null),
      spyOn(personaRepository, "hasMainPersona").mockResolvedValue(false as never),
      spyOn(personaRepository, "loadState").mockResolvedValue({
        server_id: 42,
        is_alter: false,
        config: { llm_id: 7, user_byok_mode: false, tool_use_enabled: true },
        llm: { has_tools: true },
      } as never),
      spyOn(configRepository, "loadPresetRowsByLocale").mockResolvedValue([COMMIT_CATALOGS.persona] as never),
      spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([COMMIT_CATALOGS.prompt] as never),
      spyOn(llmModelRepo, "loadDefaultModel").mockResolvedValue({ llm_codename: "gpt-4o" } as never),
      setupSpy,
      spyOn(cacheStore, "invalidateTomoriStateCache").mockImplementation(() => {}),
      spyOn(avatarHelper, "getCachedPresetAvatar").mockReturnValue(null),
      spyOn(personaRepository, "markServerMainAvatarSynced").mockResolvedValue(undefined as never),
      spyOn(emojiLazySync, "lazySyncGuildEmojis").mockResolvedValue(undefined as never),
      spyOn(stickerLazySync, "lazySyncGuildStickers").mockResolvedValue(undefined as never),
      spyOn(panelActionMetrics, "recordPanelActionStat").mockResolvedValue(undefined),
      spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 })),
    ];

    return {
      setupSpy,
      invalidateSpy: spies[7],
      loadStateSpy: spies[2],
      panelActionSpy: spies[12],
      fetchSpy: spies[13],
      restore: () => {
        for (const spy of spies) spy.mockRestore();
      },
    };
  }

  it("acknowledges a subscription provider-mode select exactly once in each billing state", async () => {
    for (const enabled of [false, true]) {
      const nonce = `nonce-supporter-${enabled}`;
      storeSetupDraft(nonce, makeDraft({ providerAccess: null }));
      const choiceSpy = spyOn(sponsorshipModule, "isSupporterSponsorshipChoiceEnabled").mockReturnValue(enabled);
      try {
        const interaction = makeMockInteraction({
          customId: buildSetupProviderModeRouteId({ locale: "en-US", nonce }),
          kind: "string",
          values: ["option:supporter"],
        });
        await dispatchGlobalInteraction({} as Client, interaction);
        const acknowledgements = [
          interaction.deferred,
          interaction.replyCalls.length > 0,
          interaction.updateCalls.length > 0,
        ].filter(Boolean);
        expect(acknowledgements).toHaveLength(1);
        expect(interaction.replyCalls.length).toBe(enabled ? 0 : 1);
        expect(interaction.editReplyCalls.length).toBe(enabled ? 1 : 0);
      } finally {
        choiceSpy.mockRestore();
      }
    }
  });

  it("includes the authorization link when subscription setup is first selected", async () => {
    const nonce = "nonce-direct-subscription-link";
    const oauthUrl = "https://www.patreon.com/oauth2/authorize?state=example";
    storeSetupDraft(nonce, makeDraft());
    const choiceSpy = spyOn(sponsorshipModule, "isSupporterSponsorshipChoiceEnabled").mockReturnValue(true);
    const configSpy = spyOn(sponsorshipModule, "parseSupporterBillingConfigForCommands").mockReturnValue({
      patreon: {
        campaignId: "campaign_test",
        oauthClientIdEnv: "CLIENT_ID",
        oauthClientSecretEnv: "CLIENT_SECRET",
        webhookSecretEnv: "WEBHOOK_SECRET",
        creatorRefreshTokenEnv: "REFRESH_TOKEN",
        manageUrl: "https://www.patreon.com/example",
      },
      jobs: { reconcileIntervalSeconds: 300, manualRefreshCooldownSeconds: 30 },
      tiers: {
        test: {
          displayNameKey: "commands.subscribe.tiers.mochi",
          patreonTierIds: ["tier_test"],
          monthlyBudgetMicros: 1000000,
          defaultModelByCapability: { text: "example/model" },
        },
      },
    });
    const stateSpy = spyOn(subscriptionStateModule, "loadSubscribePanelState").mockResolvedValue({ kind: "unlinked" });
    const interaction = makeMockInteraction({
      customId: buildSetupProviderModeRouteId({ locale: "en-US", nonce }),
      kind: "string",
      values: ["option:supporter"],
    });
    const linkSpy = spyOn(patreonOAuthModule, "createPatreonOAuthUrlForDiscordUser").mockImplementation(async () => {
      expect(interaction.deferred).toBe(true);
      return oauthUrl;
    });
    try {
      await dispatchGlobalInteraction({} as Client, interaction);
      expect(linkSpy).toHaveBeenCalledTimes(1);
      expect(linkSpy.mock.calls[0]?.[0]).toBe("actor-1");
      const payload = interaction.editReplyCalls[0] as { components: ContainerComponentData[] };
      const hasDirectLink = payload.components.some((container) =>
        container.components.some((component) => {
          const data = "toJSON" in component ? component.toJSON() : component;
          return (
            data.type === ComponentType.ActionRow &&
            "components" in data &&
            data.components.some((button) => "url" in button && button.url === oauthUrl && !("customId" in button))
          );
        }),
      );
      expect(hasDirectLink).toBe(true);
    } finally {
      linkSpy.mockRestore();
      stateSpy.mockRestore();
      configSpy.mockRestore();
      choiceSpy.mockRestore();
    }
  });

  it("keeps a subscription draft when the allowance is unavailable at Finish Setup", async () => {
    const stubs = stubCommitDependencies();
    const spies = [
      spyOn(sponsorshipModule, "isSupporterSponsorshipChoiceEnabled").mockReturnValue(true),
      spyOn(sponsorshipModule, "validateSupporterSponsorshipRequest").mockResolvedValue({
        ok: true,
        identity: { supporter_identity_id: 10 },
        entitlement: { supporter_entitlement_id: 20 },
      } as never),
      spyOn(subscriptionUsageModule, "loadSubscriptionAllowance").mockRejectedValue(
        new Error("management API timeout"),
      ),
    ];
    try {
      storeSetupDraft(COMMIT_NONCE, makeCompleteDraft({ providerAccess: { mode: "option", value: "supporter" } }));
      const interaction = makeMockInteraction({
        customId: buildSetupFinishRouteId({ locale: "en-US", nonce: COMMIT_NONCE }),
        guild: COMMIT_GUILD,
      });

      await dispatchGlobalInteraction({} as Client, interaction);

      expect(stubs.setupSpy).not.toHaveBeenCalled();
      expect(interaction.editReplyCalls.length).toBe(1);
      expect(JSON.stringify(interaction.editReplyCalls[0])).toContain(
        buildSetupFinishRouteId({ locale: "en-US", nonce: COMMIT_NONCE }),
      );
      expect(readSetupDraft(COMMIT_NONCE, "actor-1", "guild-1", "guild").status).toBe("ok");
    } finally {
      for (const spy of spies) spy.mockRestore();
      stubs.restore();
    }
  });

  it("invalidates committed setup before a sponsorship write fails", async () => {
    const stubs = stubCommitDependencies();
    const spies = [
      spyOn(sponsorshipModule, "isSupporterSponsorshipChoiceEnabled").mockReturnValue(true),
      spyOn(sponsorshipModule, "validateSupporterSponsorshipRequest").mockResolvedValue({
        ok: true,
        identity: { supporter_identity_id: 10 },
        entitlement: { supporter_entitlement_id: 20 },
      } as never),
      spyOn(subscriptionUsageModule, "loadSubscriptionAllowance").mockResolvedValue({
        allowance: 5,
        used: 0,
        remaining: 5,
        start: new Date(0),
        end: new Date(86400000),
      }),
      spyOn(sponsorshipModule, "persistSupporterSponsorship").mockImplementation(async () => {
        expect(stubs.invalidateSpy).toHaveBeenCalledWith("guild-1");
        throw new Error("synthetic sponsorship write failure");
      }),
    ];
    try {
      storeSetupDraft(COMMIT_NONCE, makeCompleteDraft({ providerAccess: { mode: "option", value: "supporter" } }));
      const interaction = makeMockInteraction({
        customId: buildSetupFinishRouteId({ locale: "en-US", nonce: COMMIT_NONCE }),
        guild: COMMIT_GUILD,
      });
      await dispatchGlobalInteraction({} as Client, interaction);
      expect(stubs.setupSpy).toHaveBeenCalledTimes(1);
      expect(stubs.invalidateSpy).toHaveBeenCalledTimes(1);
      expect(readSetupDraft(COMMIT_NONCE, "actor-1", "guild-1", "guild").status).toBe("missing");
      expect(JSON.stringify(interaction.editReplyCalls)).toContain(
        localizedCopy("en-US", "commands.setup.wizard.commit_failed_title"),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
      stubs.restore();
    }
  });
});
