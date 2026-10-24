import { registerHostedSpeechModelForScope } from "@/utils/provider/openrouterModelRegistry";
import { supportsSpeechMode } from "@/utils/speech/voiceSourceCapabilities";
import type {
  CustomEndpointConnectionRow,
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointRow,
  FallbackModelRef,
  PersonalProviderCapability,
  SavedProviderConfigRow,
  SavedProviderConfigUpsert,
  TomoriState,
  UserSavedProviderConfigRow,
  UserSavedProviderConfigUpsert,
  VramHandoffBackend,
} from "@/types/db/schema";
import {
  PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
  type ProvidersRouteNamespace,
} from "@/utils/discord/providersPanelCatalog";
import { log } from "@/utils/misc/logger";
import type {
  EndpointProviderPanelEntry,
  ProviderPanelCapability,
  ProviderPanelCapabilitySection,
  ProviderPanelEntry,
  ProviderPanelModel,
  ProviderPanelOptionAction,
  ProviderPanelScopeData,
} from "@/types/discord/providerPanel";
import { getCachedTomoriState, getRecordedDbError, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { configRepository } from "@/utils/db/repositories/ConfigRepository";
import {
  llmProviderRepo,
  type CustomEndpointConnectionsReadResult,
  type SavedProviderConfigsReadResult,
  type VramHandoffChange,
} from "@/utils/db/repositories/LlmProviderRepository";
import { detectVramHandoffBackend } from "@/utils/provider/textModelComfyUiHandoff";
import { toolRepository, type BraveApiKeyStatusReadResult } from "@/utils/db/repositories/ToolRepository";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import { validateElevenLabsApiKey } from "@/utils/audio/elevenLabsAccount";
import { parseCustomProvider } from "@/utils/provider/customProviderUtils";
import {
  type ImageEndpointSupports,
  imageEndpointSupportsFromSubmittedValues,
  readImageEndpointSupports,
} from "@/utils/provider/customImageEndpointSupport";
import {
  readSpeechEndpointSettings,
  speechEndpointSettingsFromSubmittedValues,
} from "@/utils/provider/customSpeechEndpointSettings";
import {
  curatedImageSupportsFromSubmittedValues,
  resolveCuratedImageSupports,
} from "@/utils/provider/providerImageCapabilities";
import type { ApiKeyValidationResult } from "@/types/provider/interfaces";
import { isAccountBalanceExhaustedError } from "@/utils/provider/providerErrorClassification";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { deleteOptApiKey, encryptApiKey, storeOptApiKey } from "@/utils/security/crypto";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  activateProviderSpeechDefaults,
  activatePersonalProviderTextModel,
  activateServerTextModelFromSavedConfig,
} from "@/utils/provider/providerActivation";
import {
  loadCustomConnectionCredential,
  registerCustomEndpoint,
  setActiveCustomEndpoint,
} from "@/utils/provider/customEndpointService";
import {
  normalizeCustomEndpointUrlForStorage,
  validateCustomEndpointReachability,
} from "@/utils/provider/customEndpointService";
import {
  buildCustomProviderName,
  isValidCustomEndpointLabel,
  normalizeCustomEndpointLabel,
} from "@/utils/provider/customProviderUtils";
import { braveWebSearch } from "@/tools/restAPIs/brave/braveSearchService";
import { registerOpenRouterModelForScope } from "@/utils/provider/openrouterModelRegistry";
import { getRotationKeyCountForProvider } from "@/utils/security/keyRotation";
import { addRotationKey, purgeRotationKeysForProvider } from "@/utils/security/keyRotation";
import {
  assignPersonalCapabilityToProvider,
  getActivePersonalProviderForCapability,
} from "@/utils/provider/personalProviderHelpers";
import {
  findProviderOption,
  claimProviderModelSelection,
  findProviderOptionByActiveProvider,
  getProviderOptions,
  providerOptionActionValue,
  providerOptionCapabilityForPanel,
  providerOptionCapabilityForPersonal,
  providerOptionFallbackRefServes,
  providerOptionOffersPanelCapability,
  type ProviderOptionCapability,
  type ProviderOptionDefinition,
  type ProviderOptionScope,
} from "@/utils/provider/providerOptionRegistry";

const CAPABILITIES: readonly ProviderPanelCapability[] = [
  "text",
  "image",
  "embedding",
  "video",
  "speech",
  "transcription",
  "decision",
];

type ProviderPanelOwner =
  | { scopeKind: "personal"; ownerId: number; state: TomoriState | null }
  | { scopeKind?: "server"; ownerId?: number; state: TomoriState };

export type LoadedProviderPanelScope = ProviderPanelOwner & {
  routeNamespace?: ProvidersRouteNamespace;
  footerCommand?: { root: string; subcommandGroup?: string; subcommand?: string };
  data: ProviderPanelScopeData;
};

export interface ProviderPanelOperationsDependencies {
  getState(discordId: string): Promise<TomoriState | null>;
  getRecordedDbError(discordId: string): { message: string; timestamp: number } | null;
  refresh(discordId: string): void | Promise<void>;
  loadSavedConfigs(serverId: number): Promise<SavedProviderConfigsReadResult>;
  loadEndpointConnections(serverId: number): Promise<CustomEndpointConnectionsReadResult>;
  loadBraveStatus(serverId: number): Promise<BraveApiKeyStatusReadResult>;
}

export type AddServerProviderResult =
  | { status: "success"; entryId: string; displayName: string; modelName?: string; updated: boolean }
  | {
      status:
        | "invalid-key"
        | "unsupported-provider"
        | "validation-failed"
        | "no-balance"
        | "missing-model"
        | "write-failed";
    };

export type AddServerProviderInput = ProviderPanelOwner & {
  serverDiscId: string;
  provider: string;
  apiKey: string;
};

export interface AddServerProviderDependencies {
  validateElevenLabs(key: string): ReturnType<typeof validateElevenLabsApiKey>;
  validateBrave(key: string): Promise<boolean>;
  registerEndpoint: typeof registerCustomEndpoint;
  storeOptionalKey(serverId: number, serviceName: string, apiKey: string): Promise<boolean>;
  getProvider(name: string): ReturnType<typeof ProviderFactory.getProviderByName>;
  encrypt(key: string): ReturnType<typeof encryptApiKey>;
  buildSavedConfig(
    params: Parameters<typeof buildSavedProviderConfigFromExistingOrDefaults>[0],
  ): Promise<SavedProviderConfigUpsert>;
  loadSavedConfig(serverId: number, provider: string): Promise<SavedProviderConfigRow | null>;
  upsertSavedConfig: typeof llmProviderRepo.upsertSavedProviderConfig;
  activateText: typeof activateServerTextModelFromSavedConfig;
  activateSpeechDefaults: typeof activateProviderSpeechDefaults;
  refresh(discordId: string): void | Promise<void>;
}

export type AddCustomEndpointConnectionResult =
  | { status: "success"; entryId: string; label: string }
  | { status: "unreachable"; reason: string; credentialsWithheld: boolean }
  | {
      status: "invalid-label" | "invalid-style" | "already-exists" | "label-url-conflict" | "write-failed";
    };

export type AddCustomEndpointConnectionInput = ProviderPanelOwner & {
  serverDiscId: string;
  label: string;
  endpointUrl: string;
  apiStyle: CustomEndpointApiStyle;
  authToken: string;
};

export interface AddCustomEndpointConnectionDependencies {
  validateReachability: typeof validateCustomEndpointReachability;
  upsertConnection: typeof llmProviderRepo.upsertCustomEndpointConnection;
  deleteConnections(ownerId: number, scopeKind: "server" | "personal", connectionIds: number[]): Promise<boolean>;
  loadConnections(
    ownerId: number,
    scopeKind: "server" | "personal",
    label: string,
  ): Promise<CustomEndpointConnectionRow[]>;
  encrypt(key: string): ReturnType<typeof encryptApiKey>;
  buildSavedConfig(
    params: Parameters<typeof buildSavedProviderConfigFromExistingOrDefaults>[0],
  ): Promise<SavedProviderConfigUpsert>;
  upsertSavedConfig: typeof llmProviderRepo.upsertSavedProviderConfig;
  refresh(discordId: string): void | Promise<void>;
}

export type SaveProviderModelResult =
  | { status: "success"; entryId: string; codeName: string; removed?: boolean }
  | { status: "invalid-model" | "unsupported-capability" | "not-found" | "already-available" | "write-failed" };

export type SaveProviderModelInput = ProviderPanelOwner & {
  serverDiscId: string;
  entryId: string;
  capability: CustomEndpointCapability;
  codeName: string;
  editingModelId?: number;
  removeDecisionModel?: boolean;
  numCtx?: number | null;
  hasTools?: boolean;
  seesImages?: boolean;
  supportsStructOutput?: boolean;
  strictRoleAlternation?: boolean;
  supportsPrefixCompletion?: boolean;
  supportsAssistantPrefill?: boolean;
  verbatimToolCalling?: boolean;
  // Raw checkbox values, because only the resolved connection knows the api style that decides
  // whether inpainting was offerable in the modal at all.
  imageSupportValues?: string[];
  // Raw modal values for the same reason: the resolved connection's api style decides whether the
  // clone/VoiceDesign/Auto split applies at all.
  speechVoiceMode?: string;
  speechScriptMarkup?: string;
  speechInstructValues?: string[];
  workflow?: Record<string, unknown>;
};

export type EditProviderResult =
  | { status: "success"; entryId: string; changed: string[] }
  | { status: "unchanged"; entryId: string }
  | { status: "invalid-key" | "invalid-combination" | "not-found" | "validation-failed" | "write-failed" };

type EditProviderInput = ProviderPanelOwner & {
  serverDiscId: string;
  provider: string;
  apiKey: string;
  rotationKey: string;
  deleteRotationKeys: boolean;
};

export type EditEndpointResult =
  | { status: "success"; entryId: string; label: string }
  | { status: "unchanged"; entryId: string }
  | { status: "unreachable"; reason: string; credentialsWithheld: boolean }
  | { status: "invalid-label" | "not-found" | "write-failed" | "handoff-unsupported" };

type EditEndpointInput = ProviderPanelOwner & {
  serverDiscId: string;
  entryId: string;
  label: string;
  endpointUrl: string;
  authToken: string;
  /** Undefined when the modal did not offer the option, which leaves the stored value untouched. */
  unloadDuringComfyUi?: boolean;
};

export type RemoveProviderEntryResult =
  | { status: "success"; entryId: string; displayName: string }
  | { status: "active" | "not-found" | "write-failed" };

type RemoveProviderEntryInput = ProviderPanelOwner & {
  serverDiscId: string;
  entry: ProviderPanelEntry;
};

const defaultDependencies: ProviderPanelOperationsDependencies = {
  getState: (discordId) => getCachedTomoriState(discordId),
  getRecordedDbError: (discordId) => getRecordedDbError(discordId),
  refresh: (discordId) => invalidateTomoriStateCache(discordId),
  loadSavedConfigs: (serverId) => llmProviderRepo.loadSavedProviderConfigsResult(serverId),
  loadEndpointConnections: (serverId) => llmProviderRepo.loadCustomEndpointConnectionsForServerResult(serverId),
  loadBraveStatus: (serverId) => toolRepository.getBraveApiKeyStatusResult(serverId),
};

const braveValidationTimeoutMs = Math.max(
  1_000,
  Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS ?? "5000", 10) || 5_000,
);

const defaultAddDependencies: AddServerProviderDependencies = {
  validateElevenLabs: (key) => validateElevenLabsApiKey(key),
  validateBrave: async (key) =>
    (await braveWebSearch({ q: "test" }, { apiKey: key, timeout: braveValidationTimeoutMs })).success,
  registerEndpoint: registerCustomEndpoint,
  storeOptionalKey: storeOptApiKey,
  getProvider: (name) => ProviderFactory.getProviderByName(name),
  encrypt: (key) => encryptApiKey(key),
  buildSavedConfig: (params) => buildSavedProviderConfigFromExistingOrDefaults(params),
  loadSavedConfig: (serverId, provider) => llmProviderRepo.loadSavedProviderConfig(serverId, provider),
  upsertSavedConfig: (serverId, config) => llmProviderRepo.upsertSavedProviderConfig(serverId, config),
  activateText: activateServerTextModelFromSavedConfig,
  activateSpeechDefaults: activateProviderSpeechDefaults,
  refresh: (discordId) => invalidateTomoriStateCache(discordId),
};

const defaultAddEndpointDependencies: AddCustomEndpointConnectionDependencies = {
  validateReachability: validateCustomEndpointReachability,
  upsertConnection: (params) => llmProviderRepo.upsertCustomEndpointConnection(params),
  deleteConnections: (ownerId, scopeKind, connectionIds) =>
    scopeKind === "personal"
      ? llmProviderRepo.deleteUserCustomEndpointConnectionGroup(ownerId, connectionIds)
      : llmProviderRepo.deleteServerCustomEndpointConnectionGroup(ownerId, connectionIds),
  loadConnections: async (ownerId, scopeKind, label) => {
    const result =
      scopeKind === "personal"
        ? await llmProviderRepo.loadCustomEndpointConnectionsForUserResult(ownerId)
        : await llmProviderRepo.loadCustomEndpointConnectionsForServerResult(ownerId);
    return result.connections.filter((row) => row.label === label);
  },
  encrypt: (key) => encryptApiKey(key),
  buildSavedConfig: (params) => buildSavedProviderConfigFromExistingOrDefaults(params),
  upsertSavedConfig: (serverId, config) => llmProviderRepo.upsertSavedProviderConfig(serverId, config),
  refresh: (discordId) => invalidateTomoriStateCache(discordId),
};

const CUSTOM_ENDPOINT_CAPABILITIES_BY_API_STYLE = {
  "openai-compatible": ["text", "embedding", "image", "video"],
  "ollama-native": ["text", "embedding"],
  comfyui: ["image", "video"],
  "tts-clone": ["speech"],
  "openai-compatible-transcription": ["transcription"],
  "system-one": ["decision"],
  "openai-decisions": ["decision"],
} as const satisfies Partial<Record<CustomEndpointApiStyle, readonly CustomEndpointCapability[]>>;

function hasFallback(refs: readonly FallbackModelRef[], type: FallbackModelRef["type"], id: number): boolean {
  return refs.some((ref) => ref.type === type && ref.id === id);
}

function createModel(
  id: number | undefined,
  codeName: string,
  activeId: number | null | undefined,
  workspaceFallbacks: readonly FallbackModelRef[],
  providerFallbacks: readonly FallbackModelRef[],
  fallbackType: FallbackModelRef["type"],
  customRegistration = false,
  fallbackId = id,
  textSettings?: ProviderPanelModel["textSettings"],
  imageSettings?: ImageEndpointSupports,
): ProviderPanelModel | null {
  if (id === undefined) return null;
  const resolvedFallbackId = fallbackId ?? id;
  return {
    id,
    codeName,
    isWorkspaceActive: activeId === id,
    isWorkspaceFallback: hasFallback(workspaceFallbacks, fallbackType, resolvedFallbackId),
    isProviderFallback: hasFallback(providerFallbacks, fallbackType, resolvedFallbackId),
    isCustomRegistration: customRegistration,
    textSettings,
    imageSettings,
  };
}

type PanelSavedConfig = SavedProviderConfigRow | UserSavedProviderConfigRow;

interface PanelModelContext {
  scope: { kind: "server" | "personal"; ownerId: number };
  state: TomoriState | null;
  activeTextId: number | null;
  activeImageId: number | null;
  /** NovelAI image models live in their own slot, so NovelAI rows are marked against this instead. */
  activeNaiImageId: number | null;
  activeEmbeddingId: number | null;
  activeVideoId: number | null;
  activeSpeechDesignId: number | null;
  activeSpeechCloneId: number | null;
  activeSpeechDesignModelId: number | null;
  activeSpeechCloneModelId: number | null;
  scopeFallbacks: readonly FallbackModelRef[];
}

function serverModelContext(state: TomoriState): PanelModelContext {
  return {
    scope: { kind: "server", ownerId: state.server_id },
    state,
    activeTextId: state.config.llm_id,
    activeImageId: state.config.diffusion_model_id ?? null,
    activeNaiImageId: state.config.nai_diffusion_model_id ?? null,
    activeEmbeddingId: state.config.embedding_model_id ?? null,
    activeVideoId: state.config.video_model_id ?? null,
    activeSpeechDesignId: state.config.speech_design_endpoint_id,
    activeSpeechCloneId: state.config.speech_clone_endpoint_id,
    activeSpeechDesignModelId: state.config.speech_design_model_id,
    activeSpeechCloneModelId: state.config.speech_clone_model_id,
    scopeFallbacks: state.config.fallback_model_refs ?? [],
  };
}

function personalModelContext(
  userId: number,
  configs: UserSavedProviderConfigRow[],
  fallbacks: readonly FallbackModelRef[],
  state: TomoriState | null,
): PanelModelContext {
  const text = getActivePersonalProviderForCapability(configs, "text");
  return {
    scope: { kind: "personal", ownerId: userId },
    state,
    activeTextId: text?.llm_id ?? null,
    activeImageId:
      getActivePersonalProviderForCapability(configs, "image")?.diffusion_model_id ??
      getActivePersonalProviderForCapability(configs, "image")?.nai_diffusion_model_id ??
      null,
    activeNaiImageId: getActivePersonalProviderForCapability(configs, "image")?.nai_diffusion_model_id ?? null,
    activeEmbeddingId: getActivePersonalProviderForCapability(configs, "embedding")?.embedding_model_id ?? null,
    activeVideoId: getActivePersonalProviderForCapability(configs, "video")?.video_model_id ?? null,
    activeSpeechDesignId: null,
    activeSpeechCloneId: null,
    activeSpeechDesignModelId:
      getActivePersonalProviderForCapability(configs, "speech_design")?.speech_design_model_id ?? null,
    activeSpeechCloneModelId:
      getActivePersonalProviderForCapability(configs, "speech_clone")?.speech_clone_model_id ?? null,
    scopeFallbacks: text ? fallbacks : [],
  };
}

function personalOptionCapabilities(savedConfig: PanelSavedConfig | null): ProviderOptionCapability[] {
  if (!savedConfig || !("enabled_capabilities" in savedConfig)) return [];
  return savedConfig.enabled_capabilities.flatMap((capability) => {
    const canonical = providerOptionCapabilityForPersonal(capability);
    return canonical ? [canonical] : [];
  });
}

function optionContextScope(context: PanelModelContext): ProviderOptionScope {
  return { kind: context.scope.kind, ownerId: context.scope.ownerId, state: context.state };
}

function optionOwnsCapability(
  option: ProviderOptionDefinition,
  savedConfig: PanelSavedConfig | null,
  context: PanelModelContext,
  capability: ProviderOptionCapability,
): boolean {
  if (context.scope.kind === "personal") {
    return personalOptionCapabilities(savedConfig).includes(capability);
  }
  return option.selection.owns?.(optionContextScope(context), capability) ?? false;
}

async function buildCuratedCapabilities(
  provider: string,
  savedConfig: PanelSavedConfig | null,
  context: PanelModelContext,
): Promise<ProviderPanelCapabilitySection[]> {
  const option = findProviderOption(provider);
  const catalogProvider = option?.catalogProvider ?? provider;
  const owns = (capability: ProviderOptionCapability) => {
    if (context.scope.kind === "personal") return personalOptionCapabilities(savedConfig).includes(capability);
    if (option) return optionOwnsCapability(option, savedConfig, context, capability);
    return !findProviderOptionByActiveProvider(provider, optionContextScope(context), capability);
  };
  const [textRows, imageRows, embeddingRows, videoRows, decisionRows, speechRows] = await Promise.all([
    llmModelRepo.loadAvailableModelsForProvider(catalogProvider, false, context.scope),
    llmModelRepo.loadAvailableDiffusionModels(catalogProvider, false, context.scope),
    llmModelRepo.loadAvailableEmbeddingModels(catalogProvider, false, context.scope),
    llmModelRepo.loadAvailableVideoGenerationModels(catalogProvider, false, context.scope),
    llmModelRepo.loadAvailableDecisionModels(catalogProvider, false, context.scope),
    llmModelRepo.loadAvailableSpeechModels(catalogProvider, context.scope),
  ]);
  const workspaceFallbacks = context.scopeFallbacks.filter((ref) => providerOptionFallbackRefServes(ref, provider));
  const providerFallbacks = (
    savedConfig && "fallback_model_refs" in savedConfig ? (savedConfig.fallback_model_refs ?? []) : []
  ).filter((ref) => providerOptionFallbackRefServes(ref, provider));
  const activeTextId = owns("text") ? context.activeTextId : null;
  const activeImageId = owns("image") ? context.activeImageId : null;
  const activeEmbeddingId = owns("embedding") ? context.activeEmbeddingId : null;
  const activeVideoId = owns("video") ? context.activeVideoId : null;
  const activeSpeechDesignModelId = owns("speech-design") ? context.activeSpeechDesignModelId : null;
  const activeSpeechCloneModelId = owns("speech-clone") ? context.activeSpeechCloneModelId : null;

  const modelsByCapability: Record<
    "text" | "image" | "embedding" | "video" | "decision" | "speech",
    ProviderPanelModel[]
  > = {
    speech: speechRows.map((row) => ({
      id: row.speech_model_id,
      codeName: row.codename,
      isWorkspaceActive:
        row.speech_model_id === activeSpeechDesignModelId || row.speech_model_id === activeSpeechCloneModelId,
      isWorkspaceFallback: false,
      isProviderFallback: false,
      isCustomRegistration: row.is_scoped_registration,
      speechActiveModes: [
        ...(row.speech_model_id === activeSpeechDesignModelId ? ["design" as const] : []),
        ...(row.speech_model_id === activeSpeechCloneModelId ? ["clone" as const] : []),
      ],
      speechSettings: {
        voiceMode: row.voice_mode === "design" ? "voice-design" : row.voice_mode,
        scriptMarkup: "plain",
        supportsInstruct: true,
      },
    })),
    decision: decisionRows.map((row) => ({
      id: row.decision_model_id,
      codeName: row.codename,
      isWorkspaceActive: false,
      isWorkspaceFallback: false,
      isProviderFallback: false,
      isCustomRegistration: row.is_scoped_registration,
      decisionSettings: { inputTokenLimit: row.input_token_limit },
    })),
    text: (textRows ?? []).flatMap((row) => {
      const model = createModel(
        row.llm_id,
        row.llm_codename,
        activeTextId,
        workspaceFallbacks,
        providerFallbacks,
        "llm",
        row.is_scoped_registration,
        row.llm_id,
        {
          numCtx: null,
          hasTools: row.has_tools,
          seesImages: row.sees_images,
          supportsStructOutput: row.supports_structoutput,
          strictRoleAlternation: row.strict_role_alternation,
          supportsPrefixCompletion: row.supports_prefix_completion,
          supportsAssistantPrefill: row.supports_assistant_prefill,
          verbatimToolCalling: row.verbatim_tool_calling,
        },
      );
      return model ? [model] : [];
    }),
    image: (imageRows ?? []).flatMap((row) => {
      const model = createModel(
        row.diffusion_model_id,
        row.codename,
        catalogProvider === "novelai" ? context.activeNaiImageId : activeImageId,
        [],
        [],
        "llm",
        row.is_scoped_registration,
        row.diffusion_model_id,
        undefined,
        resolveCuratedImageSupports(catalogProvider, row) ?? undefined,
      );
      return model ? [model] : [];
    }),
    embedding: (embeddingRows ?? []).flatMap((row) => {
      const model = createModel(
        row.embedding_model_id,
        row.codename,
        activeEmbeddingId,
        [],
        [],
        "llm",
        row.is_scoped_registration,
      );
      return model ? [model] : [];
    }),
    video: (videoRows ?? []).flatMap((row) => {
      const model = createModel(
        row.video_model_id,
        row.codename,
        activeVideoId,
        [],
        [],
        "llm",
        row.is_scoped_registration,
      );
      return model ? [model] : [];
    }),
  };

  return CAPABILITIES.map((capability) => {
    if (
      (capability === "speech" && speechRows.length === 0) ||
      capability === "transcription" ||
      (capability === "decision" && !getStaticProviderInfo(catalogProvider)?.featureSupport.decisions) ||
      (option && !providerOptionOffersPanelCapability(option, capability))
    ) {
      return { capability, availability: "unavailable", models: [] };
    }
    return { capability, availability: "available", models: modelsByCapability[capability] };
  });
}

function buildEndpointCapabilities(
  connections: readonly CustomEndpointConnectionRow[],
  endpoints: readonly CustomEndpointRow[],
  savedConfigs: ReadonlyMap<string, PanelSavedConfig>,
  context: PanelModelContext,
): ProviderPanelCapabilitySection[] {
  const connectionIds = new Set(connections.map((connection) => connection.connection_id));
  const workspaceFallbacks = context.scopeFallbacks;

  return CAPABILITIES.map((capability) => {
    const capabilityConnections = connections.filter((connection) => connection.capability === capability);
    // `addCustomEndpointConnection` creates a connection for every capability the chosen API style
    // supports, so a missing one means this endpoint cannot host that capability at all:
    // `registerEndpointModel` answers `not-found` for it. Reporting it unavailable keeps the panel
    // from offering a model modal that can only fail.
    if (capabilityConnections.length === 0) {
      return { capability, availability: "unavailable", models: [] };
    }

    const models = endpoints
      .filter((endpoint) => connectionIds.has(endpoint.connection_id) && endpoint.capability === capability)
      .flatMap((endpoint) => {
        if (endpoint.custom_endpoint_id === undefined) return [];
        const savedConfig = savedConfigs.get(`custom:${endpoint.connection_id}`);
        const providerFallbacks =
          savedConfig && "fallback_model_refs" in savedConfig ? (savedConfig.fallback_model_refs ?? []) : [];
        const activeId =
          capability === "text"
            ? context.activeTextId
            : capability === "image"
              ? context.activeImageId
              : capability === "embedding"
                ? context.activeEmbeddingId
                : capability === "video"
                  ? context.activeVideoId
                  : capability === "speech"
                    ? endpoint.custom_endpoint_id === context.activeSpeechDesignId ||
                      endpoint.custom_endpoint_id === context.activeSpeechCloneId
                      ? endpoint.custom_endpoint_id
                      : null
                    : endpoint.is_default
                      ? endpoint.custom_endpoint_id
                      : null;
        const identityId =
          capability === "speech" || capability === "transcription"
            ? endpoint.custom_endpoint_id
            : (endpoint.model_ref_id ?? endpoint.custom_endpoint_id);
        const model = createModel(
          identityId,
          endpoint.model_name?.trim() || endpoint.label,
          activeId,
          capability === "text" ? workspaceFallbacks : [],
          capability === "text" ? providerFallbacks : [],
          "custom_endpoint",
          true,
          endpoint.custom_endpoint_id,
          capability === "text"
            ? {
                numCtx: endpoint.num_ctx ?? null,
                hasTools: endpoint.has_tools,
                seesImages: endpoint.sees_images,
                supportsStructOutput: endpoint.supports_structoutput,
                strictRoleAlternation: endpoint.strict_role_alternation,
                supportsPrefixCompletion: endpoint.supports_prefix_completion,
                supportsAssistantPrefill: endpoint.supports_assistant_prefill,
                verbatimToolCalling: endpoint.verbatim_tool_calling,
              }
            : undefined,
          capability === "image" ? readImageEndpointSupports(endpoint) : undefined,
        );
        if (!model) return [];
        if (capability === "transcription") model.isWorkspaceActive = endpoint.is_default;
        if (capability === "speech") {
          model.speechActiveModes = [
            ...(endpoint.custom_endpoint_id === context.activeSpeechDesignId ? ["design" as const] : []),
            ...(endpoint.custom_endpoint_id === context.activeSpeechCloneId ? ["clone" as const] : []),
          ];
          model.isWorkspaceActive = model.speechActiveModes.length > 0;
        }
        if (capability === "decision") {
          model.isWorkspaceActive = false;
          model.decisionSettings = { inputTokenLimit: endpoint.num_ctx ?? 0 };
        }
        if (capability === "speech") {
          model.speechSettings = readSpeechEndpointSettings(endpoint);
        }
        return [model];
      });

    return { capability, availability: "available", models, apiStyle: capabilityConnections[0]?.api_style };
  });
}

function newestDate(values: Array<Date | undefined>): Date | null {
  const timestamps = values.flatMap((value) => (value ? [value.getTime()] : []));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
}

function buildEndpointEntries(
  connections: readonly CustomEndpointConnectionRow[],
  endpoints: readonly CustomEndpointRow[],
  savedConfigs: ReadonlyMap<string, PanelSavedConfig>,
  context: PanelModelContext,
): EndpointProviderPanelEntry[] {
  const groups = new Map<string, CustomEndpointConnectionRow[]>();
  for (const connection of connections) {
    const group = groups.get(connection.label) ?? [];
    group.push(connection);
    groups.set(connection.label, group);
  }

  return [...groups.values()].map((group) => {
    const sortedConnections = [...group].sort((left, right) => left.connection_id - right.connection_id);
    const connectionIds = sortedConnections.map((connection) => connection.connection_id);
    const representativeId = connectionIds[0] as number;
    return {
      id: `endpoint:${representativeId}`,
      kind: "endpoint",
      displayName: sortedConnections[0]?.label ?? `Endpoint ${representativeId}`,
      savedAt: newestDate(sortedConnections.map((connection) => connection.updated_at ?? connection.created_at)),
      connectionIds,
      isPreset:
        sortedConnections[0]?.label === ELEVENLABS_SERVICE_NAME &&
        sortedConnections.every(
          (connection) => connection.api_style === "elevenlabs" || connection.api_style === "elevenlabs-transcription",
        ),
      connectionDetails: sortedConnections.map((connection) => ({
        connectionId: connection.connection_id,
        endpointUrl: connection.endpoint_url,
        apiStyle: connection.api_style,
        capability: connection.capability,
        vramHandoff: connection.behavior?.vram_handoff ?? null,
      })),
      capabilities: buildEndpointCapabilities(sortedConnections, endpoints, savedConfigs, context),
    };
  });
}

function resolveInitialEntryId(
  entries: readonly ProviderPanelEntry[],
  state: TomoriState,
  optionTextOwner?: string,
): string | null {
  const activeProvider = optionTextOwner ?? state.llm.llm_provider.toLowerCase();
  const customProvider = parseCustomProvider(activeProvider);
  const activeEntry = customProvider
    ? entries.find((entry) => entry.kind === "endpoint" && entry.connectionIds.includes(customProvider.connectionId))
    : entries.find((entry) => entry.kind === "provider" && entry.provider === activeProvider);
  if (activeEntry) return activeEntry.id;

  const newest = [...entries].sort(
    (left, right) => (right.savedAt?.getTime() ?? 0) - (left.savedAt?.getTime() ?? 0),
  )[0];
  return newest?.id ?? null;
}

interface ProviderOptionPanelEntries {
  entries: ProviderPanelEntry[];
  optionActions: ProviderPanelOptionAction[];
  textOwner?: string;
}

async function loadProviderOptionPanelEntries(
  scope: ProviderOptionScope,
  context: PanelModelContext,
  configs: readonly PanelSavedConfig[],
): Promise<ProviderOptionPanelEntries> {
  const entries: ProviderPanelEntry[] = [];
  const optionActions: ProviderPanelOptionAction[] = [];
  let textOwner: string | undefined;
  for (const option of getProviderOptions()) {
    const availability = await option.availability(scope);
    if (!availability.eligible) continue;
    const selection = await option.selection.load(scope);
    if (!selection) {
      optionActions.push({
        value: providerOptionActionValue(option),
        labelKey: option.copy.addActionLabelKey,
        descriptionKey: option.copy.addActionDescriptionKeys[scope.kind],
      });
      continue;
    }
    if (option.selection.owns?.(scope, "text")) textOwner = option.value;
    const saved = configs.find((config) => config.provider.toLowerCase() === option.value) ?? null;
    entries.push({
      id: `provider:${option.value}`,
      kind: "provider",
      provider: option.value,
      rotationKeyCount: 0,
      displayName: option.value,
      copyKey: option.copy.labelKey,
      savedAt: selection.savedAt,
      capabilities: await buildCuratedCapabilities(option.value, saved, context),
      optionData: selection.data,
    });
  }
  return { entries, optionActions, textOwner };
}

export async function loadServerProviderPanelScope(
  discordId: string,
  forceRefresh = false,
  dependencies: ProviderPanelOperationsDependencies = defaultDependencies,
): Promise<LoadedProviderPanelScope | null> {
  if (forceRefresh) await dependencies.refresh(discordId);
  const state = await dependencies.getState(discordId);
  if (!state) return null;

  const [savedResult, endpointResult, braveResult] = await Promise.all([
    dependencies.loadSavedConfigs(state.server_id),
    dependencies.loadEndpointConnections(state.server_id),
    dependencies.loadBraveStatus(state.server_id),
  ]);

  const readUnavailable =
    savedResult.status === "unavailable" ||
    endpointResult.status === "unavailable" ||
    braveResult.status === "unavailable";
  if (readUnavailable) {
    return { state, data: { readStatus: "unavailable", entries: [], initialEntryId: null } };
  }

  const savedConfigMap = new Map(savedResult.configs.map((config) => [config.provider.toLowerCase(), config]));
  const modelContext = serverModelContext(state);
  const optionEntries = await loadProviderOptionPanelEntries(
    { kind: "server", ownerId: state.server_id, discordId, state },
    modelContext,
    savedResult.configs,
  );
  const curatedEntries = await Promise.all(
    savedResult.configs
      .filter((config) => !parseCustomProvider(config.provider) && !findProviderOption(config.provider))
      .map(async (config): Promise<ProviderPanelEntry> => {
        const provider = config.provider.toLowerCase();
        const [capabilities, rotationKeyCount] = await Promise.all([
          buildCuratedCapabilities(provider, config, modelContext),
          getRotationKeyCountForProvider(state.server_id, provider),
        ]);
        return {
          id: `provider:${provider}`,
          kind: "provider",
          provider,
          rotationKeyCount,
          displayName: getProviderDisplayName(provider),
          savedAt: config.updated_at ?? config.saved_at ?? null,
          capabilities,
        };
      }),
  );
  const endpointEntries = buildEndpointEntries(
    endpointResult.connections,
    endpointResult.endpoints,
    savedConfigMap,
    modelContext,
  );
  const braveEntry: ProviderPanelEntry[] = braveResult.configured
    ? [{ id: "brave", kind: "brave", displayName: "Brave Search", savedAt: null }]
    : [];
  const entries = [...optionEntries.entries, ...curatedEntries, ...endpointEntries, ...braveEntry].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );

  return {
    state,
    scopeKind: "server",
    ownerId: state.server_id,
    data: {
      readStatus: dependencies.getRecordedDbError(discordId) ? "stale" : "fresh",
      entries,
      initialEntryId: resolveInitialEntryId(entries, state, optionEntries.textOwner),
      optionActions: optionEntries.optionActions,
    },
  };
}

function resolvePersonalInitialEntryId(
  entries: readonly ProviderPanelEntry[],
  configs: UserSavedProviderConfigRow[],
): string | null {
  const activeProvider = getActivePersonalProviderForCapability(configs, "text")?.provider.toLowerCase();
  const customProvider = activeProvider ? parseCustomProvider(activeProvider) : null;
  const activeEntry = customProvider
    ? entries.find((entry) => entry.kind === "endpoint" && entry.connectionIds.includes(customProvider.connectionId))
    : entries.find((entry) => entry.kind === "provider" && entry.provider === activeProvider);
  if (activeEntry) return activeEntry.id;
  return (
    [...entries].sort((left, right) => (right.savedAt?.getTime() ?? 0) - (left.savedAt?.getTime() ?? 0))[0]?.id ?? null
  );
}

async function loadPersonalProviderPanelScope(
  userDiscId: string,
  contextDiscordId: string,
): Promise<LoadedProviderPanelScope | null> {
  const [state, user] = await Promise.all([getCachedTomoriState(contextDiscordId), getCachedUserRow(userDiscId)]);
  const userId = user?.user_id;
  if (!userId) return null;

  const [savedResult, endpointResult, fallbackSettings] = await Promise.all([
    llmProviderRepo.loadUserSavedProviderConfigsResult(userId),
    llmProviderRepo.loadCustomEndpointConnectionsForUserResult(userId),
    llmProviderRepo.loadPersonalFallbackSettings(userId).catch(() => null),
  ]);
  if (savedResult.status === "unavailable" || endpointResult.status === "unavailable" || !fallbackSettings) {
    return {
      state,
      scopeKind: "personal",
      ownerId: userId,
      routeNamespace: PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
      footerCommand: { root: "personal", subcommandGroup: "provider", subcommand: "model-text" },
      data: { readStatus: "unavailable", entries: [], initialEntryId: null },
    };
  }

  const modelContext = personalModelContext(userId, savedResult.configs, fallbackSettings.fallback_model_refs, state);
  const savedConfigMap = new Map(savedResult.configs.map((config) => [config.provider.toLowerCase(), config]));
  const optionEntries = await loadProviderOptionPanelEntries(
    { kind: "personal", ownerId: userId, discordId: userDiscId, state },
    modelContext,
    savedResult.configs,
  );
  const curatedEntries = await Promise.all(
    savedResult.configs
      .filter((config) => !parseCustomProvider(config.provider) && !findProviderOption(config.provider))
      .map(async (config): Promise<ProviderPanelEntry> => {
        const provider = config.provider.toLowerCase();
        return {
          id: `provider:${provider}`,
          kind: "provider",
          provider,
          rotationKeyCount: 0,
          displayName: getProviderDisplayName(provider),
          savedAt: config.updated_at ?? config.saved_at ?? null,
          capabilities: await buildCuratedCapabilities(provider, config, modelContext),
        };
      }),
  );
  const endpointEntries = buildEndpointEntries(
    endpointResult.connections,
    endpointResult.endpoints,
    savedConfigMap,
    modelContext,
  );
  const entries = [...optionEntries.entries, ...curatedEntries, ...endpointEntries].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
  return {
    state,
    scopeKind: "personal",
    ownerId: userId,
    routeNamespace: PERSONAL_PROVIDERS_ROUTE_NAMESPACE,
    footerCommand: { root: "personal", subcommandGroup: "provider", subcommand: "model-text" },
    data: {
      readStatus: "fresh",
      entries,
      initialEntryId: resolvePersonalInitialEntryId(entries, savedResult.configs),
      optionActions: optionEntries.optionActions,
    },
  };
}

function rejectedKeyStatus(validation: ApiKeyValidationResult): "validation-failed" | "no-balance" {
  return validation.error && isAccountBalanceExhaustedError(validation.error) ? "no-balance" : "validation-failed";
}

async function addElevenLabsProvider(
  input: Extract<AddServerProviderInput, { scopeKind?: "server" }>,
  dependencies: AddServerProviderDependencies,
): Promise<AddServerProviderResult> {
  if (!(await dependencies.validateElevenLabs(input.apiKey)).success) {
    return { status: "validation-failed" };
  }

  const scope = {
    kind: "server" as const,
    ownerId: input.state.server_id,
    baseConfig: input.state?.config,
    serverDiscId: input.serverDiscId,
  };
  const [speech, transcription] = await Promise.all([
    dependencies.registerEndpoint({
      scope,
      label: ELEVENLABS_SERVICE_NAME,
      capability: "speech",
      apiStyle: "elevenlabs",
      endpointUrl: "https://api.elevenlabs.io",
      modelName: null,
      authToken: input.apiKey,
      extraConfig: { script_markup: "bracket-tags", supports_instruct: false },
    }),
    dependencies.registerEndpoint({
      scope,
      label: ELEVENLABS_SERVICE_NAME,
      capability: "transcription",
      apiStyle: "elevenlabs-transcription",
      endpointUrl: "https://api.elevenlabs.io",
      modelName: null,
      authToken: input.apiKey,
      extraConfig: {},
    }),
  ]);
  const connectionIds = [speech?.customEndpoint.connection_id, transcription?.customEndpoint.connection_id].filter(
    (value): value is number => typeof value === "number",
  );
  if (connectionIds.length !== 2) return { status: "write-failed" };

  await dependencies.refresh(input.serverDiscId);
  return {
    status: "success",
    entryId: `endpoint:${Math.min(...connectionIds)}`,
    displayName: ELEVENLABS_SERVICE_NAME,
    updated: false,
  };
}

async function addBraveProvider(
  input: Extract<AddServerProviderInput, { scopeKind?: "server" }>,
  dependencies: AddServerProviderDependencies,
): Promise<AddServerProviderResult> {
  if (!(await dependencies.validateBrave(input.apiKey))) return { status: "validation-failed" };
  if (!(await dependencies.storeOptionalKey(input.state.server_id, "brave-search", input.apiKey))) {
    return { status: "write-failed" };
  }
  await dependencies.refresh(input.serverDiscId);
  return { status: "success", entryId: "brave", displayName: "Brave Search", updated: false };
}

async function addCuratedProvider(
  input: Extract<AddServerProviderInput, { scopeKind?: "server" }>,
  provider: string,
  dependencies: AddServerProviderDependencies,
): Promise<AddServerProviderResult> {
  if (!getStaticProviderInfo(provider) || provider === "custom") return { status: "unsupported-provider" };

  let providerInstance: Awaited<ReturnType<typeof ProviderFactory.getProviderByName>>;
  try {
    providerInstance = await dependencies.getProvider(provider);
  } catch (error) {
    // Reported to the actor as an unsupported provider, which is only true for the guard above.
    // Reaching here means construction or loading failed, so the real cause has to be recorded.
    log.error("Provider could not be constructed while adding a server provider", error as Error, {
      errorType: "ProviderPanelOperationFailed",
      metadata: { operation: "addCuratedProvider", provider },
    });
    return { status: "unsupported-provider" };
  }
  const validation = await providerInstance.validateApiKey(input.apiKey);
  if (!validation.valid) return { status: rejectedKeyStatus(validation) };

  const existingConfig = await dependencies.loadSavedConfig(input.state.server_id, provider);
  const encryption = await dependencies.encrypt(input.apiKey);
  const savedConfig = await dependencies.buildSavedConfig({
    serverId: input.state.server_id,
    provider,
    apiKey: encryption.encrypted,
    keyVersion: encryption.version,
    baseConfig: input.state?.config,
    existingConfig,
  });
  if (!(await dependencies.upsertSavedConfig(input.state.server_id, savedConfig))) {
    return { status: "write-failed" };
  }

  const activation = await dependencies.activateText({
    serverDiscId: input.serverDiscId,
    tomoriState: input.state,
    savedConfig,
  });
  if (activation.status === "missing_model") return { status: "missing-model" };
  if (activation.status !== "activated") return { status: "write-failed" };
  if (!(await dependencies.activateSpeechDefaults({ kind: "server", ownerId: input.state.server_id }, provider))) {
    return { status: "write-failed" };
  }

  return {
    status: "success",
    entryId: `provider:${provider}`,
    displayName: getProviderDisplayName(provider),
    modelName: activation.modelName,
    updated: existingConfig !== null,
  };
}

async function addPersonalProvider(
  input: Extract<AddServerProviderInput, { scopeKind: "personal" }>,
): Promise<AddServerProviderResult> {
  const userId = input.ownerId;
  const provider = input.provider.trim().toLowerCase();
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 10) return { status: "invalid-key" };
  if (provider === "brave") return { status: "unsupported-provider" };
  if (provider === "elevenlabs") {
    if (!(await validateElevenLabsApiKey(apiKey)).success) return { status: "validation-failed" };
    const scope = { kind: "personal" as const, ownerId: userId, baseConfig: input.state?.config };
    const [speech, transcription] = await Promise.all([
      registerCustomEndpoint({
        scope,
        label: ELEVENLABS_SERVICE_NAME,
        capability: "speech",
        apiStyle: "elevenlabs",
        endpointUrl: "https://api.elevenlabs.io",
        modelName: null,
        authToken: apiKey,
        extraConfig: { script_markup: "bracket-tags", supports_instruct: false },
      }),
      registerCustomEndpoint({
        scope,
        label: ELEVENLABS_SERVICE_NAME,
        capability: "transcription",
        apiStyle: "elevenlabs-transcription",
        endpointUrl: "https://api.elevenlabs.io",
        modelName: null,
        authToken: apiKey,
        extraConfig: {},
      }),
    ]);
    const connectionIds = [speech?.customEndpoint.connection_id, transcription?.customEndpoint.connection_id].filter(
      (value): value is number => typeof value === "number",
    );
    return connectionIds.length === 2
      ? {
          status: "success",
          entryId: `endpoint:${Math.min(...connectionIds)}`,
          displayName: ELEVENLABS_SERVICE_NAME,
          updated: false,
        }
      : { status: "write-failed" };
  }
  if (!getStaticProviderInfo(provider) || provider === "custom") return { status: "unsupported-provider" };
  let instance: Awaited<ReturnType<typeof ProviderFactory.getProviderByName>>;
  try {
    instance = await ProviderFactory.getProviderByName(provider);
  } catch (error) {
    // Same confusion as the server path: the actor is told the provider is unsupported when the
    // truth is that loading or constructing it threw.
    log.error("Provider could not be constructed while adding a personal provider", error as Error, {
      errorType: "ProviderPanelOperationFailed",
      metadata: { operation: "addPersonalProvider", provider },
    });
    return { status: "unsupported-provider" };
  }
  const validation = await instance.validateApiKey(apiKey);
  if (!validation.valid) return { status: rejectedKeyStatus(validation) };
  const existingConfig = await llmProviderRepo.loadUserSavedProviderConfig(userId, provider);
  const encryption = await encryptApiKey(apiKey);
  const savedConfig = await buildUserSavedProviderConfigFromExistingOrDefaults({
    userId,
    provider,
    apiKey: encryption.encrypted,
    keyVersion: encryption.version,
    baseConfig: input.state?.config,
    existingConfig,
  });
  if (!(await llmProviderRepo.upsertUserSavedProviderConfig(userId, savedConfig))) {
    return { status: "write-failed" };
  }
  const activation = await activatePersonalProviderTextModel({ userId, provider, llmId: savedConfig.llm_id });
  if (activation.status === "missing_model") return { status: "missing-model" };
  if (activation.status !== "activated") return { status: "write-failed" };
  if (!(await activateProviderSpeechDefaults({ kind: "personal", ownerId: userId }, provider))) {
    return { status: "write-failed" };
  }

  return {
    status: "success",
    entryId: `provider:${provider}`,
    displayName: getProviderDisplayName(provider),
    modelName: activation.modelName,
    updated: existingConfig !== null,
  };
}

export async function addServerProvider(
  input: AddServerProviderInput,
  dependencies: AddServerProviderDependencies = defaultAddDependencies,
): Promise<AddServerProviderResult> {
  if (input.scopeKind === "personal") return await addPersonalProvider(input);
  const provider = input.provider.trim().toLowerCase();
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 10) return { status: "invalid-key" };
  if (provider === "elevenlabs") return await addElevenLabsProvider({ ...input, apiKey }, dependencies);
  if (provider === "brave") return await addBraveProvider({ ...input, apiKey }, dependencies);
  return await addCuratedProvider({ ...input, apiKey }, provider, dependencies);
}

export async function addCustomEndpointConnection(
  input: AddCustomEndpointConnectionInput,
  dependencies: AddCustomEndpointConnectionDependencies = defaultAddEndpointDependencies,
): Promise<AddCustomEndpointConnectionResult> {
  const label = normalizeCustomEndpointLabel(input.label);
  const endpointUrl = normalizeCustomEndpointUrlForStorage(input.apiStyle, input.endpointUrl);
  const authToken = input.authToken.trim();
  if (!isValidCustomEndpointLabel(label)) return { status: "invalid-label" };
  const capabilities = CUSTOM_ENDPOINT_CAPABILITIES_BY_API_STYLE[
    input.apiStyle as keyof typeof CUSTOM_ENDPOINT_CAPABILITIES_BY_API_STYLE
  ] as readonly CustomEndpointCapability[] | undefined;
  if (!capabilities) return { status: "invalid-style" };

  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const scopeKind = personal ? "personal" : "server";
  const existingConnections = await dependencies.loadConnections(ownerId, scopeKind, label);
  if (existingConnections.some((row) => row.endpoint_url.replace(/\/+$/, "") !== endpointUrl)) {
    return { status: "label-url-conflict" };
  }
  if (existingConnections.length > 0) return { status: "already-exists" };

  const reachable = await dependencies.validateReachability({
    apiStyle: input.apiStyle,
    endpointUrl,
    apiKey: authToken || null,
  });
  if (!reachable.ok) {
    // An expected refusal: the receipt's `panel_failure` metric counts it, and the raw reason is
    // trace for whoever runs the endpoint, since the receipt shows only the safe subset.
    log.warn(`Custom endpoint add failed reachability (${input.apiStyle}): ${reachable.reason.slice(0, 200)}`);
    return {
      status: "unreachable",
      reason: reachable.reason,
      credentialsWithheld: reachable.credentialsWithheld === true,
    };
  }

  const createdConnectionIds: number[] = [];
  try {
    const encryption = authToken ? await dependencies.encrypt(authToken) : { encrypted: null, version: 1 };
    for (const capability of capabilities) {
      const connectionId = await dependencies.upsertConnection({
        ...(personal ? { userId: ownerId } : { serverId: input.state.server_id }),
        label,
        capability,
        apiStyle: input.apiStyle,
        endpointUrl,
        requiresAuth: authToken.length > 0,
      });
      if (!connectionId) throw new Error("Custom endpoint capability connection could not be saved");
      createdConnectionIds.push(connectionId);

      const provider = buildCustomProviderName(connectionId);
      const savedConfig = personal
        ? await buildUserSavedProviderConfigFromExistingOrDefaults({
            userId: ownerId,
            provider,
            apiKey: encryption.encrypted,
            keyVersion: encryption.version,
            baseConfig: input.state?.config,
          })
        : await dependencies.buildSavedConfig({
            serverId: input.state.server_id,
            provider,
            apiKey: encryption.encrypted,
            keyVersion: encryption.version,
            baseConfig: input.state?.config,
          });
      const upserted = personal
        ? await llmProviderRepo.upsertUserSavedProviderConfig(ownerId, savedConfig as UserSavedProviderConfigUpsert)
        : await dependencies.upsertSavedConfig(input.state.server_id, savedConfig as SavedProviderConfigUpsert);
      if (!upserted) throw new Error("Custom endpoint credential snapshot could not be saved");
    }
  } catch (error) {
    // The rollback below can succeed, so this return is the only surviving evidence that anything
    // went wrong. Binding the error and recording it is what keeps a rolled-back endpoint addition
    // distinguishable from an ordinary validation refusal.
    log.error("Custom endpoint connection could not be saved; rolled back created connections", error, {
      errorType: "CustomEndpointWriteFailed",
      metadata: {
        serverDiscId: input.serverDiscId,
        scopeKind,
        label,
        capabilityCount: capabilities.length,
        createdConnectionCount: createdConnectionIds.length,
      },
    });
    if (createdConnectionIds.length > 0) {
      await dependencies.deleteConnections(ownerId, scopeKind, createdConnectionIds);
    }
    return { status: "write-failed" };
  }
  if (!personal) await dependencies.refresh(input.serverDiscId);
  const representativeId = createdConnectionIds[0];
  return representativeId
    ? { status: "success", entryId: `endpoint:${representativeId}`, label }
    : { status: "write-failed" };
}

async function activateSavedProviderModel(
  input: SaveProviderModelInput,
  provider: string,
  modelId: number,
): Promise<boolean> {
  const personal = input.scopeKind === "personal";
  if (input.capability === "decision") {
    // Removing the edited registration clears any slot still pointing at it, so the replacement takes the slot first.
    if (personal || !input.editingModelId || input.state.config.decision_model_id !== input.editingModelId) return true;
    return await configRepository.updateModelConfig(input.state.server_id, { decision_model_id: modelId });
  }
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const existing = personal
    ? await llmProviderRepo.loadUserSavedProviderConfig(ownerId, provider)
    : await llmProviderRepo.loadSavedProviderConfig(input.state.server_id, provider);
  if (!existing) return false;
  const next = {
    ...existing,
    llm_id: input.capability === "text" ? modelId : existing.llm_id,
    embedding_model_id: input.capability === "embedding" ? modelId : existing.embedding_model_id,
    diffusion_model_id: input.capability === "image" && provider !== "novelai" ? modelId : existing.diffusion_model_id,
    nai_diffusion_model_id:
      input.capability === "image" && provider === "novelai" ? modelId : existing.nai_diffusion_model_id,
    video_model_id: input.capability === "video" ? modelId : existing.video_model_id,
  };
  const saved = personal
    ? await llmProviderRepo.upsertUserSavedProviderConfig(ownerId, next as UserSavedProviderConfigUpsert)
    : await llmProviderRepo.upsertSavedProviderConfig(input.state.server_id, next as SavedProviderConfigUpsert);
  if (!saved) return false;
  const activate = async (): Promise<boolean> => {
    if (personal) {
      if (input.capability === "text") {
        return (
          (await activatePersonalProviderTextModel({ userId: ownerId, provider, llmId: modelId })).status ===
          "activated"
        );
      }
      return await assignPersonalCapabilityToProvider(
        ownerId,
        provider,
        input.capability as PersonalProviderCapability,
        (row) => ({
          ...row,
          embedding_model_id: input.capability === "embedding" ? modelId : row.embedding_model_id,
          diffusion_model_id: input.capability === "image" && provider !== "novelai" ? modelId : row.diffusion_model_id,
          nai_diffusion_model_id:
            input.capability === "image" && provider === "novelai" ? modelId : row.nai_diffusion_model_id,
          video_model_id: input.capability === "video" ? modelId : row.video_model_id,
        }),
      );
    }
    if (input.capability === "text") {
      return (
        (
          await activateServerTextModelFromSavedConfig({
            serverDiscId: input.serverDiscId,
            tomoriState: input.state,
            savedConfig: next as SavedProviderConfigUpsert,
            llmId: modelId,
          })
        ).status === "activated"
      );
    }
    const updated =
      input.capability === "image" && provider === "novelai"
        ? await configRepository.updateNovelaiImagegenConfig(input.state.server_id, {
            nai_diffusion_model_id: modelId,
          })
        : await configRepository.updateModelConfig(input.state.server_id, {
            ...(input.capability === "embedding" ? { embedding_model_id: modelId } : {}),
            ...(input.capability === "image" ? { diffusion_model_id: modelId } : {}),
            ...(input.capability === "video" ? { video_model_id: modelId } : {}),
          });
    if (updated) invalidateTomoriStateCache(input.serverDiscId);
    return updated;
  };
  if (!(await activate())) return false;
  const claimCapability = providerOptionCapabilityForPanel(input.capability);
  if (claimCapability) {
    return claimProviderModelSelection({
      scope: {
        kind: input.scopeKind === "personal" ? "personal" : "server",
        ownerId,
        discordId: input.serverDiscId,
        state: input.state ?? null,
      },
      provider,
      capability: claimCapability,
    });
  }
  return true;
}

async function registerSharedProviderModel(
  input: SaveProviderModelInput,
  provider: string,
): Promise<SaveProviderModelResult> {
  const option = findProviderOption(provider);
  if (option) {
    if (!providerOptionOffersPanelCapability(option, input.capability)) return { status: "unsupported-capability" };
    const scope: ProviderOptionScope = {
      kind: input.scopeKind === "personal" ? "personal" : "server",
      ownerId: input.scopeKind === "personal" ? input.ownerId : input.state.server_id,
      discordId: input.serverDiscId,
      state: input.state ?? null,
    };
    if (!(await option.selection.ensure(scope))) return { status: "write-failed" };
    if (
      option.selection.validateModel &&
      !(await option.selection.validateModel({
        scope,
        capability: input.capability,
        modelCodename: input.codeName.trim(),
      }))
    ) {
      return { status: "invalid-model" };
    }
  }
  if (input.capability === "speech") {
    const personal = input.scopeKind === "personal";
    const ownerId = personal ? input.ownerId : input.state.server_id;
    const result = await registerHostedSpeechModelForScope(
      personal ? { kind: "personal", ownerId: ownerId } : { kind: "server", ownerId: input.state.server_id },
      provider,
      input.codeName,
      input.editingModelId,
    );
    if (result.status === "invalid_model") return { status: "invalid-model" };
    if (result.status === "write_failed") return { status: "write-failed" };
    return { status: "success", entryId: input.entryId, codeName: result.model.codename };
  }
  if (input.capability === "transcription") return { status: "unsupported-capability" };
  if (input.capability === "decision" && provider !== "openrouter" && !option)
    return { status: "unsupported-capability" };
  if (provider === "openrouter" || option) {
    const personal = input.scopeKind === "personal";
    const ownerId = personal ? input.ownerId : input.state.server_id;
    const saved = personal
      ? await llmProviderRepo.loadUserSavedProviderConfig(ownerId, provider)
      : await llmProviderRepo.loadSavedProviderConfig(input.state.server_id, provider);
    if (!saved) return { status: "not-found" };
    if (input.capability === "decision" && input.editingModelId) {
      const owned = await llmModelRepo.loadAvailableDecisionModels(
        option?.catalogProvider ?? provider,
        true,
        personal ? { kind: "personal", ownerId: ownerId } : { kind: "server", ownerId: input.state.server_id },
      );
      if (!owned.some((model) => model.decision_model_id === input.editingModelId && model.is_scoped_registration)) {
        return { status: "not-found" };
      }
    }
    const result = await registerOpenRouterModelForScope(
      personal ? { kind: "personal", ownerId: ownerId } : { kind: "server", ownerId: input.state.server_id },
      input.capability,
      input.codeName,
      input.imageSupportValues
        ? (curatedImageSupportsFromSubmittedValues(input.imageSupportValues, option?.catalogProvider ?? provider) ??
            undefined)
        : undefined,
    );
    if (result.status === "invalid_model") return { status: "invalid-model" };
    if (result.status === "write_failed") return { status: "write-failed" };
    if (result.status === "already_available" && !option) {
      return { status: "already-available" };
    }
    const activated = await activateSavedProviderModel(input, provider, result.model.modelId);
    if (activated && input.editingModelId && input.editingModelId !== result.model.modelId) {
      await removeScopedRegistration(
        personal ? { userId: ownerId } : { serverId: input.state.server_id },
        input.capability,
        input.editingModelId,
      );
    }
    if (activated && input.capability === "decision" && !personal) invalidateTomoriStateCache(input.serverDiscId);
    return activated
      ? {
          status: "success",
          entryId: `provider:${provider}`,
          codeName: result.model.codename,
        }
      : { status: "write-failed" };
  }

  const codeName = input.codeName.trim();
  if (!codeName || codeName.length > 200) return { status: "invalid-model" };
  const existing =
    input.capability === "text"
      ? await llmModelRepo.loadByProviderAndCodename(provider, codeName)
      : input.capability === "embedding"
        ? await llmModelRepo.loadEmbeddingModelByProviderAndCodename(provider, codeName)
        : input.capability === "image"
          ? await llmModelRepo.loadDiffusionModelByProviderAndCodename(provider, codeName)
          : await llmModelRepo.loadVideoGenerationModelByProviderAndCodename(provider, codeName);
  if (existing && !existing.is_scoped_registration) return { status: "already-available" };

  const modelId =
    input.capability === "text"
      ? await llmModelRepo.upsertScopedLlm(
          codeName,
          {
            hasTools: input.hasTools ?? false,
            seesImages: input.seesImages ?? false,
            seesVideos: false,
            seesYoutube: false,
            supportsStructuredOutput: input.supportsStructOutput ?? false,
            strictRoleAlternation: input.strictRoleAlternation ?? false,
            supportsPrefixCompletion: input.supportsPrefixCompletion ?? false,
            supportsAssistantPrefill: input.supportsAssistantPrefill ?? false,
          },
          provider,
        )
      : input.capability === "embedding"
        ? await llmModelRepo.upsertScopedEmbeddingModel(codeName, provider)
        : input.capability === "image"
          ? await llmModelRepo.upsertScopedDiffusionModel(
              codeName,
              provider,
              // Undeclared stays NULL so the model keeps following its provider's defaults.
              input.imageSupportValues
                ? (curatedImageSupportsFromSubmittedValues(input.imageSupportValues, provider) ?? undefined)
                : undefined,
            )
          : await llmModelRepo.upsertScopedVideoModel(codeName, provider);
  if (!modelId) return { status: "write-failed" };

  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const owner = personal ? { userId: ownerId } : { serverId: input.state.server_id };
  const registration =
    input.capability === "text"
      ? await llmProviderRepo.upsertOpenRouterModelRegistration({ ...owner, llmId: modelId })
      : input.capability === "embedding"
        ? await llmProviderRepo.upsertOpenRouterEmbeddingModelRegistration({
            ...owner,
            embeddingModelId: modelId,
          })
        : input.capability === "image"
          ? await llmProviderRepo.upsertOpenRouterImageModelRegistration({ ...owner, diffusionModelId: modelId })
          : await llmProviderRepo.upsertOpenRouterVideoModelRegistration({ ...owner, videoModelId: modelId });
  if (!registration) return { status: "write-failed" };
  if (!(await activateSavedProviderModel(input, provider, modelId))) return { status: "write-failed" };
  if (input.editingModelId && input.editingModelId !== modelId) {
    await removeScopedRegistration(owner, input.capability, input.editingModelId);
  }
  return { status: "success", entryId: `provider:${provider}`, codeName };
}

async function removeScopedRegistration(
  owner: { serverId: number } | { userId: number },
  capability: Exclude<CustomEndpointCapability, "speech" | "transcription">,
  modelId: number,
): Promise<void> {
  if (capability === "decision") {
    if (await llmProviderRepo.deleteDecisionModelRegistration({ ...owner, decisionModelId: modelId })) {
      await llmModelRepo.deleteOrphanedDecisionModel(modelId);
    }
    return;
  }
  if (capability === "text") {
    if (!(await llmProviderRepo.deleteOpenRouterModelRegistration({ ...owner, llmId: modelId }))) return;
    if (
      (await llmModelRepo.countLlmRegistrations(modelId)) === 0 &&
      !(await llmModelRepo.isLlmStillReferenced(modelId))
    ) {
      await llmModelRepo.deleteOrphanedLlm(modelId);
    }
    return;
  }
  if (capability === "embedding") {
    if (!(await llmProviderRepo.deleteOpenRouterEmbeddingModelRegistration({ ...owner, embeddingModelId: modelId }))) {
      return;
    }
    if (
      (await llmModelRepo.countEmbeddingModelRegistrations(modelId)) === 0 &&
      !(await llmModelRepo.isEmbeddingModelStillReferenced(modelId))
    ) {
      await llmModelRepo.deleteOrphanedEmbeddingModel(modelId);
    }
    return;
  }
  if (capability === "image") {
    if (!(await llmProviderRepo.deleteOpenRouterImageModelRegistration({ ...owner, diffusionModelId: modelId }))) {
      return;
    }
    if (
      (await llmModelRepo.countDiffusionModelRegistrations(modelId)) === 0 &&
      !(await llmModelRepo.isDiffusionModelStillReferenced(modelId))
    ) {
      await llmModelRepo.deleteOrphanedDiffusionModel(modelId);
    }
    return;
  }
  if (!(await llmProviderRepo.deleteOpenRouterVideoModelRegistration({ ...owner, videoModelId: modelId }))) return;
  if (
    (await llmModelRepo.countVideoModelRegistrations(modelId)) === 0 &&
    !(await llmModelRepo.isVideoModelStillReferenced(modelId))
  ) {
    await llmModelRepo.deleteOrphanedVideoModel(modelId);
  }
}

async function registerEndpointModel(input: SaveProviderModelInput): Promise<SaveProviderModelResult> {
  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const representativeId = Number(input.entryId.slice("endpoint:".length));
  if (!Number.isSafeInteger(representativeId) || representativeId <= 0) return { status: "not-found" };
  const representative = await llmProviderRepo.loadCustomEndpointConnectionById(representativeId);
  if (
    !representative ||
    (personal
      ? representative.user_id !== ownerId || representative.server_id !== null
      : representative.server_id !== input.state.server_id)
  ) {
    return { status: "not-found" };
  }
  const read = personal
    ? await llmProviderRepo.loadCustomEndpointConnectionsForUserResult(ownerId)
    : await llmProviderRepo.loadCustomEndpointConnectionsForServerResult(input.state.server_id);
  const connection = read.connections.find(
    (candidate) => candidate.label === representative.label && candidate.capability === input.capability,
  );
  if (!connection) return { status: "not-found" };
  const editingEndpoint = input.editingModelId
    ? read.endpoints.find(
        (endpoint) =>
          endpoint.connection_id === connection.connection_id &&
          (input.capability === "speech" || input.capability === "transcription"
            ? endpoint.custom_endpoint_id === input.editingModelId
            : endpoint.model_ref_id === input.editingModelId),
      )
    : undefined;
  if (input.editingModelId && !editingEndpoint?.custom_endpoint_id) return { status: "not-found" };
  if (
    (input.capability === "image" || input.capability === "video") &&
    connection.api_style === "comfyui" &&
    !input.workflow &&
    !editingEndpoint?.extra_config.workflow
  ) {
    return { status: "invalid-model" };
  }

  const workflowConfig = input.workflow
    ? { ...(editingEndpoint?.extra_config ?? {}), workflow: input.workflow }
    : editingEndpoint?.extra_config;
  const speechSettings =
    input.capability === "speech"
      ? speechEndpointSettingsFromSubmittedValues(
          connection.api_style,
          input.speechVoiceMode,
          input.speechScriptMarkup,
          input.speechInstructValues,
        )
      : null;
  const extraConfig =
    input.capability === "image"
      ? {
          ...(workflowConfig ?? {}),
          workflow_supports: imageEndpointSupportsFromSubmittedValues(input.imageSupportValues, connection.api_style),
        }
      : speechSettings
        ? {
            // Merge over the stored row so an edit never drops a key the modal did not present.
            ...(editingEndpoint?.extra_config ?? {}),
            voice_mode: speechSettings.voiceMode,
            script_markup: speechSettings.scriptMarkup,
            supports_instruct: speechSettings.supportsInstruct,
          }
        : workflowConfig;

  const registered = await registerCustomEndpoint({
    scope: personal
      ? { kind: "personal", ownerId: ownerId, baseConfig: input.state?.config }
      : { kind: "server", ownerId: ownerId, baseConfig: input.state.config, serverDiscId: input.serverDiscId },
    label: connection.label,
    capability: input.capability,
    apiStyle: connection.api_style,
    endpointUrl: connection.endpoint_url,
    modelName: input.capability === "speech" || input.capability === "transcription" ? null : input.codeName.trim(),
    numCtx: input.numCtx,
    hasTools: input.hasTools,
    seesImages: input.seesImages,
    supportsStructOutput: input.supportsStructOutput,
    strictRoleAlternation: input.strictRoleAlternation,
    supportsPrefixCompletion: input.supportsPrefixCompletion,
    supportsAssistantPrefill: input.supportsAssistantPrefill,
    verbatimToolCalling: input.verbatimToolCalling,
    extraConfig,
    editingEndpointId: editingEndpoint?.custom_endpoint_id,
  });
  if (!registered) return { status: "write-failed" };
  return {
    status: "success",
    entryId: input.entryId,
    codeName:
      input.capability === "speech" || input.capability === "transcription" ? connection.label : input.codeName.trim(),
  };
}

export async function saveProviderModel(input: SaveProviderModelInput): Promise<SaveProviderModelResult> {
  if (input.capability === "decision" && input.removeDecisionModel) {
    if (!input.editingModelId) return { status: "not-found" };
    const personal = input.scopeKind === "personal";
    const ownerId = personal ? input.ownerId : input.state.server_id;
    const scope = personal
      ? { kind: "personal" as const, ownerId: ownerId }
      : { kind: "server" as const, ownerId: input.state.server_id };
    let provider =
      input.entryId === "provider:openrouter"
        ? "openrouter"
        : (findProviderOption(input.entryId.slice("provider:".length))?.catalogProvider ?? null);
    if (input.entryId.startsWith("endpoint:")) {
      const representative = await llmProviderRepo.loadCustomEndpointConnectionById(Number(input.entryId.slice(9)));
      if (
        !representative ||
        (personal ? representative.user_id !== ownerId : representative.server_id !== scope.ownerId)
      )
        return { status: "not-found" };
      const read = personal
        ? await llmProviderRepo.loadCustomEndpointConnectionsForUserResult(ownerId)
        : await llmProviderRepo.loadCustomEndpointConnectionsForServerResult(scope.ownerId);
      const connection = read.connections.find(
        (row) => row.label === representative.label && row.capability === "decision",
      );
      if (connection) provider = buildCustomProviderName(connection.connection_id);
    }
    if (!provider) return { status: "not-found" };
    const deleted = await llmProviderRepo.deleteOwnedDecisionRegistration(scope, provider, input.editingModelId);
    if (!deleted) return { status: "not-found" };
    if (!personal) invalidateTomoriStateCache(input.serverDiscId);
    log.info(
      `Decision registration ${JSON.stringify({
        provider: provider === "openrouter" ? "openrouter" : "custom",
        modelId: input.editingModelId,
        outcome: "removed",
      })}`,
    );
    return { status: "success", entryId: input.entryId, codeName: input.codeName, removed: true };
  }
  const codeName = input.codeName.trim();
  if (!codeName || codeName.length > 200) return { status: "invalid-model" };
  if (
    (input.capability === "text" || input.capability === "decision") &&
    input.numCtx !== null &&
    input.numCtx !== undefined &&
    (!Number.isSafeInteger(input.numCtx) || input.numCtx < 512 || input.numCtx > 10_000_000)
  ) {
    return { status: "invalid-model" };
  }
  if (input.capability === "decision" && input.entryId.startsWith("endpoint:") && input.numCtx == null) {
    return { status: "invalid-model" };
  }
  if (input.entryId.startsWith("provider:")) {
    const provider = input.entryId.slice("provider:".length).trim().toLowerCase();
    return provider ? await registerSharedProviderModel(input, provider) : { status: "not-found" };
  }
  if (input.entryId.startsWith("endpoint:")) return await registerEndpointModel(input);
  return { status: "not-found" };
}

async function validateProviderCredential(provider: string, apiKey: string): Promise<boolean> {
  try {
    const instance = await ProviderFactory.getProviderByName(provider);
    return (await instance.validateApiKey(apiKey)).valid;
  } catch {
    return false;
  }
}

async function editServerProvider(input: EditProviderInput): Promise<EditProviderResult> {
  const provider = input.provider.trim().toLowerCase();
  if (findProviderOption(provider)) return { status: "not-found" };
  const apiKey = input.apiKey.trim();
  const rotationKey = input.rotationKey.trim();
  const entryId = `provider:${provider}`;
  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  if (personal) {
    if (provider === "brave" || rotationKey || input.deleteRotationKeys) return { status: "invalid-combination" };
    const existing = provider ? await llmProviderRepo.loadUserSavedProviderConfig(ownerId, provider) : null;
    if (!existing || parseCustomProvider(provider)) return { status: "not-found" };
    if (!apiKey) return { status: "unchanged", entryId };
    if (apiKey.length < 10) return { status: "invalid-key" };
    if (!(await validateProviderCredential(provider, apiKey))) return { status: "validation-failed" };
    const encryption = await encryptApiKey(apiKey);
    const nextConfig = { ...existing, api_key: encryption.encrypted, key_version: encryption.version };
    if (!(await llmProviderRepo.upsertUserSavedProviderConfig(ownerId, nextConfig))) {
      return { status: "write-failed" };
    }
    const active = getActivePersonalProviderForCapability(
      await llmProviderRepo.loadUserSavedProviderConfigs(ownerId),
      "text",
    );
    if (active?.provider.toLowerCase() === provider) {
      const activated = await activatePersonalProviderTextModel({
        userId: ownerId,
        provider,
        llmId: nextConfig.llm_id,
      });
      if (activated.status !== "activated") return { status: "write-failed" };
    }
    return { status: "success", entryId, changed: ["api-key"] };
  }
  if (provider === "brave") {
    if (rotationKey || input.deleteRotationKeys) return { status: "invalid-combination" };
    if (!apiKey) return { status: "unchanged", entryId: "brave" };
    if (apiKey.length < 10) return { status: "invalid-key" };
    if (!(await defaultAddDependencies.validateBrave(apiKey))) return { status: "validation-failed" };
    if (!(await storeOptApiKey(input.state.server_id, "brave-search", apiKey))) return { status: "write-failed" };
    invalidateTomoriStateCache(input.serverDiscId);
    return { status: "success", entryId: "brave", changed: ["api-key"] };
  }
  const existing = provider ? await llmProviderRepo.loadSavedProviderConfig(input.state.server_id, provider) : null;
  if (!existing || parseCustomProvider(provider)) return { status: "not-found" };
  if ((apiKey && apiKey.length < 10) || (rotationKey && rotationKey.length < 10)) {
    return { status: "invalid-key" };
  }
  if (rotationKey && input.deleteRotationKeys) return { status: "invalid-combination" };
  if (!apiKey && !rotationKey && !input.deleteRotationKeys) return { status: "unchanged", entryId };

  const credentials = [apiKey, rotationKey].filter(Boolean);
  for (const credential of credentials) {
    if (!(await validateProviderCredential(provider, credential))) return { status: "validation-failed" };
  }

  const changed: string[] = [];
  if (apiKey) {
    const encryption = await encryptApiKey(apiKey);
    const nextConfig = { ...existing, api_key: encryption.encrypted, key_version: encryption.version };
    const updated = await llmProviderRepo.upsertSavedProviderConfig(input.state.server_id, nextConfig, {
      serverDiscId: input.serverDiscId,
    });
    if (!updated) return { status: "write-failed" };
    if (input.state.llm.llm_provider.toLowerCase() === provider) {
      const activated = await activateServerTextModelFromSavedConfig({
        serverDiscId: input.serverDiscId,
        tomoriState: input.state,
        savedConfig: nextConfig,
      });
      if (activated.status !== "activated") return { status: "write-failed" };
    }
    changed.push("api-key");
  }
  if (rotationKey) {
    if (!(await addRotationKey(input.state.server_id, provider, rotationKey))) return { status: "write-failed" };
    invalidateTomoriStateCache(input.serverDiscId);
    changed.push("rotation-key");
  }
  if (input.deleteRotationKeys) {
    const deleted = await purgeRotationKeysForProvider(input.state.server_id, provider);
    if (deleted > 0) {
      invalidateTomoriStateCache(input.serverDiscId);
      changed.push("rotation-keys");
    }
  }
  return changed.length > 0 ? { status: "success", entryId, changed } : { status: "unchanged", entryId };
}

async function editServerEndpoint(input: EditEndpointInput): Promise<EditEndpointResult> {
  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const representativeId = Number(input.entryId.slice("endpoint:".length));
  if (!Number.isSafeInteger(representativeId) || representativeId <= 0) return { status: "not-found" };
  const read = personal
    ? await llmProviderRepo.loadCustomEndpointConnectionsForUserResult(ownerId)
    : await llmProviderRepo.loadCustomEndpointConnectionsForServerResult(input.state.server_id);
  if (read.status === "unavailable") return { status: "write-failed" };
  const representative = read.connections.find((connection) => connection.connection_id === representativeId);
  if (!representative) return { status: "not-found" };
  const group = read.connections.filter((connection) => connection.label === representative.label);
  const isPreset =
    representative.label === ELEVENLABS_SERVICE_NAME &&
    group.every(
      (connection) => connection.api_style === "elevenlabs" || connection.api_style === "elevenlabs-transcription",
    );
  const requestedLabel = normalizeCustomEndpointLabel(input.label || representative.label);
  if (!isPreset && !isValidCustomEndpointLabel(requestedLabel)) return { status: "invalid-label" };
  const endpointUrl = normalizeCustomEndpointUrlForStorage(representative.api_style, input.endpointUrl);
  const authToken = input.authToken.trim();
  const nextLabel = isPreset ? representative.label : requestedLabel;
  const changesUrl = !isPreset && endpointUrl && group.some((connection) => connection.endpoint_url !== endpointUrl);
  const changesLabel = nextLabel !== representative.label;
  const textConnections = group.filter((connection) => connection.capability === "text");
  const handoffEnabled = textConnections.some((connection) => connection.behavior?.vram_handoff);
  // A URL change re-detects too: the stored backend describes the old server, and running its
  // unload API against a different one would fail on every media job.
  const changesHandoff =
    input.unloadDuringComfyUi !== undefined &&
    textConnections.length > 0 &&
    (input.unloadDuringComfyUi !== handoffEnabled || (input.unloadDuringComfyUi && Boolean(changesUrl)));
  if (!changesUrl && !changesLabel && !authToken && !changesHandoff) {
    return { status: "unchanged", entryId: input.entryId };
  }

  if (changesUrl) {
    for (const connection of group) {
      const credential = authToken || (await loadCustomConnectionCredential(connection));
      const reachable = await validateCustomEndpointReachability({
        apiStyle: connection.api_style,
        endpointUrl,
        apiKey: credential,
      });
      if (!reachable.ok) {
        log.warn(
          `Custom endpoint update failed reachability (${connection.api_style}): ${reachable.reason.slice(0, 200)}`,
        );
        return {
          status: "unreachable",
          reason: reachable.reason,
          credentialsWithheld: reachable.credentialsWithheld === true,
        };
      }
    }
  }

  let vramHandoff: VramHandoffChange | undefined;
  if (changesHandoff) {
    let backend: VramHandoffBackend | null = null;
    if (input.unloadDuringComfyUi) {
      // Detected against the URL being saved, so enabling the option and moving the endpoint to a
      // different server in one submit still records the new server's backend.
      const [textConnection] = textConnections;
      if (!textConnection) return { status: "handoff-unsupported" };
      backend = await detectVramHandoffBackend({
        apiStyle: textConnection.api_style,
        endpointUrl: changesUrl ? endpointUrl : textConnection.endpoint_url,
        apiKey: authToken || (await loadCustomConnectionCredential(textConnection)),
      });
      if (!backend) return { status: "handoff-unsupported" };
    }
    vramHandoff = { connectionIds: textConnections.map((connection) => connection.connection_id), backend };
  }

  const encryption = authToken ? await encryptApiKey(authToken) : null;
  const update = {
    connectionIds: group.map((connection) => connection.connection_id),
    label: changesLabel ? nextLabel : undefined,
    endpointUrl: changesUrl ? endpointUrl : undefined,
    encryptedApiKey: encryption?.encrypted ?? undefined,
    keyVersion: encryption?.version,
    vramHandoff,
  };
  const updated = personal
    ? await llmProviderRepo.updateUserCustomEndpointConnectionGroup({ userId: ownerId, ...update })
    : await llmProviderRepo.updateServerCustomEndpointConnectionGroup({ serverId: input.state.server_id, ...update });
  if (!updated) return { status: "write-failed" };
  if (!personal) invalidateTomoriStateCache(input.serverDiscId);
  return { status: "success", entryId: input.entryId, label: nextLabel };
}

export type ActivateWorkspaceEndpointResult =
  | { status: "success"; identity: string; sourceChanged: boolean }
  | { status: "already-active"; identity: string }
  | { status: "not-found" }
  | { status: "write-failed" };

interface ActivateWorkspaceEndpointInput {
  ownerId?: number;
  scopeKind?: "server" | "personal";
  state: TomoriState;
  serverDiscId: string;
  capability: "speech" | "transcription";
  mode?: "design" | "clone";
  customEndpointId: number;
}

export interface ActivateWorkspaceEndpointDependencies {
  loadEndpoints(serverId: number): Promise<CustomEndpointRow[]>;
  setActive: typeof setActiveCustomEndpoint;
  refresh(discordId: string): void | Promise<void>;
}

const defaultActivateEndpointDependencies: ActivateWorkspaceEndpointDependencies = {
  loadEndpoints: (serverId) => llmProviderRepo.loadCustomEndpointsForServer(serverId),
  setActive: setActiveCustomEndpoint,
  refresh: (discordId) => invalidateTomoriStateCache(discordId),
};

/**
 * Activates one speech or transcription endpoint for the workspace.
 *
 * The submitted id is never trusted: `loadEndpoints` is already scoped to this server, so an id
 * belonging to another workspace or to a different capability simply is not in the list and answers
 * `not-found` rather than reaching the write. A changed `api_style` means voices stored against the
 * previous source no longer resolve, which is why the caller must say so in its receipt.
 */
async function activateWorkspaceEndpoint(
  input: ActivateWorkspaceEndpointInput,
  dependencies: ActivateWorkspaceEndpointDependencies = defaultActivateEndpointDependencies,
): Promise<ActivateWorkspaceEndpointResult> {
  if (input.scopeKind === "personal") return { status: "not-found" };

  const endpoints = (await dependencies.loadEndpoints(input.state.server_id)).filter(
    (endpoint) => endpoint.capability === input.capability && endpoint.custom_endpoint_id !== undefined,
  );
  const target = endpoints.find((endpoint) => endpoint.custom_endpoint_id === input.customEndpointId);
  if (!target?.custom_endpoint_id || (input.mode && !supportsSpeechMode(target, input.mode)))
    return { status: "not-found" };

  const identity = `${target.label} (${target.capability})`;
  const previousId =
    input.mode === "design"
      ? input.state.config.speech_design_endpoint_id
      : input.state.config.speech_clone_endpoint_id;
  const previous =
    endpoints.find((endpoint) =>
      input.capability === "speech" ? endpoint.custom_endpoint_id === previousId : endpoint.is_default,
    ) ?? null;
  const selectedInEveryMode =
    input.capability === "speech"
      ? (!supportsSpeechMode(target, "design") ||
          input.state.config.speech_design_endpoint_id === target.custom_endpoint_id) &&
        (!supportsSpeechMode(target, "clone") ||
          input.state.config.speech_clone_endpoint_id === target.custom_endpoint_id)
      : previous?.custom_endpoint_id === target.custom_endpoint_id;
  if (selectedInEveryMode) return { status: "already-active", identity };

  const updated = await dependencies.setActive({
    serverId: input.state.server_id,
    capability: input.capability,
    mode: input.mode,
    customEndpointId: target.custom_endpoint_id,
  });
  if (!updated) return { status: "write-failed" };

  await dependencies.refresh(input.serverDiscId);
  return { status: "success", identity, sourceChanged: previous !== null && previous.api_style !== target.api_style };
}

async function removeServerProviderEntry(input: RemoveProviderEntryInput): Promise<RemoveProviderEntryResult> {
  const personal = input.scopeKind === "personal";
  const ownerId = personal ? input.ownerId : input.state.server_id;
  const option = input.entry.kind === "provider" ? findProviderOption(input.entry.provider) : undefined;
  if (option) {
    const status = await option.selection.remove({
      kind: personal ? "personal" : "server",
      ownerId,
      discordId: input.serverDiscId,
      state: input.state ?? null,
    });
    if (status === "active" || status === "not-found" || status === "write-failed") return { status };
    if (!personal) invalidateTomoriStateCache(input.serverDiscId);
    return { status: "success", entryId: input.entry.id, displayName: input.entry.displayName };
  }
  if (personal) {
    const activeProvider = getActivePersonalProviderForCapability(
      await llmProviderRepo.loadUserSavedProviderConfigs(ownerId),
      "text",
    )?.provider.toLowerCase();
    if (input.entry.kind === "brave") return { status: "not-found" };
    if (input.entry.kind === "provider") {
      if (activeProvider === input.entry.provider.toLowerCase()) return { status: "active" };
      if (!(await llmProviderRepo.deleteUserProviderRegistration(ownerId, input.entry.provider))) {
        return { status: "not-found" };
      }
    } else {
      const providerKeys = input.entry.connectionIds.map((connectionId) => buildCustomProviderName(connectionId));
      if (activeProvider && providerKeys.includes(activeProvider)) return { status: "active" };
      if (!(await llmProviderRepo.deleteUserCustomEndpointConnectionGroup(ownerId, input.entry.connectionIds))) {
        return { status: "not-found" };
      }
    }
    return { status: "success", entryId: input.entry.id, displayName: input.entry.displayName };
  }
  const textProvider = input.state.llm.llm_provider.toLowerCase();
  const activeProvider =
    findProviderOptionByActiveProvider(
      textProvider,
      { kind: "server", ownerId: input.state.server_id, state: input.state },
      "text",
    )?.value ?? textProvider;
  if (input.entry.kind === "brave") {
    if (!(await deleteOptApiKey(input.state.server_id, "brave-search"))) return { status: "write-failed" };
  } else if (input.entry.kind === "provider") {
    if (activeProvider === input.entry.provider.toLowerCase()) return { status: "active" };
    const deleted = await llmProviderRepo.deleteServerProviderRegistration(input.state.server_id, input.entry.provider);
    if (!deleted) return { status: "not-found" };
  } else {
    const providerKeys = input.entry.connectionIds.map((connectionId) => buildCustomProviderName(connectionId));
    if (providerKeys.includes(activeProvider)) return { status: "active" };
    const deleted = await llmProviderRepo.deleteServerCustomEndpointConnectionGroup(
      input.state.server_id,
      input.entry.connectionIds,
    );
    if (!deleted) return { status: "not-found" };
  }
  invalidateTomoriStateCache(input.serverDiscId);
  return { status: "success", entryId: input.entry.id, displayName: input.entry.displayName };
}

export const providerPanelOperations = {
  loadServerProviderPanelScope,
  loadPersonalProviderPanelScope,
  addServerProvider,
  addCustomEndpointConnection,
  saveProviderModel,
  editServerProvider,
  editServerEndpoint,
  activateWorkspaceEndpoint,
  removeServerProviderEntry,
};
