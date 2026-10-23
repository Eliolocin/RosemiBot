import { afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { ButtonStyle, ComponentType, type Client } from "discord.js";
import {
  savedProviderConfigSchema,
  userSavedProviderConfigSchema,
  type SavedProviderConfigRow,
  type TomoriState,
} from "@/types/db/schema";
import type { ProviderPanelEntry } from "@/types/discord/providerPanel";
import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftRecord } from "@/types/discord/setupWizard";
import * as realUserCache from "@/utils/cache/userCache";
import * as realStateCache from "@/utils/cache/tomoriStateCache";
import * as realLlmProviderRepository from "@/utils/db/repositories/LlmProviderRepository";
import * as realKeyRotation from "@/utils/security/keyRotation";
import * as realLlmModelRepository from "@/utils/db/repositories/LlmModelRepository";
import { buildProvidersRouteId, PROVIDERS_ROUTE_NAMESPACE } from "@/utils/discord/providersPanelCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { createProvidersInteractionRoute } from "@/utils/discord/interactions/providersRoutes";
import { buildConfigModelsBody } from "@/utils/discord/ui/configModelsPanel";
import { buildResponseDraftingBody } from "@/utils/discord/ui/responseDraftingPanel";
import { buildProvidersPanelPayload, providersEntriesPerPage } from "@/utils/discord/ui/providersPanel";
import { buildSetupWizardPayload } from "@/utils/discord/ui/setupPanel";
import { buildSetupFinishRouteId, buildSetupProviderModeRouteId } from "@/utils/discord/interactions/setupRoutes";
import { readSetupDraft, resetSetupDrafts, storeSetupDraft } from "@/utils/discord/interactions/setupDraftStore";
import { dispatchGlobalInteraction } from "@/utils/discord/interactions/router";
import { filterProvidersForCapability } from "@/utils/discord/interactions/configModelOperations";
import {
  applyProviderModelSelection,
  claimProviderModelSelection,
  clearProviderModelSelection,
  findProviderOption,
  findProviderOptionByActiveProvider,
  getProviderOptions,
  providerOptionActionOption,
  providerOptionCapabilityForModelView,
  providerOptionOffersModelViewCapability,
  registerProviderOption,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
  type ProviderOptionScope,
} from "@/utils/provider/providerOptionRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { expectSafePanelPayload } from "../../helpers/panelLimits";
import { expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

let personalOwner = "test-option";

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/userCache": realUserCache,
  "@/utils/cache/tomoriStateCache": realStateCache,
  "@/utils/db/repositories/LlmProviderRepository": realLlmProviderRepository,
  "@/utils/security/keyRotation": realKeyRotation,
  "@/utils/db/repositories/LlmModelRepository": realLlmModelRepository,
});

scopedMock.module("@/utils/cache/userCache", () => ({
  ...realUserCache,
  getCachedUserRow: async () => createUserRow({ user_id: 13 }),
}));
scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realStateCache,
  getCachedTomoriState: async () => state(),
}));
scopedMock.module("@/utils/db/repositories/LlmProviderRepository", () => ({
  ...realLlmProviderRepository,
  llmProviderRepo: overrideMembers(realLlmProviderRepository.llmProviderRepo, {
    loadUserSavedProviderConfigsResult: async () => ({
      status: "fresh" as const,
      configs: [TEST_VALUE, "openrouter"].map((provider) =>
        userSavedProviderConfigSchema.parse({
          ...savedRow(provider),
          user_id: 13,
          llm_id: 1,
          enabled_capabilities: provider === personalOwner ? ["text"] : [],
          assigned_capabilities: provider === personalOwner ? ["text"] : [],
        }),
      ),
    }),
    loadCustomEndpointConnectionsForUserResult: async () => ({
      status: "fresh" as const,
      connections: [],
      endpoints: [],
    }),
    loadPersonalFallbackSettings: async () => ({
      user_id: 13,
      fallback_model_refs: [],
      model_randomizer_enabled: false,
    }),
  }),
}));

scopedMock.module("@/utils/security/keyRotation", () => ({
  ...realKeyRotation,
  getRotationKeyCountForProvider: async () => 0,
}));

scopedMock.module("@/utils/db/repositories/LlmModelRepository", () => ({
  ...realLlmModelRepository,
  llmModelRepo: overrideMembers(realLlmModelRepository.llmModelRepo, {
    loadAvailableModelsForProvider: async () => [createLlmRow({ llm_provider: "openrouter" })],
    loadAvailableDiffusionModels: async () => [],
    loadAvailableEmbeddingModels: async () => [],
    loadAvailableVideoGenerationModels: async () => [],
    loadAvailableDecisionModels: async () => [],
    loadAvailableSpeechModels: async () => [],
  }),
}));

let providerPanelOperations: typeof import("@/utils/provider/providerPanelOperations").providerPanelOperations;

beforeAll(async () => {
  ({ providerPanelOperations } = await import("@/utils/provider/providerPanelOperations"));
  await initializeLocalizer();
});

const TEST_VALUE = "test-option";
const LOCALE = "en-US";

const LABEL_KEY = "commands.providers.entry_kind_provider";
const SERVER_DESCRIPTION_KEY = "commands.providers.entry_kind_endpoint";
const PERSONAL_DESCRIPTION_KEY = "commands.providers.entry_kind_brave";
const OWNED_DESCRIPTION_KEY = "commands.providers.entry_kind_provider";
const ADD_LABEL_KEY = "commands.providers.select_add_provider";
const ADD_SERVER_DESCRIPTION_KEY = "commands.providers.select_add_provider_description";
const ADD_PERSONAL_DESCRIPTION_KEY = "commands.providers.select_add_endpoint_description";
const REMOVE_IMPACT_KEY = "commands.providers.remove_impact_provider";
const MODEL_DESCRIPTION_KEY = "commands.providers.capability_models_explanation";
const SETUP_LABEL_KEY = "commands.setup.wizard.provider_option_catalog";
const SETUP_DESCRIPTION_KEY = "commands.setup.wizard.provider_option_catalog_description";
const SETUP_SUMMARY_KEY = "commands.setup.wizard.provider_catalog_encrypted";
const SETUP_RECEIPT_KEY = "commands.setup.wizard.receipt_desc";

interface TestOptionState {
  availability: { eligible: boolean; reasonKey?: string };
  selection: {
    data?: unknown;
    savedAt: Date | null;
  } | null;
  owned: ProviderOptionCapability[];
  claimed: ProviderOptionCapability[];
  released: ProviderOptionCapability[];
  validated: string[];
  removed: number;
  ensured: number;
  actions: Array<"select" | "edit">;
  setupReady: boolean;
  committedServerId: number | null;
}

let disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});

function registerTestOption(overrides: Partial<TestOptionState> = {}): {
  option: ProviderOptionDefinition;
  state: TestOptionState;
} {
  const state: TestOptionState = {
    availability: { eligible: true },
    selection: null,
    owned: [],
    claimed: [],
    released: [],
    validated: [],
    removed: 0,
    ensured: 0,
    actions: [],
    setupReady: true,
    committedServerId: null,
    ...overrides,
  };
  const option: ProviderOptionDefinition = {
    value: TEST_VALUE,
    catalogProvider: "openrouter",
    capabilities: [
      "text",
      "vision",
      "embedding",
      "image",
      "video",
      "decision",
      "reviewer",
      "speech-design",
      "speech-clone",
    ],
    copy: {
      labelKey: LABEL_KEY,
      entryDescriptionKeys: {
        server: SERVER_DESCRIPTION_KEY,
        personal: PERSONAL_DESCRIPTION_KEY,
        owned: OWNED_DESCRIPTION_KEY,
      },
      addActionLabelKey: ADD_LABEL_KEY,
      addActionDescriptionKeys: {
        server: ADD_SERVER_DESCRIPTION_KEY,
        personal: ADD_PERSONAL_DESCRIPTION_KEY,
      },
      removeImpactKey: REMOVE_IMPACT_KEY,
      modelDescriptionKey: MODEL_DESCRIPTION_KEY,
    },
    availability: () => state.availability,
    selection: {
      load: async () => state.selection,
      ensure: async () => {
        state.ensured += 1;
        return true;
      },
      claim: async (_scope, capability) => {
        state.claimed.push(capability);
        return true;
      },
      release: async (_scope, capability) => {
        state.released.push(capability);
        return true;
      },
      remove: async () => {
        state.removed += 1;
        return "removed";
      },
      owns: (_scope, capability) => state.owned.includes(capability),
      validateModel: async ({ modelCodename }) => {
        state.validated.push(modelCodename);
        return true;
      },
    },
    panel: {
      entryActions: ({ entry }) => ({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Danger,
            customId: `test-remove:${entry.id}`,
            label: "x",
          },
        ],
      }),
      entryOwned: () => true,
      handleAction: async (action) => {
        state.actions.push(action);
        return true;
      },
    },
    setup: {
      optionLabelKey: SETUP_LABEL_KEY,
      optionDescriptionKey: SETUP_DESCRIPTION_KEY,
      summaryKey: SETUP_SUMMARY_KEY,
      receiptDescriptionKey: SETUP_RECEIPT_KEY,
      ready: async () => ({ ready: state.setupReady }),
      components: async () => [{ type: ComponentType.TextDisplay, content: "test onboarding" }],
      committed: async ({ serverId }) => {
        state.committedServerId = serverId;
      },
    },
  };
  disposers.push(registerProviderOption(option));
  return { option, state };
}

function state(): TomoriState {
  return createPersona({ server_id: 12, llm: createLlmRow({ llm_provider: "openrouter" }) });
}

function savedRow(provider: string): SavedProviderConfigRow {
  return savedProviderConfigSchema.parse({
    server_id: 12,
    provider,
    api_key: null,
    llm_id: null,
    llm_disabled_params: [],
    llm_logit_biases: [],
    fallback_model_refs: [],
    diffusion_model_id: null,
    embedding_model_id: null,
    nai_diffusion_model_id: null,
    nai_preset_name: null,
  });
}

const SERVER_SCOPE: ProviderOptionScope = { kind: "server", ownerId: 12, discordId: "guild-1", state: state() };

function panelDependencies() {
  return {
    getState: async () => state(),
    getRecordedDbError: () => null,
    refresh: () => undefined,
    loadSavedConfigs: async () => ({ status: "fresh" as const, configs: [] }),
    loadEndpointConnections: async () => ({ status: "fresh" as const, connections: [], endpoints: [] }),
    loadBraveStatus: async () => ({ status: "fresh" as const, configured: true }),
  };
}

function findButton(payload: unknown, customId: string): { disabled?: boolean } | null {
  let found: { disabled?: boolean } | null = null;
  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.customId === customId) {
      found = record as { disabled?: boolean };
      return;
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(payload);
  return found;
}

function setupDraft(overrides: Partial<SetupDraftRecord> = {}): SetupDraftRecord {
  return {
    schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
    actorDiscId: "user-1",
    workspaceKey: "guild-1",
    context: "guild",
    providerAccess: { mode: "option", value: TEST_VALUE },
    startingSettings: null,
    policiesAccepted: false,
    requiresPolicies: false,
    ...overrides,
  };
}

function optionPanelEntry(): ProviderPanelEntry {
  return {
    id: `provider:${TEST_VALUE}`,
    kind: "provider",
    provider: TEST_VALUE,
    rotationKeyCount: 0,
    displayName: TEST_VALUE,
    copyKey: LABEL_KEY,
    savedAt: null,
    optionData: { marker: "keep" },
    capabilities: [{ capability: "text", availability: "available", models: [] }],
  };
}

describe("provider option registry", () => {
  it("removes a registered option from every surface when its disposer runs", async () => {
    const { option } = registerTestOption();
    expect(findProviderOption(TEST_VALUE)).toBe(option);
    expect(getProviderOptions()).toHaveLength(1);

    for (const dispose of disposers) dispose();
    disposers = [];

    expect(findProviderOption(TEST_VALUE)).toBeUndefined();
    expect(getProviderOptions()).toHaveLength(0);
    expect(findProviderOption(TEST_VALUE)?.availability(SERVER_SCOPE)).toBeUndefined();
  });

  it("offers the option action only while it is eligible and has no stored payer selection", async () => {
    const { state: optionState } = registerTestOption();

    const beforePick = await providerPanelOperations.loadServerProviderPanelScope(
      "guild-1",
      false,
      panelDependencies(),
    );
    expect(beforePick?.data.entries.map((entry) => entry.id)).not.toContain(`provider:${TEST_VALUE}`);
    expect(beforePick?.data.optionActions).toEqual([
      {
        value: `option:${TEST_VALUE}`,
        labelKey: ADD_LABEL_KEY,
        descriptionKey: ADD_SERVER_DESCRIPTION_KEY,
      },
    ]);

    optionState.selection = { savedAt: null, data: { marker: "keep" } };
    optionState.owned = ["text"];

    const afterPick = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, panelDependencies());
    const entry = afterPick?.data.entries.find((candidate) => candidate.id === `provider:${TEST_VALUE}`);
    expect(entry).toMatchObject({
      kind: "provider",
      provider: TEST_VALUE,
      copyKey: LABEL_KEY,
      optionData: { marker: "keep" },
    });
    expect(afterPick?.data.optionActions).toEqual([]);
    expect(afterPick?.data.initialEntryId).toBe(`provider:${TEST_VALUE}`);
  });

  it("marks only the owning payer active when both panel entries offer the same model", async () => {
    const { state: optionState } = registerTestOption({ selection: { savedAt: null }, owned: ["text"] });
    const dependencies = {
      ...panelDependencies(),
      loadSavedConfigs: async () => ({
        status: "fresh" as const,
        configs: [savedRow(TEST_VALUE), savedRow("openrouter")],
      }),
    };
    for (const owner of [TEST_VALUE, "openrouter"]) {
      optionState.owned = owner === TEST_VALUE ? ["text"] : [];
      const loaded = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, dependencies);
      if (!loaded) throw new Error("panel did not load");
      const active = loaded.data.entries.filter(
        (entry) =>
          entry.kind === "provider" &&
          entry.capabilities.some((section) => section.models.some((model) => model.isWorkspaceActive)),
      );
      expect(active.map((entry) => entry.id)).toEqual([`provider:${owner}`]);
      for (const entry of loaded.data.entries) {
        const payload = buildProvidersPanelPayload({
          locale: LOCALE,
          entries: loaded.data.entries,
          initialEntryId: entry.id,
          readStatus: "fresh",
          page: { kind: "entry", entryId: entry.id },
          routeNamespace: PROVIDERS_ROUTE_NAMESPACE,
          enabledActions: new Set(["edit", "remove"]),
          optionActions: loaded.data.optionActions,
          viewerId: "user-1",
          canManageServer: true,
        });
        expectSafePanelPayload(payload, entry.id);
      }
    }
  });

  it("marks personal models against enabled payer capabilities when model IDs repeat", async () => {
    registerTestOption({ selection: { savedAt: null } });
    for (const owner of [TEST_VALUE, "openrouter"]) {
      personalOwner = owner;
      const loaded = await providerPanelOperations.loadPersonalProviderPanelScope("user-1", "guild-1");
      if (!loaded) throw new Error("personal panel did not load");
      const active = loaded.data.entries.filter(
        (entry) =>
          entry.kind === "provider" &&
          entry.capabilities.some((section) => section.models.some((model) => model.isWorkspaceActive)),
      );
      expect(active.map((entry) => entry.id)).toEqual([`provider:${owner}`]);
      for (const entry of loaded.data.entries) {
        expectSafePanelPayload(
          buildProvidersPanelPayload({
            locale: LOCALE,
            entries: loaded.data.entries,
            initialEntryId: entry.id,
            readStatus: "fresh",
            page: { kind: "entry", entryId: entry.id },
            routeNamespace: loaded.routeNamespace,
            enabledActions: new Set(["edit", "remove"]),
            viewerId: "user-1",
            canManageServer: true,
          }),
          entry.id,
        );
      }
    }
  });

  it("hides the option where it is ineligible and reports the reason from the same decision", async () => {
    registerTestOption({
      availability: { eligible: false, reasonKey: "commands.providers.unavailable" },
      selection: null,
    });

    const scope = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, panelDependencies());

    expect(scope?.data.entries.map((entry) => entry.id)).not.toContain(`provider:${TEST_VALUE}`);
    expect(scope?.data.optionActions).toEqual([]);
    expect(await findProviderOption(TEST_VALUE)?.availability(SERVER_SCOPE)).toEqual({
      eligible: false,
      reasonKey: "commands.providers.unavailable",
    });
  });

  it("renders the option entry, its copy, and its own actions inside Discord limits", async () => {
    registerTestOption({ selection: { savedAt: null, data: { marker: "keep" } } });
    const scope = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, panelDependencies());
    const entry = scope?.data.entries.find((candidate) => candidate.id === `provider:${TEST_VALUE}`);
    if (!scope || !entry) throw new Error("option entry did not render");

    const payload = buildProvidersPanelPayload({
      locale: LOCALE,
      entries: scope.data.entries,
      initialEntryId: entry.id,
      readStatus: "fresh",
      page: { kind: "entry", entryId: entry.id },
      routeNamespace: PROVIDERS_ROUTE_NAMESPACE,
      enabledActions: new Set(["edit", "remove"]),
      optionActions: scope.data.optionActions,
      viewerId: "user-1",
      canManageServer: true,
    });

    expectSafePanelPayload(payload, "provider option entry");
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain(localizedCopy(LOCALE, LABEL_KEY));
    expect(serialized).toContain(localizedCopy(LOCALE, OWNED_DESCRIPTION_KEY));
    expect(serialized).toContain(`test-remove:provider:${TEST_VALUE}`);

    const removal = buildProvidersPanelPayload({
      locale: LOCALE,
      entries: scope.data.entries,
      initialEntryId: entry.id,
      readStatus: "fresh",
      page: { kind: "remove", entryId: entry.id },
      routeNamespace: PROVIDERS_ROUTE_NAMESPACE,
    });
    expectSafePanelPayload(removal, "provider option removal");
    expect(JSON.stringify(removal)).toMatch(localizedProse(LOCALE, REMOVE_IMPACT_KEY));
  });

  it("dispatches the panel option action and the entry edit to the option's own handler", async () => {
    const { state: optionState } = registerTestOption();
    const scope = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, panelDependencies());
    if (!scope) throw new Error("scope did not load");
    const route = createProvidersInteractionRoute({ resolveScope: async () => scope });

    const selectId = buildProvidersRouteId(PROVIDERS_ROUTE_NAMESPACE, { action: "select", locale: LOCALE });
    const select = createRouteInteraction({
      customId: selectId,
      kind: "string-select",
      values: [`option:${TEST_VALUE}`],
    });
    const parsedSelect = parseInteractionRoute(selectId);
    if (!parsedSelect) throw new Error("select route did not parse");
    await route.execute(null as never, select as never, parsedSelect);
    expect(optionState.actions).toEqual(["select"]);

    optionState.selection = { savedAt: null };
    const editScope = {
      ...scope,
      data: { ...scope.data, entries: [...scope.data.entries, optionPanelEntry()] },
    };
    const editRoute = createProvidersInteractionRoute({ resolveScope: async () => editScope });
    const editId = buildProvidersRouteId(PROVIDERS_ROUTE_NAMESPACE, {
      action: "edit-provider-open",
      locale: LOCALE,
      provider: TEST_VALUE,
      rotationKeyCount: 0,
    });
    const edit = createRouteInteraction({ customId: editId, kind: "button" });
    const parsedEdit = parseInteractionRoute(editId);
    if (!parsedEdit) throw new Error("edit route did not parse");
    await editRoute.execute(null as never, edit as never, parsedEdit);
    expect(optionState.actions).toEqual(["select", "edit"]);
  });

  it("claims the picked capability for the option and releases it when a built-in provider takes it back", async () => {
    const { state: optionState } = registerTestOption({ owned: ["text"] });

    const claimed = await applyProviderModelSelection({
      scope: SERVER_SCOPE,
      provider: TEST_VALUE,
      capability: "text",
      write: async () => true,
    });
    expect(claimed).toBe(true);
    expect(optionState.claimed).toEqual(["text"]);

    const released = await claimProviderModelSelection({
      scope: SERVER_SCOPE,
      provider: "openrouter",
      capability: "text",
    });
    expect(released).toBe(true);
    expect(optionState.released).toEqual(["text"]);

    expect(findProviderOptionByActiveProvider("openrouter", SERVER_SCOPE, "text")).toBeDefined();
    optionState.owned = [];
    expect(findProviderOptionByActiveProvider("openrouter", SERVER_SCOPE, "text")).toBeUndefined();
  });

  it("releases an option marker when a different built-in catalog takes the slot", async () => {
    const { state: optionState } = registerTestOption({ owned: ["vision"] });
    expect(await claimProviderModelSelection({ scope: SERVER_SCOPE, provider: "google", capability: "vision" })).toBe(
      true,
    );
    expect(optionState.released).toEqual(["vision"]);
  });

  it("clears the payer's capability marker when the slot is emptied", async () => {
    const { state: optionState } = registerTestOption({ owned: ["reviewer"] });

    expect(await clearProviderModelSelection({ scope: SERVER_SCOPE, capability: "reviewer" })).toBe(true);
    expect(optionState.released).toEqual(["reviewer"]);
  });

  it("attributes the same model id to the option only in the capabilities the payer owns", async () => {
    const { option } = registerTestOption({ owned: ["text"] });

    expect(providerOptionCapabilityForModelView("vision")).toBe("vision");
    expect(providerOptionCapabilityForModelView("nai-image")).toBeNull();
    expect(providerOptionOffersModelViewCapability(option, "tts-design")).toBe(true);
    expect(providerOptionOffersModelViewCapability(option, "nai-image")).toBe(false);

    const rows = [TEST_VALUE, "openrouter", "google", "novelai"].map(savedRow);
    expect(filterProvidersForCapability("text", rows).map((row) => row.provider)).toEqual([
      TEST_VALUE,
      "openrouter",
      "google",
      "novelai",
    ]);
    expect(filterProvidersForCapability("nai-image", rows).map((row) => row.provider)).toEqual(["novelai"]);
  });

  it("offers the option in setup, gates the step on its readiness, and runs its commit hook", async () => {
    const { state: optionState } = registerTestOption();
    const providerOptions = [
      {
        value: TEST_VALUE,
        labelKey: SETUP_LABEL_KEY,
        descriptionKey: SETUP_DESCRIPTION_KEY,
        summaryKey: SETUP_SUMMARY_KEY,
      },
    ];

    const completeDraft = setupDraft({
      startingSettings: {
        presetId: 1,
        humanizer: 1,
        timezoneOffset: 0,
        systemPrompt: { kind: "built-in" },
      },
    });
    const settingsCatalogs = {
      personas: [{ id: 1, name: "Mirri", description: "" }],
      prompts: [],
      promptTexts: new Map<string, string>(),
    };
    const ready = buildSetupWizardPayload({
      draft: completeDraft,
      locale: LOCALE,
      isHosted: false,
      nonce: "abcdefgh",
      settingsCatalogs,
      providerOptions,
      optionComponents: [{ type: ComponentType.TextDisplay, content: "test onboarding" }],
      optionReady: true,
    });
    const finishId = buildSetupFinishRouteId({ locale: LOCALE, nonce: "abcdefgh" });
    expectSafePanelPayload(ready, "setup provider option");
    const readyJson = JSON.stringify(ready);
    expect(readyJson).toContain(`option:${TEST_VALUE}`);
    expect(readyJson).toContain("test onboarding");
    expect(readyJson).toMatch(localizedProse(LOCALE, SETUP_SUMMARY_KEY));
    expect(findButton(ready, finishId)?.disabled).toBe(false);

    optionState.setupReady = false;
    const pending = buildSetupWizardPayload({
      draft: completeDraft,
      locale: LOCALE,
      isHosted: false,
      nonce: "abcdefgh",
      settingsCatalogs,
      providerOptions,
      optionReady: false,
    });
    expect(findButton(pending, finishId)?.disabled).toBe(true);

    const setup = findProviderOption(TEST_VALUE)?.setup;
    if (!setup?.committed) throw new Error("test option has no commit hook");
    await setup.committed({
      locale: LOCALE,
      draft: setupDraft(),
      serverId: 12,
      workspaceKey: "guild-1",
    });
    expect(optionState.committedServerId).toBe(12);
  });

  it("removes the stored payer selection through the panel removal path", async () => {
    const { state: optionState } = registerTestOption();
    const result = await providerPanelOperations.removeServerProviderEntry({
      scopeKind: "server",
      serverDiscId: "guild-1",
      state: state(),
      entry: optionPanelEntry(),
    });

    expect(result.status).toBe("success");
    expect(optionState.removed).toBe(1);
  });

  it("stores the option picked in setup and repaints its onboarding", async () => {
    registerTestOption();
    resetSetupDrafts();
    const nonce = "nonce-option-1";
    storeSetupDraft(nonce, setupDraft({ providerAccess: null }));

    const customId = buildSetupProviderModeRouteId({ locale: LOCALE, nonce });
    const interaction = createRouteInteraction({
      customId,
      kind: "string-select",
      values: [`option:${TEST_VALUE}`],
    });
    await dispatchGlobalInteraction({} as Client, interaction as never);

    const stored = readSetupDraft(nonce, "user-1", "guild-1", "guild");
    expect(stored.status).toBe("ok");
    if (stored.status !== "ok") throw new Error("setup draft did not read back");
    expect(stored.draft.providerAccess).toEqual({ mode: "option", value: TEST_VALUE });
    expect(JSON.stringify(interaction.calls)).toContain("test onboarding");
    resetSetupDrafts();
  });

  it("renders option provider labels using the model panel locale", () => {
    registerTestOption();
    expectForEveryLocale((locale) => {
      const parameters = buildConfigModelsBody({
        locale,
        page: "parameters",
        readStatus: "fresh",
        parametersView: {
          textProviders: [TEST_VALUE],
          selectedProvider: TEST_VALUE,
          selectedConfig: savedRow(TEST_VALUE),
          stopStrings: [],
          speakerPatternEnabled: false,
          logitBiasEntries: [],
          logitBiasPageStart: 0,
        },
      });
      expect(JSON.stringify(parameters)).toContain(localizedCopy(locale, LABEL_KEY));
      const reviewerState = createPersona({ config: { response_reviewer_llm_id: 1 } });
      const drafting = buildResponseDraftingBody(
        reviewerState,
        locale,
        {
          inheritedReviewerAvailable: true,
          checkers: [],
          reviewers: [{ provider: TEST_VALUE, models: [{ id: 1, name: "mirri-model", description: null }] }],
        },
        undefined,
        false,
      );
      expect(JSON.stringify(drafting)).toContain(localizedCopy(locale, LABEL_KEY));
    });
  });

  it("acknowledges setup before waiting for option readiness or components", async () => {
    const { option } = registerTestOption();
    const entered = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    let acknowledgedAtReady = false;
    let acknowledgedAtComponents = false;
    const nonce = "nonce-option-timing";
    storeSetupDraft(nonce, setupDraft({ providerAccess: null }));
    const customId = buildSetupProviderModeRouteId({ locale: LOCALE, nonce });
    const interaction = createRouteInteraction({ customId, kind: "string-select", values: [`option:${TEST_VALUE}`] });
    if (!option.setup) throw new Error("setup unavailable");
    option.setup.ready = async () => {
      acknowledgedAtReady = interaction.deferred;
      entered.resolve();
      await pending.promise;
      return { ready: true };
    };
    option.setup.components = async () => {
      acknowledgedAtComponents = interaction.deferred;
      return [];
    };
    const execution = dispatchGlobalInteraction({} as Client, interaction as never);
    await entered.promise;
    pending.resolve();
    await execution;
    expect(acknowledgedAtReady).toBe(true);
    expect(acknowledgedAtComponents).toBe(true);
    expect(interaction.calls[0]?.method).toBe("deferUpdate");
    expect(interaction.edits.length).toBeGreaterThan(0);
    resetSetupDrafts();
  });

  it("lets option handlers acknowledge before the panel scope is loaded", async () => {
    const { option } = registerTestOption({ selection: { savedAt: null } });
    for (const action of ["select", "edit"] as const) {
      const entered = Promise.withResolvers<void>();
      const pending = Promise.withResolvers<void>();
      let acknowledgedAtLoad = false;
      const customId =
        action === "select"
          ? buildProvidersRouteId(PROVIDERS_ROUTE_NAMESPACE, { action: "select", locale: LOCALE })
          : buildProvidersRouteId(PROVIDERS_ROUTE_NAMESPACE, {
              action: "edit-provider-open",
              locale: LOCALE,
              provider: TEST_VALUE,
              rotationKeyCount: 0,
            });
      const interaction = createRouteInteraction({
        customId,
        kind: action === "select" ? "string-select" : "button",
        values: [`option:${TEST_VALUE}`],
      });
      option.panel = {
        handleAction: async (_action, context) => {
          await context.interaction.deferUpdate();
          const selection = await context.loadSelection();
          return selection !== null;
        },
      };
      const scope = await providerPanelOperations.loadServerProviderPanelScope("guild-1", false, panelDependencies());
      const route = createProvidersInteractionRoute({
        resolveScope: async () => {
          acknowledgedAtLoad = interaction.deferred;
          entered.resolve();
          await pending.promise;
          return scope;
        },
      });
      const parsed = parseInteractionRoute(customId);
      if (!parsed) throw new Error("route did not parse");
      const execution = route.execute(null as never, interaction as never, parsed);
      await entered.promise;
      pending.resolve();
      await execution;
      expect(acknowledgedAtLoad).toBe(true);
      expect(interaction.calls[0]?.method).toBe("deferUpdate");
    }
  });

  it("keeps the selector page size correct when option actions are present", () => {
    expect(providersEntriesPerPage(0)).toBe(23);
    expect(providersEntriesPerPage(1)).toBe(22);
    expect(providerOptionActionOption(`option:${TEST_VALUE}`)).toBeUndefined();
  });
});
