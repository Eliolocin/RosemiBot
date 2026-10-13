import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { ComponentsV2LimitError, validateComponentsV2MessageLimits } from "@/utils/discord/ui/componentsV2Limits";
import {
  buildDashboardPagePayload,
  dashboardPayload,
  type DashboardPage,
  type StatusPageCategory,
} from "@/utils/metrics/status/statusPageRenderer";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import * as realDbClient from "@/utils/db/client";
import * as realRepositories from "@/utils/db/repositories";
import * as realToolRepository from "@/utils/db/repositories/ToolRepository";
import * as realPresetRepository from "@/utils/db/repositories/PresetRepository";
import * as realWhitelistRepository from "@/utils/db/repositories/WhitelistRepository";
import * as realNaiDiffusionModels from "@/utils/image/naiDiffusionModels";
import * as realImageQuotaManager from "@/utils/quota/imageQuotaManager";
import * as realTextQuotaManager from "@/utils/quota/textQuotaManager";
import * as realVideoQuotaManager from "@/utils/quota/videoQuotaManager";
import * as realSpeechEndpointResolver from "@/utils/provider/speechEndpointResolver";
import * as realCustomEndpointService from "@/utils/provider/customEndpointService";
import * as realDbStats from "@/utils/metrics/dbStats";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { localizedCopy, RUNTIME_LOCALES } from "../../helpers/localeCases";

const emptyRows = async () => [];
const quotaConfig = {
  enabled: false,
  daily_user_quota: null,
  serverwide_quota: null,
  serverwide_quota_resets_in: 0,
};

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/client": realDbClient,
  "@/utils/db/repositories": realRepositories,
  "@/utils/db/repositories/ToolRepository": realToolRepository,
  "@/utils/db/repositories/PresetRepository": realPresetRepository,
  "@/utils/db/repositories/WhitelistRepository": realWhitelistRepository,
  "@/utils/image/naiDiffusionModels": realNaiDiffusionModels,
  "@/utils/quota/imageQuotaManager": realImageQuotaManager,
  "@/utils/quota/textQuotaManager": realTextQuotaManager,
  "@/utils/quota/videoQuotaManager": realVideoQuotaManager,
  "@/utils/provider/speechEndpointResolver": realSpeechEndpointResolver,
  "@/utils/provider/customEndpointService": realCustomEndpointService,
  "@/utils/metrics/dbStats": realDbStats,
});

stubLogMembers({ warn: () => undefined });

scopedMock.module("@/utils/db/client", () => ({ ...realDbClient, sql: emptyRows }));
scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    loadSavedProviderConfigs: emptyRows,
    loadCustomEndpointsForServer: emptyRows,
    loadUserSavedProviderConfigs: emptyRows,
    loadCustomEndpointsForUser: emptyRows,
  }),
  llmModelRepo: overrideMembers(realRepositories.llmModelRepo, { loadEmbeddingModelById: async () => null }),
  llmOverrideRepo: overrideMembers(realRepositories.llmOverrideRepo, { getAllChannelLlmOverridesForServer: emptyRows }),
  personaRepository: overrideMembers(realRepositories.personaRepository, {
    loadAllForServer: async () => [],
  }),
  personalMemoryRepository: overrideMembers(realRepositories.personalMemoryRepository, {
    loadForUserLineage: emptyRows,
  }),
  serverScheduleRepository: overrideMembers(realRepositories.serverScheduleRepository, {
    getServerTriggers: emptyRows,
    getUserReminderCount: async () => 0,
  }),
  userRepository: overrideMembers(realRepositories.userRepository, { getBlacklistedMemberIds: emptyRows }),
}));
scopedMock.module("@/utils/db/repositories/ToolRepository", () => ({
  ...realToolRepository,
  toolRepository: overrideMembers(realToolRepository.toolRepository, { loadMcpServers: emptyRows }),
}));
scopedMock.module("@/utils/db/repositories/PresetRepository", () => ({
  ...realPresetRepository,
  presetRepository: overrideMembers(realPresetRepository.presetRepository, {
    loadPresetsForServer: emptyRows,
    loadToggleableNodes: emptyRows,
  }),
}));
scopedMock.module("@/utils/db/repositories/WhitelistRepository", () => ({
  ...realWhitelistRepository,
  whitelistRepository: overrideMembers(realWhitelistRepository.whitelistRepository, {
    getAllWhitelistPersonas: emptyRows,
    getAllWhitelistChannels: emptyRows,
    getAllWhitelistRoles: emptyRows,
  }),
}));
scopedMock.module("@/utils/image/naiDiffusionModels", () => ({
  ...realNaiDiffusionModels,
  getDiffusionModelById: async () => null,
}));
scopedMock.module("@/utils/quota/imageQuotaManager", () => ({
  ...realImageQuotaManager,
  getQuotaConfig: async () => quotaConfig,
}));
scopedMock.module("@/utils/quota/textQuotaManager", () => ({
  ...realTextQuotaManager,
  getTextQuotaConfig: async () => quotaConfig,
}));
scopedMock.module("@/utils/quota/videoQuotaManager", () => ({
  ...realVideoQuotaManager,
  getVideoQuotaConfig: async () => quotaConfig,
}));
scopedMock.module("@/utils/provider/speechEndpointResolver", () => ({
  ...realSpeechEndpointResolver,
  resolveActiveSpeechEndpoint: async () => null,
  resolveActiveTranscriptionEndpoint: async () => null,
}));
scopedMock.module("@/utils/provider/customEndpointService", () => ({
  ...realCustomEndpointService,
  resolveCustomEndpointForProvider: async () => null,
}));
scopedMock.module("@/utils/metrics/dbStats", () => ({ ...realDbStats, loadVideoModelById: async () => null }));
const COMPONENT_BUDGET = 36;

function normalizeSerializedPanelProse(value: string): string {
  return value.replace(/(?:\\r)?\\n(?:-# |> )?/gu, "").replace(/\s+/gu, "");
}

function countComponents(component: unknown): number {
  if (Array.isArray(component)) return component.reduce((total, item) => total + countComponents(item), 0);
  if (!component || typeof component !== "object") return 0;
  const value = component as { components?: unknown[] };
  return 1 + (value.components?.reduce<number>((total, item) => total + countComponents(item), 0) ?? 0);
}

/** The declared config defaults, which is what a server reads back after setup with nothing changed. */
function emptyConfig(overrides: Partial<TomoriState["config"]> = {}): TomoriState["config"] {
  return createServerConfig(overrides);
}

const client = { channels: { cache: new Map() } } as unknown as Client;
const interaction = { user: { id: "status-user" } };
const state = createPersona({ server_id: 1, config: emptyConfig() });
const user = { user_id: 1, user_disc_id: "status-user", language_pref: "en-US" } as UserRow;
const populatedState = {
  ...state,
  config: emptyConfig({
    system_prompt: "configured system prompt ".repeat(800),
    context_note: "configured context note ".repeat(400),
    image_default_positive_tags: ["bright", "detailed"],
    image_default_negative_tags: ["blurry"],
    llm_disabled_params: ["topK"],
    llm_logit_biases: [{ id: "status", text: "status", value: 1, kind: "text", tokenizations: [] }],
    crosschannel_blocklist_ids: ["42"],
    private_channel_ids: ["43"],
    rp_channel_ids: ["44"],
    welcome_prompt: "welcome prompt",
  }),
};
const populatedUser = {
  ...user,
  impersonation_prompt: "personal prompt ".repeat(800),
  physical_appearance_tags: ["kind", "curious"],
  nai_char_ref_url: "https://example.invalid/reference.png",
} as UserRow;

beforeAll(async () => {
  await initializeLocalizer();
});

describe("actual status page builders", () => {
  it("omits protected text before reading it and permits authorized previews", async () => {
    const { buildServerConfigPages } = await import("@/utils/metrics/status/serverConfigPages");
    const { buildPersonaStatusPages } = await import("@/utils/metrics/status/personaPages");
    const secret = "FIXTURE_PRIVATE_PROMPT";
    const protectedState = createPersona({
      persona_prompt: secret,
      context_note: secret,
      config: { system_prompt: secret, context_note: secret },
    });
    const privateState = { ...protectedState, config: { ...protectedState.config } };
    for (const object of [privateState, privateState.config]) {
      for (const key of object === privateState
        ? ["persona_prompt", "context_note"]
        : ["system_prompt", "context_note"]) {
        Object.defineProperty(object, key, {
          get: () => {
            throw new Error("Protected text read before authorization");
          },
        });
      }
    }
    const hiddenPages = [
      ...(await buildServerConfigPages(client, privateState, "en-US", false)),
      ...(await buildPersonaStatusPages(privateState, user, "en-US", false)),
    ];
    expect(JSON.stringify(hiddenPages)).not.toContain(secret);
    expect(JSON.stringify(hiddenPages)).toContain(localizedCopy("en-US", "commands.status.prompt_hidden"));
    const visiblePages = [
      ...(await buildServerConfigPages(client, protectedState, "en-US", true)),
      ...(await buildPersonaStatusPages(protectedState, user, "en-US", true)),
    ];
    expect(JSON.stringify(visiblePages)).toContain(secret);
  });

  it("renders API and welcome prompt producers without their sensitive values", async () => {
    const apiKeySecret = "builder-api-secret";
    const welcomePromptSecret = "builder-welcome-prompt-secret";
    const producerState = {
      ...state,
      config: emptyConfig({ api_key: Buffer.from(apiKeySecret), welcome_prompt: welcomePromptSecret }),
    } as TomoriState;
    const { buildServerConfigPages } = await import("@/utils/metrics/status/serverConfigPages");
    const { buildServerChannelPages } = await import("@/utils/metrics/status/serverChannelPages");
    const [configPages, channelPages] = await Promise.all([
      buildServerConfigPages(client, producerState, "en-US"),
      buildServerChannelPages(client, "status-server", producerState, "en-US"),
    ]);
    const payloads = [...configPages, ...channelPages].map((page) =>
      buildDashboardPagePayload({ locale: "en-US", page: page as DashboardPage }),
    );
    const serialized = JSON.stringify(payloads);

    expect(serialized).toContain(localizer("en-US", "commands.status.field_api_key_set"));
    expect(serialized).toContain(localizer("en-US", "commands.status.field_welcome_prompt"));
    expect(serialized).toContain(localizer("en-US", "commands.choices.enabled"));
    expect(serialized).not.toContain(apiKeySecret);
    expect(serialized).not.toContain(welcomePromptSecret);
  });

  it("keeps every built page and its real dashboard controls within the reserved budget, with all fields surviving", async () => {
    const { buildPersonaStatusPages } = await import("@/utils/metrics/status/personaPages");
    const { buildServerConfigPages } = await import("@/utils/metrics/status/serverConfigPages");
    const { buildServerModelPages } = await import("@/utils/metrics/status/serverModelPages");
    const { buildServerChannelPages } = await import("@/utils/metrics/status/serverChannelPages");
    const { buildPersonalStatusPages } = await import("@/utils/metrics/status/personalPages");

    for (const locale of RUNTIME_LOCALES) {
      for (const [tomoriState, userData] of [
        [state, user],
        [populatedState, populatedUser],
      ] as const) {
        const [configPages, modelPages, channelPages, personaPages, personalPages] = await Promise.all([
          buildServerConfigPages(client, tomoriState, locale),
          buildServerModelPages(client, "status-server", tomoriState, locale),
          buildServerChannelPages(client, "status-server", tomoriState, locale),
          buildPersonaStatusPages(tomoriState, userData, locale),
          buildPersonalStatusPages(interaction, userData, locale),
        ]);

        const categories: StatusPageCategory[] = [
          {
            id: "persona",
            labelKey: "commands.status.scope_choice_persona",
            pages: personaPages,
          },
          {
            id: "behavior",
            labelKey: "commands.status.scope_choice_behavior",
            pages: [configPages[0], configPages[3], channelPages[0]],
          },
          {
            id: "models",
            labelKey: "commands.status.scope_choice_models",
            pages: [modelPages[0], modelPages[1], modelPages[3], configPages[4]],
          },
          {
            id: "access",
            labelKey: "commands.status.scope_choice_access",
            pages: [configPages[1], configPages[2], modelPages[2]],
          },
          {
            id: "personal",
            labelKey: "commands.status.scope_choice_personal",
            pages: personalPages,
          },
        ];

        expect(categories.map((c) => c.pages.length)).toEqual([5, 3, 4, 3, 2]);
        expect(categories.flatMap((c) => c.pages)).toHaveLength(17);

        for (const category of categories) {
          for (const [pageIndex, page] of category.pages.entries()) {
            const personaRoster = Array.from({ length: 51 }, (_, index) => ({
              persona_id: index + 1,
              persona_nickname: index === 0 ? "Mirri" : `Persona ${index + 1}`,
            })) as TomoriState[];
            const payload =
              category.id === "persona"
                ? dashboardPayload("status-test", locale, categories, category.id, pageIndex, false, {
                    selectedPersonaId: 1,
                    personas: personaRoster,
                    personaSelectStart: 25,
                  })
                : dashboardPayload("status-test", locale, categories, category.id, pageIndex, false);

            expect(countComponents(payload.components)).toBeLessThanOrEqual(COMPONENT_BUDGET);
            expect(validateComponentsV2MessageLimits(payload).valid).toBe(true);

            const serialized = JSON.stringify(payload);
            for (const field of page.fields) {
              if ("nameKey" in field && field.nameKey) {
                const expectedName = localizer(locale, field.nameKey, field.nameVars);
                expect(serialized).toContain(expectedName);
              }
            }
            if (page.footerKey) {
              const expectedFooter = localizer(locale, page.footerKey, page.footerVars);
              expect(normalizeSerializedPanelProse(serialized)).toContain(
                normalizeSerializedPanelProse(expectedFooter),
              );
            }
          }
        }
      }
    }
  });

  it("proves over-budget mutations fail validation", () => {
    const overBudgetPage: DashboardPage = {
      titleKey: "commands.status.personal_title",
      descriptionKey: "commands.status.personal_description",
      color: 0x65c6c5,
      fields: [
        {
          nameKey: "commands.status.field_user_nickname",
          value: "x".repeat(4500),
        },
      ],
    };

    expect(() =>
      buildDashboardPagePayload({
        locale: "en-US",
        page: overBudgetPage,
      }),
    ).toThrow(ComponentsV2LimitError);
  });

  it("proves field-loss mutations fail field-preservation assertions", () => {
    const page: DashboardPage = {
      titleKey: "commands.status.personal_title",
      descriptionKey: "commands.status.personal_description",
      color: 0x65c6c5,
      footerKey: "commands.status.export_footer_global_personal_memories",
      fields: [
        {
          nameKey: "commands.status.field_user_nickname",
          value: "Alice",
        },
        {
          nameKey: "commands.status.field_language_pref",
          value: "en-US",
        },
      ],
    };

    const mutatedPage: DashboardPage = {
      ...page,
      fields: [page.fields[0]], // dropped language_pref
    };

    const assertFieldsSurvive = (expectedPage: DashboardPage, renderedJson: string) => {
      for (const field of expectedPage.fields) {
        if ("nameKey" in field && field.nameKey) {
          expect(renderedJson).toContain(localizer("en-US", field.nameKey));
        }
      }
      if (expectedPage.footerKey) {
        expect(renderedJson).toContain(localizer("en-US", expectedPage.footerKey));
      }
    };

    const validPayload = buildDashboardPagePayload({ locale: "en-US", page });
    expect(() => assertFieldsSurvive(page, JSON.stringify(validPayload))).not.toThrow();

    const mutatedPayload = buildDashboardPagePayload({ locale: "en-US", page: mutatedPage });
    expect(() => assertFieldsSurvive(page, JSON.stringify(mutatedPayload))).toThrow();
  });
});
