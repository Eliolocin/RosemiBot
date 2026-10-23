import type {
  CustomEndpointCapability,
  DiffusionModelRow,
  LlmRow,
  PersonalProviderCapability,
  SavedProviderConfigRow,
  SavedProviderConfigUpsert,
  TomoriState,
  AssembledServerConfig,
  UserSavedProviderConfigRow,
  UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import { DEFAULT_THINKING_LEVEL } from "@/constants/thinkingLevels";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import type { OpenRouterModelScope } from "@/utils/db/repositories/LlmModelRepository";
import { supportsSpeechMode } from "@/utils/speech/voiceSourceCapabilities";
import {
  isCustomProvider,
  parseCustomProvider,
  rememberCustomProviderLabel,
} from "@/utils/provider/customProviderUtils";
import {
  getStaticProviderInfo,
  supportsEmbeddingCapability,
  supportsImageCapability,
  supportsVideoCapability,
  supportsVisionCapability,
} from "@/utils/provider/providerInfoRegistry";
import { findProviderOption, providerOptionOffersPersonalCapability } from "@/utils/provider/providerOptionRegistry";

export type SavedProviderCapability =
  | "text"
  | "embedding"
  | "image"
  | "video"
  | "vision"
  | "speech_design"
  | "speech_clone";

interface ProviderDefaultSelectionIds {
  llm_id: number | null;
  diffusion_model_id: number | null;
  embedding_model_id: number | null;
  nai_diffusion_model_id: number | null;
  video_model_id: number | null;
  vision_llm_id: number | null;
}

/**
 * Decide whether a saved text-model selection must fall back to the provider default.
 *
 * Active selections are preserved across credential updates, including deliberate
 * non-default choices. Missing, deprecated, or cross-provider references are not
 * usable and should be replaced with the provider's current default.
 *
 * @param provider - Provider owning the saved configuration
 * @param model - Model currently referenced by the saved configuration
 * @returns Whether the caller should load and store the current provider default
 */
export function shouldRefreshSavedTextModel(
  provider: string,
  model: Pick<LlmRow, "llm_provider" | "is_deprecated"> | null,
): boolean {
  return model === null || model.is_deprecated || model.llm_provider.toLowerCase() !== provider.toLowerCase();
}

/**
 * Decide whether a saved image-model selection must fall back to the provider default.
 *
 * Mirrors {@link shouldRefreshSavedTextModel} for `image_diffusion_models`, which backs both the
 * `diffusion_model_id` and `nai_diffusion_model_id` selections. Without this, a server stays
 * pointed at a codename the provider has retired and every generation fails.
 *
 * @param provider - Provider owning the saved configuration
 * @param model - Diffusion model currently referenced by the saved configuration
 * @returns Whether the caller should load and store the current provider default
 */
export function shouldRefreshSavedDiffusionModel(
  provider: string,
  model: Pick<DiffusionModelRow, "provider" | "is_deprecated"> | null,
): boolean {
  return model === null || model.is_deprecated || model.provider.toLowerCase() !== provider.toLowerCase();
}

async function loadProviderDefaultSelectionIds(provider: string): Promise<ProviderDefaultSelectionIds> {
  const normalizedProvider = provider.toLowerCase();

  if (isCustomProvider(normalizedProvider)) {
    return {
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      video_model_id: null,
      vision_llm_id: null,
    };
  }

  const [defaultTextModel, defaultEmbeddingModel, defaultDiffusionModel, defaultVideoModel] = await Promise.all([
    llmModelRepo.loadDefaultModel(normalizedProvider),
    llmModelRepo.loadDefaultEmbeddingModel(normalizedProvider),
    llmModelRepo.loadDefaultDiffusionModel(normalizedProvider),
    llmModelRepo.loadDefaultVideoGenerationModel(normalizedProvider),
  ]);

  const imageGenerationStyle = getStaticProviderInfo(normalizedProvider)?.featureSupport.imageGeneration ?? "none";

  return {
    llm_id: defaultTextModel?.llm_id ?? null,
    diffusion_model_id:
      imageGenerationStyle === "chat-completion" ? (defaultDiffusionModel?.diffusion_model_id ?? null) : null,
    embedding_model_id: defaultEmbeddingModel?.embedding_model_id ?? null,
    nai_diffusion_model_id:
      imageGenerationStyle === "nai-pipeline" ? (defaultDiffusionModel?.diffusion_model_id ?? null) : null,
    video_model_id: defaultVideoModel?.video_model_id ?? null,
    // Vision is an opt-in fallback slot, never seeded: a provider whose default text model happens
    // to see images would otherwise silently fill it with the model already answering chat.
    vision_llm_id: null,
  };
}

/**
 * Resolve which of the two saved image-model selections are unusable.
 *
 * Both `diffusion_model_id` and `nai_diffusion_model_id` index `image_diffusion_models`, so both
 * carry the same retirement exposure and are checked against their own provider default.
 *
 * @param provider - Normalized provider owning the saved configuration
 * @param existingConfig - Saved configuration being rebuilt, or null for a fresh one
 * @returns Whether each selection should be replaced with the provider default
 */
async function resolveDiffusionRefreshFlags(
  provider: string,
  existingConfig: {
    diffusion_model_id?: number | null;
    nai_diffusion_model_id?: number | null;
  } | null,
): Promise<{ refreshDiffusionModel: boolean; refreshNaiDiffusionModel: boolean }> {
  const diffusionModelId = existingConfig?.diffusion_model_id ?? null;
  const naiDiffusionModelId = existingConfig?.nai_diffusion_model_id ?? null;

  const [diffusionModel, naiDiffusionModel] = await Promise.all([
    diffusionModelId ? llmModelRepo.loadDiffusionModelById(diffusionModelId) : null,
    naiDiffusionModelId ? llmModelRepo.loadDiffusionModelById(naiDiffusionModelId) : null,
  ]);

  return {
    refreshDiffusionModel: shouldRefreshSavedDiffusionModel(provider, diffusionModel),
    refreshNaiDiffusionModel: shouldRefreshSavedDiffusionModel(provider, naiDiffusionModel),
  };
}

export async function buildSavedProviderConfigFromExistingOrDefaults(params: {
  serverId: number;
  provider: string;
  apiKey: Buffer | null;
  keyVersion: number;
  baseConfig: AssembledServerConfig;
  existingConfig?: SavedProviderConfigRow | null;
  llmId?: number | null;
}): Promise<SavedProviderConfigUpsert> {
  const normalizedProvider = params.provider.toLowerCase();
  const existingConfig = params.existingConfig ?? null;
  const candidateLlmId = params.llmId ?? existingConfig?.llm_id ?? null;
  const candidateLlm = candidateLlmId ? await llmModelRepo.loadById(candidateLlmId) : null;
  const refreshTextModel = shouldRefreshSavedTextModel(normalizedProvider, candidateLlm);
  const { refreshDiffusionModel, refreshNaiDiffusionModel } = await resolveDiffusionRefreshFlags(
    normalizedProvider,
    existingConfig,
  );
  const defaults =
    !existingConfig || refreshTextModel || refreshDiffusionModel || refreshNaiDiffusionModel
      ? await loadProviderDefaultSelectionIds(normalizedProvider)
      : null;

  const imageGenerationStyle = getStaticProviderInfo(normalizedProvider)?.featureSupport.imageGeneration ?? "none";

  return {
    server_id: params.serverId,
    provider: normalizedProvider,
    api_key: params.apiKey,
    key_version: params.keyVersion,
    llm_id: refreshTextModel ? (defaults?.llm_id ?? null) : candidateLlmId,
    diffusion_model_id:
      imageGenerationStyle === "chat-completion"
        ? refreshDiffusionModel
          ? (defaults?.diffusion_model_id ?? null)
          : (existingConfig?.diffusion_model_id ?? null)
        : null,
    embedding_model_id: existingConfig?.embedding_model_id ?? defaults?.embedding_model_id ?? null,
    nai_diffusion_model_id:
      imageGenerationStyle === "nai-pipeline"
        ? refreshNaiDiffusionModel
          ? (defaults?.nai_diffusion_model_id ?? null)
          : (existingConfig?.nai_diffusion_model_id ?? null)
        : null,
    video_model_id: existingConfig?.video_model_id ?? defaults?.video_model_id ?? null,
    vision_llm_id: existingConfig?.vision_llm_id ?? null,
    nai_preset_name: existingConfig?.nai_preset_name ?? null,
    llm_temperature: existingConfig?.llm_temperature ?? params.baseConfig.llm_temperature,
    llm_top_p: existingConfig?.llm_top_p ?? params.baseConfig.llm_top_p,
    llm_top_k: existingConfig?.llm_top_k ?? params.baseConfig.llm_top_k,
    llm_frequency_penalty: existingConfig?.llm_frequency_penalty ?? params.baseConfig.llm_frequency_penalty,
    llm_presence_penalty: existingConfig?.llm_presence_penalty ?? params.baseConfig.llm_presence_penalty,
    llm_min_p: existingConfig?.llm_min_p ?? params.baseConfig.llm_min_p,
    llm_max_output_tokens: existingConfig?.llm_max_output_tokens ?? params.baseConfig.llm_max_output_tokens,
    llm_disabled_params: existingConfig?.llm_disabled_params ?? params.baseConfig.llm_disabled_params ?? [],
    llm_logit_biases: existingConfig?.llm_logit_biases ?? params.baseConfig.llm_logit_biases ?? [],
    thinking_level: existingConfig?.thinking_level ?? params.baseConfig.thinking_level,
    fallback_model_refs: existingConfig?.fallback_model_refs ?? [],
  };
}

export async function buildUserSavedProviderConfigFromExistingOrDefaults(params: {
  userId: number;
  provider: string;
  apiKey: Buffer | null;
  keyVersion: number;
  baseConfig?: AssembledServerConfig;
  existingConfig?: UserSavedProviderConfigRow | null;
  llmId?: number | null;
  enabledCapabilities?: PersonalProviderCapability[];
}): Promise<UserSavedProviderConfigUpsert> {
  const normalizedProvider = params.provider.toLowerCase();
  const existingConfig = params.existingConfig ?? null;
  const candidateLlmId = params.llmId ?? existingConfig?.llm_id ?? null;
  const candidateLlm = candidateLlmId ? await llmModelRepo.loadById(candidateLlmId) : null;
  const refreshTextModel = shouldRefreshSavedTextModel(normalizedProvider, candidateLlm);
  const { refreshDiffusionModel, refreshNaiDiffusionModel } = await resolveDiffusionRefreshFlags(
    normalizedProvider,
    existingConfig,
  );
  const defaults =
    !existingConfig || refreshTextModel || refreshDiffusionModel || refreshNaiDiffusionModel
      ? await loadProviderDefaultSelectionIds(normalizedProvider)
      : null;
  const enabledCapabilities = params.enabledCapabilities ?? existingConfig?.enabled_capabilities ?? [];

  const imageGenerationStyle = getStaticProviderInfo(normalizedProvider)?.featureSupport.imageGeneration ?? "none";

  return {
    user_id: params.userId,
    provider: normalizedProvider,
    api_key: params.apiKey,
    key_version: params.keyVersion,
    llm_id: refreshTextModel ? (defaults?.llm_id ?? null) : candidateLlmId,
    diffusion_model_id:
      imageGenerationStyle === "chat-completion"
        ? refreshDiffusionModel
          ? (defaults?.diffusion_model_id ?? null)
          : (existingConfig?.diffusion_model_id ?? null)
        : null,
    embedding_model_id: existingConfig?.embedding_model_id ?? defaults?.embedding_model_id ?? null,
    nai_diffusion_model_id:
      imageGenerationStyle === "nai-pipeline"
        ? refreshNaiDiffusionModel
          ? (defaults?.nai_diffusion_model_id ?? null)
          : (existingConfig?.nai_diffusion_model_id ?? null)
        : null,
    video_model_id: existingConfig?.video_model_id ?? defaults?.video_model_id ?? null,
    speech_design_model_id: existingConfig?.speech_design_model_id ?? null,
    speech_clone_model_id: existingConfig?.speech_clone_model_id ?? null,
    vision_llm_id: existingConfig?.vision_llm_id ?? null,
    nai_preset_name: existingConfig?.nai_preset_name ?? null,
    llm_temperature: existingConfig?.llm_temperature ?? params.baseConfig?.llm_temperature ?? null,
    llm_top_p: existingConfig?.llm_top_p ?? params.baseConfig?.llm_top_p ?? null,
    llm_top_k: existingConfig?.llm_top_k ?? params.baseConfig?.llm_top_k ?? null,
    llm_frequency_penalty: existingConfig?.llm_frequency_penalty ?? params.baseConfig?.llm_frequency_penalty ?? null,
    llm_presence_penalty: existingConfig?.llm_presence_penalty ?? params.baseConfig?.llm_presence_penalty ?? null,
    llm_min_p: existingConfig?.llm_min_p ?? params.baseConfig?.llm_min_p ?? null,
    llm_max_output_tokens: existingConfig?.llm_max_output_tokens ?? params.baseConfig?.llm_max_output_tokens ?? null,
    llm_disabled_params: existingConfig?.llm_disabled_params ?? params.baseConfig?.llm_disabled_params ?? [],
    llm_logit_biases: existingConfig?.llm_logit_biases ?? params.baseConfig?.llm_logit_biases ?? [],
    thinking_level: existingConfig?.thinking_level ?? params.baseConfig?.thinking_level ?? DEFAULT_THINKING_LEVEL,
    enabled_capabilities: enabledCapabilities,
    // Anything switched on here is owned here. Previously assigned capabilities are
    // kept even when currently off, so a re-enable still resolves to this provider.
    assigned_capabilities: Array.from(
      new Set([...(existingConfig?.assigned_capabilities ?? []), ...enabledCapabilities]),
    ),
  };
}

function mapSavedCapabilityToCustomEndpointCapability(
  capability: SavedProviderCapability,
): CustomEndpointCapability | null {
  switch (capability) {
    case "text":
    case "embedding":
    case "image":
    case "video":
      return capability;
    case "vision":
      return "text";
    default:
      return null;
  }
}

async function hasRegisteredCustomEndpointCapability(
  provider: string,
  capability: SavedProviderCapability,
  owner: OpenRouterModelScope,
): Promise<boolean> {
  const parsed = parseCustomProvider(provider);
  const endpointCapability = mapSavedCapabilityToCustomEndpointCapability(capability);

  if (!parsed || !endpointCapability) {
    return false;
  }

  const connection = await llmProviderRepo.loadCustomEndpointConnectionById(parsed.connectionId);
  if (!connection || connection.capability !== endpointCapability) {
    return false;
  }
  if ((owner.kind === "server" ? connection.server_id : connection.user_id) !== owner.ownerId) {
    return false;
  }
  rememberCustomProviderLabel(provider, connection.label);

  if (capability === "vision") {
    const endpoints = await llmProviderRepo.loadCustomEndpointsByConnectionId(parsed.connectionId);
    return endpoints.some((row) => row.capability === "text" && row.sees_images);
  }

  return true;
}

/** The model-selection columns shared by the server and user saved-provider rows. */
type SavedProviderModelSelection = Pick<
  SavedProviderConfigRow,
  "llm_id" | "embedding_model_id" | "diffusion_model_id" | "nai_diffusion_model_id" | "video_model_id" | "vision_llm_id"
>;

/** Whether one saved row's selections make it eligible to serve `capability`. */
function savedProviderSelectionServesCapability(
  provider: string,
  capability: SavedProviderCapability,
  config: SavedProviderModelSelection,
): boolean {
  const option = findProviderOption(provider);
  if (option) return providerOptionOffersPersonalCapability(option, capability);
  if (!isCustomProvider(provider)) {
    switch (capability) {
      case "text":
        return true;
      case "embedding":
        return supportsEmbeddingCapability(provider);
      case "image":
        return supportsImageCapability(provider);
      case "video":
        return supportsVideoCapability(provider);
      case "vision":
        return supportsVisionCapability(provider);
      default:
        return false;
    }
  }

  switch (capability) {
    case "text":
      return config.llm_id !== null;
    case "embedding":
      return config.embedding_model_id !== null;
    case "image":
      return config.diffusion_model_id !== null || config.nai_diffusion_model_id !== null;
    case "video":
      return config.video_model_id !== null;
    // Unlike the other slots, vision has no saved selection to require: registering an
    // image-capable text endpoint is what makes the label eligible, and the picker chooses
    // among that label's image-capable models.
    case "vision":
      return true;
    default:
      return false;
  }
}

/**
 * Keeps the saved rows whose provider is registered for `capability`.
 *
 * Server and user scopes share the eligibility rules and differ only in which registry they read
 * and which owner a custom endpoint connection must belong to.
 *
 * @param savedConfigs - Rows loaded for the scope
 * @param owner - Scope a custom endpoint connection must belong to
 */
async function filterSavedProvidersByCapability<
  T extends SavedProviderModelSelection & Pick<SavedProviderConfigRow, "provider" | "api_key">,
>(savedConfigs: readonly T[], capability: SavedProviderCapability, owner: OpenRouterModelScope): Promise<T[]> {
  const available = await Promise.all(
    savedConfigs.map(async (config) => {
      const option = findProviderOption(config.provider);
      return !option || (await option.availability({ kind: owner.kind, ownerId: owner.ownerId })).eligible;
    }),
  );
  const availableConfigs = savedConfigs.filter((_config, index) => available[index]);
  if (capability === "speech_design" || capability === "speech_clone") {
    // Speech is a hosted-model capability only: custom speech endpoints are activated per server,
    // and a provider qualifies only while its key can reach a usable model for the mode.
    const mode = capability === "speech_design" ? "design" : "clone";
    const servesMode = await Promise.all(
      availableConfigs.map(
        async (config) =>
          !isCustomProvider(config.provider) &&
          (findProviderOption(config.provider) !== undefined || config.api_key !== null) &&
          (
            await llmModelRepo.loadAvailableSpeechModels(
              findProviderOption(config.provider)?.catalogProvider ?? config.provider,
              owner,
            )
          ).some((model) => supportsSpeechMode(model, mode)),
      ),
    );
    return availableConfigs.filter((_config, index) => servesMode[index]);
  }

  const registeredVisibility = await Promise.all(
    availableConfigs.map(async (config) => {
      if (!isCustomProvider(config.provider)) {
        return true;
      }

      return await hasRegisteredCustomEndpointCapability(config.provider, capability, owner);
    }),
  );

  return availableConfigs.filter(
    (config, index) =>
      registeredVisibility[index] && savedProviderSelectionServesCapability(config.provider, capability, config),
  );
}

export async function loadSavedProvidersForCapability(
  serverId: number,
  capability: SavedProviderCapability,
): Promise<SavedProviderConfigRow[]> {
  const savedConfigs = await llmProviderRepo.loadSavedProviderConfigs(serverId);
  return await filterSavedProvidersByCapability(savedConfigs, capability, { kind: "server", ownerId: serverId });
}

export async function loadUserSavedProvidersForCapability(
  userId: number,
  capability: SavedProviderCapability,
): Promise<UserSavedProviderConfigRow[]> {
  const savedConfigs = await llmProviderRepo.loadUserSavedProviderConfigs(userId);
  return await filterSavedProvidersByCapability(savedConfigs, capability, { kind: "personal", ownerId: userId });
}

/**
 * Points a state at a saved provider's credential and samplers, for a model override that crosses
 * providers. The key moves with the model because `config.api_key` is sent to whichever provider
 * `llm` names, including by the background model-limits lookup; a stale key would reach the wrong
 * vendor. No saved config clears the key rather than keeping the base provider's.
 */
export function withSavedProviderConfig(
  tomoriState: TomoriState,
  savedConfig:
    | (Pick<SavedProviderConfigRow, "api_key"> &
        Partial<
          Pick<
            SavedProviderConfigRow,
            | "key_version"
            | "llm_temperature"
            | "llm_top_p"
            | "llm_top_k"
            | "llm_frequency_penalty"
            | "llm_presence_penalty"
            | "llm_min_p"
            | "thinking_level"
            | "llm_disabled_params"
            | "llm_logit_biases"
          >
        >)
    | null,
): TomoriState {
  const { config } = tomoriState;
  return {
    ...tomoriState,
    config: {
      ...config,
      api_key: savedConfig?.api_key ?? null,
      key_version: savedConfig?.key_version ?? 1,
      llm_temperature: savedConfig?.llm_temperature ?? config.llm_temperature,
      llm_top_p: savedConfig?.llm_top_p ?? config.llm_top_p,
      llm_top_k: savedConfig?.llm_top_k ?? config.llm_top_k,
      llm_frequency_penalty: savedConfig?.llm_frequency_penalty ?? config.llm_frequency_penalty,
      llm_presence_penalty: savedConfig?.llm_presence_penalty ?? config.llm_presence_penalty,
      llm_min_p: savedConfig?.llm_min_p ?? config.llm_min_p,
      thinking_level: savedConfig?.thinking_level ?? config.thinking_level,
      llm_disabled_params: savedConfig?.llm_disabled_params ?? config.llm_disabled_params,
      llm_logit_biases: savedConfig?.llm_logit_biases ?? config.llm_logit_biases,
    },
  };
}
