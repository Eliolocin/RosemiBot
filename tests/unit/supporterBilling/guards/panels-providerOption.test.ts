import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import { ComponentType, type Client } from "discord.js";
import {
  supporterIdentityRepository,
  supporterServerSponsorshipSchema,
  supporterSponsorshipRepository,
} from "@/modules/supporter-billing/db";
import * as subscribeState from "@/modules/supporter-billing/subscribe/state";
import { readSetupDraft, storeSetupDraft } from "@/utils/discord/interactions/setupDraftStore";
import { buildSetupProviderModeRouteId, setupInteractionRoute } from "@/utils/discord/interactions/setupRoutes";
import { savedProviderConfigSchema, type SavedProviderConfigRow } from "@/types/db/schema";
import type { ProviderPanelEntry } from "@/types/discord/providerPanel";
import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftContext, type SetupDraftRecord } from "@/types/discord/setupWizard";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import {
  configRepository,
  llmModelRepo,
  llmOverrideRepo,
  llmProviderRepo,
  personaRepository,
} from "@/utils/db/repositories";
import { loadConfigSwitchModelsView } from "@/utils/discord/interactions/configModelLoaders";
import { loadConfigModelChoices, loadConfigModelProviders } from "@/utils/discord/interactions/configModelOperations";
import {
  buildInitialProvidersPanel,
  createProvidersInteractionRoute,
} from "@/utils/discord/interactions/providersRoutes";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import {
  buildProvidersRouteId,
  PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
  PROVIDERS_ROUTE_NAMESPACE,
} from "@/utils/discord/providersPanelCatalog";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import { buildProvidersPanelPayload } from "@/utils/discord/ui/providersPanel";
import { buildSetupWizardPayload } from "@/utils/discord/ui/setupPanel";
import {
  loadServerProviderPanelScope,
  type ProviderPanelOperationsDependencies,
} from "@/utils/provider/providerPanelOperations";
import * as keyRotation from "@/utils/security/keyRotation";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../../helpers/env";
import { createLlmRow, createPersona } from "../../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy } from "../../../helpers/localeCases";
import { createRouteInteraction } from "../../../helpers/routeInteraction";

beforeAll(async () => await initializeLocalizer());

interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

function collectComponents(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const nested = Array.isArray(record.components) ? record.components.flatMap(collectComponents) : [];
  const component = record.component ? collectComponents(record.component) : [];
  return [record, ...nested, ...component];
}

function selectOptions(value: unknown): SelectOption[] {
  return collectComponents(value)
    .filter((component) => component.type === ComponentType.StringSelect)
    .flatMap((component) => (Array.isArray(component.options) ? (component.options as SelectOption[]) : []));
}

function supporterEntry(sponsorshipId?: number): ProviderPanelEntry {
  const entry = {
    id: "provider:supporter",
    kind: "provider" as const,
    provider: "supporter",
    displayName: "supporter",
    savedAt: null,
    rotationKeyCount: 0,
    capabilities: [],
  };
  return sponsorshipId === undefined ? entry : { ...entry, sponsorshipId };
}

function savedProviderConfig(provider: string): SavedProviderConfigRow {
  return savedProviderConfigSchema.parse({
    server_id: 12,
    provider,
    api_key: null,
    key_version: 1,
    llm_id: null,
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
    llm_disabled_params: [],
    llm_logit_biases: [],
    fallback_model_refs: [],
  });
}

function setupDraft(context: SetupDraftContext): SetupDraftRecord {
  return {
    schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
    actorDiscId: "actor_1",
    workspaceKey: context === "guild" ? "guild_1" : "actor_1",
    context,
    providerAccess: null,
    startingSettings: null,
    policiesAccepted: false,
    requiresPolicies: false,
  };
}

describe("providers panel subscription entry", () => {
  it("labels the subscription provider entry by locale key and offers no subscribe action", () => {
    expectForEveryLocale((locale) => {
      for (const personal of [true, false]) {
        const entry = supporterEntry(personal ? undefined : 40);
        const options = selectOptions(
          buildProvidersPanelPayload({
            locale,
            entries: [entry],
            initialEntryId: entry.id,
            readStatus: "fresh",
            page: { kind: "entry", entryId: entry.id },
            routeNamespace: personal ? PERSONAL_PROVIDERS_ROUTE_NAMESPACE : undefined,
            subscriptionAvailable: true,
            viewerId: "viewer_1",
          }),
        );
        const subscription = options.find(
          (option) => option.label === localizedCopy(locale, "commands.providers.subscription_label"),
        );
        expect(subscription?.description).toBe(
          localizedCopy(
            locale,
            personal
              ? "commands.providers.subscription_personal_description"
              : "commands.providers.subscription_server_description",
          ),
        );
        expect(options.some((option) => option.label === localizedCopy(locale, "commands.providers.subscribe"))).toBe(
          false,
        );
      }
    });
  });
});

describe("server provider panel subscription gating", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  function dependencies(): ProviderPanelOperationsDependencies {
    return {
      getState: async () => createPersona({ server_id: 12 }),
      getRecordedDbError: () => null,
      refresh: () => undefined,
      loadSavedConfigs: async () => ({ status: "fresh", configs: [savedProviderConfig("supporter")] }),
      loadEndpointConnections: async () => ({ status: "fresh", connections: [], endpoints: [] }),
      loadBraveStatus: async () => ({ status: "fresh", configured: false }),
    };
  }

  it("offers the subscription entry and subscribe action from billing and stored sponsorship", async () => {
    const modelSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([]);
    const diffusionSpy = spyOn(llmModelRepo, "loadAvailableDiffusionModels").mockResolvedValue([]);
    const embeddingSpy = spyOn(llmModelRepo, "loadAvailableEmbeddingModels").mockResolvedValue([]);
    const videoSpy = spyOn(llmModelRepo, "loadAvailableVideoGenerationModels").mockResolvedValue([]);
    const decisionSpy = spyOn(llmModelRepo, "loadAvailableDecisionModels").mockResolvedValue([]);
    const speechSpy = spyOn(llmModelRepo, "loadAvailableSpeechModels").mockResolvedValue([]);
    const rotationSpy = spyOn(keyRotation, "getRotationKeyCountForProvider").mockResolvedValue(0);
    const sponsorshipSpy = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer");
    const identitySpy = spyOn(supporterIdentityRepository, "loadById").mockResolvedValue(null);
    const sponsorship = supporterServerSponsorshipSchema.parse({
      sponsorship_id: 40,
      server_id: 12,
      server_disc_id: "guild_1",
      sponsor_identity_id: 70,
      status: "active",
      created_by_disc_id: "viewer_1",
      created_at: new Date("2026-01-01T00:00:00Z"),
      revoked_at: null,
      updated_at: new Date("2026-01-01T00:00:00Z"),
    });
    const interaction = createRouteInteraction({ isManager: true });
    const loadPanel = async () => {
      const scope = await loadServerProviderPanelScope("guild_1", false, dependencies());
      if (!scope) throw new Error("Expected a provider panel scope");
      return buildInitialProvidersPanel(interaction as never, "en-US", { resolveScope: async () => scope });
    };
    const labels = (payload: unknown) => selectOptions(payload).map((option) => option.label);

    try {
      process.env.RUN_ENV = "production";
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      sponsorshipSpy.mockResolvedValue(sponsorship);
      const sponsored = labels(await loadPanel());
      expect(sponsored).toContain(localizedCopy("en-US", "commands.providers.subscription_label"));
      expect(sponsored).not.toContain(localizedCopy("en-US", "commands.providers.subscribe"));

      sponsorshipSpy.mockResolvedValue(null);
      const unsponsored = labels(await loadPanel());
      expect(unsponsored).not.toContain(localizedCopy("en-US", "commands.providers.subscription_label"));
      expect(unsponsored).toContain(localizedCopy("en-US", "commands.providers.subscribe"));

      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      sponsorshipSpy.mockResolvedValue(sponsorship);
      const disabled = labels(await loadPanel());
      expect(disabled).not.toContain(localizedCopy("en-US", "commands.providers.subscription_label"));
      expect(disabled).not.toContain(localizedCopy("en-US", "commands.providers.subscribe"));
    } finally {
      modelSpy.mockRestore();
      diffusionSpy.mockRestore();
      embeddingSpy.mockRestore();
      videoSpy.mockRestore();
      decisionSpy.mockRestore();
      speechSpy.mockRestore();
      rotationSpy.mockRestore();
      sponsorshipSpy.mockRestore();
      identitySpy.mockRestore();
    }
  });

  it("refuses the subscription management surface while billing is disabled", async () => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
    const customId = buildProvidersRouteId(PROVIDERS_ROUTE_NAMESPACE, {
      action: "edit-provider-open",
      locale: "en-US",
      provider: "supporter",
      rotationKeyCount: 0,
    });
    const parsedRoute = parseInteractionRoute(customId);
    if (!parsedRoute) throw new Error("Expected a parsed providers route");
    const interaction = createRouteInteraction({ customId, kind: "button", isManager: true });
    const route = createProvidersInteractionRoute();

    await route.execute({} as Client, interaction as never, parsedRoute);

    expect(interaction.replies).toHaveLength(1);
    expect(interaction.replies[0]).toMatchObject({
      content: localizedCopy("en-US", "commands.providers.unavailable"),
    });
  });
});

describe("setup wizard subscription provider choice", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("offers the subscription provider choice in a guild only while billing is enabled", () => {
    const cases = [
      { environment: "production", enabled: "true", context: "guild", offered: true },
      { environment: "production", enabled: "false", context: "guild", offered: false },
      { environment: "development", enabled: "true", context: "guild", offered: false },
      { environment: "production", enabled: "true", context: "dm", offered: false },
    ] as const;
    for (const testCase of cases) {
      process.env.RUN_ENV = testCase.environment;
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = testCase.enabled;
      expectForEveryLocale((locale) => {
        const options = selectOptions(
          buildSetupWizardPayload({
            draft: setupDraft(testCase.context),
            locale,
            isHosted: false,
            nonce: "provider-option",
          }),
        );
        const option = options.find(
          (candidate) => candidate.label === localizedCopy(locale, "commands.setup.wizard.provider_option_supporter"),
        );
        if (!testCase.offered) {
          expect(option).toBeUndefined();
          return;
        }
        expect(option?.description).toBe(
          localizedCopy(locale, "commands.setup.wizard.provider_option_supporter_description"),
        );
      });
    }
  });
});

describe("setup provider selection persistence", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("stores a Subscription choice through the route and refuses it when billing is disabled", async () => {
    process.env.RUN_ENV = "production";
    const state = spyOn(subscribeState, "loadSubscribePanelState").mockResolvedValue({ kind: "unlinked" });
    const presets = spyOn(configRepository, "loadPresetRowsByLocale").mockResolvedValue([]);
    const prompts = spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([]);
    try {
      for (const enabled of [true, false]) {
        process.env.TOMORI_SUPPORTER_BILLING_ENABLED = String(enabled);
        const nonce = `guards-setup-${enabled}`;
        const interaction = createRouteInteraction({
          customId: buildSetupProviderModeRouteId({ locale: "en-US", nonce }),
          kind: "string-select",
          values: ["supporter"],
        });
        Object.assign(interaction, { isMessageComponent: () => true });
        const draft = {
          ...setupDraft("guild"),
          actorDiscId: interaction.user.id,
          workspaceKey: interaction.guildId ?? "",
          requiresPolicies: true,
        };
        storeSetupDraft(nonce, draft);
        const route = parseInteractionRoute(interaction.customId);
        if (!route) throw new Error("Expected setup selection route");
        await setupInteractionRoute.execute({} as Client, interaction as never, route);
        const stored = readSetupDraft(nonce, interaction.user.id, draft.workspaceKey, "guild");
        expect(stored.status).toBe("ok");
        if (stored.status !== "ok") throw new Error("Expected stored setup draft");
        expect(stored.draft.providerAccess).toEqual(enabled ? { mode: "supporter" } : null);
        expect(
          interaction.calls.filter((call) => ["reply", "update", "deferUpdate"].includes(call.method)),
        ).toHaveLength(1);
        if (!enabled)
          expect(JSON.stringify(interaction.replies)).toContain(
            localizedCopy("en-US", "commands.setup.wizard.provider_invalid"),
          );
      }
    } finally {
      state.mockRestore();
      presets.mockRestore();
      prompts.mockRestore();
    }
  });
});

describe("config model subscription provider list", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);

  it("lists and renders the subscription provider only while billing is enabled", async () => {
    const state = createPersona({ server_id: 9, config: { subscription_capabilities: [] } });
    const workspaceKey = "provider-option-workspace";
    invalidateTomoriStateCache(workspaceKey);
    const configsSpy = spyOn(llmProviderRepo, "loadSavedProviderConfigs").mockResolvedValue([
      savedProviderConfig("supporter"),
    ]);
    const endpointsSpy = spyOn(llmProviderRepo, "loadCustomEndpointsForServer").mockResolvedValue([]);
    const speechSpy = spyOn(llmModelRepo, "loadAvailableSpeechModels").mockResolvedValue([]);
    const decisionSpy = spyOn(llmModelRepo, "loadDecisionModelOptions").mockResolvedValue([]);
    const channelSpy = spyOn(llmOverrideRepo, "getAllChannelLlmOverridesForServer").mockResolvedValue([]);
    const personasSpy = spyOn(personaRepository, "loadAllForServer").mockResolvedValue([]);
    const sponsorshipSpy = spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(
      null,
    );
    const modelsSpy = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([
      createLlmRow({ llm_id: 31, llm_codename: "fixture/subscription-model", is_scoped_registration: true }),
    ]);
    const subscriptionLabel = (locale: string) => localizedCopy(locale, "commands.providers.subscription_label");
    const renderSwitchModels = async (locale: string) => {
      const view = await loadConfigSwitchModelsView(state, workspaceKey, undefined);
      return buildConfigPanelPayload({
        locale,
        actor: { workspaceKind: "guild", isManager: true },
        category: "models",
        page: "switch",
        personas: [state],
        selectedPersonaId: state.persona_id ?? null,
        readStatus: "fresh",
        switchModelsView: view,
      });
    };

    try {
      process.env.RUN_ENV = "production";
      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
      expect(await loadConfigModelProviders(9, "text")).toContain("supporter");
      expect((await loadConfigModelChoices(9, "text", "supporter")).map((choice) => choice.name)).toEqual([
        "fixture/subscription-model",
      ]);
      for (const locale of ["en-US", "ja"]) {
        const payload = await renderSwitchModels(locale);
        expect(selectOptions(payload).some((option) => option.label === subscriptionLabel(locale))).toBe(true);
      }
      const markerState = createPersona({
        server_id: 9,
        llm: createLlmRow({ llm_id: 31, llm_provider: "openrouter", llm_codename: "fixture/subscription-model" }),
        config: { subscription_capabilities: ["text"], llm_id: 31 },
      });
      const markedView = await loadConfigSwitchModelsView(markerState, workspaceKey, undefined);
      expect(markedView.slots.find((slot) => slot.capability === "text")?.currentProvider).toBe("supporter");
      const plainView = await loadConfigSwitchModelsView(state, workspaceKey, undefined);
      expect(plainView.slots.find((slot) => slot.capability === "text")?.currentProvider).toBe(state.llm.llm_provider);

      process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "false";
      expect(await loadConfigModelProviders(9, "text")).not.toContain("supporter");
      expect(await loadConfigModelChoices(9, "text", "supporter")).toEqual([]);
      for (const locale of ["en-US", "ja"]) {
        const payload = await renderSwitchModels(locale);
        expect(selectOptions(payload).some((option) => option.label === subscriptionLabel(locale))).toBe(false);
      }
    } finally {
      configsSpy.mockRestore();
      endpointsSpy.mockRestore();
      speechSpy.mockRestore();
      decisionSpy.mockRestore();
      channelSpy.mockRestore();
      personasSpy.mockRestore();
      sponsorshipSpy.mockRestore();
      modelsSpy.mockRestore();
    }
  });
});
