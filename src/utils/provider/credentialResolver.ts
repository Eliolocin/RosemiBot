import type {
  LlmRow,
  SubscriptionCapability,
  CustomEndpointRow,
  PersonalProviderCapability,
  SavedProviderConfigRow,
  AssembledServerConfig,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { personalProviderCapabilitySchema } from "@/types/db/schema";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCustomEndpointForProvider } from "@/utils/provider/customEndpointService";
import { decryptApiKey } from "@/utils/security/crypto";
import { CUSTOM_ENDPOINT_PLACEHOLDER_KEY } from "@/utils/provider/legacyCustomProvider";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import { isSupporterBillingEnabled, SUPPORTER_PROVIDER_VALUE } from "@/modules/supporter-billing/config";
import { resolveEnvironment } from "@/types/config";
import { resolveSupporterCapabilityCredentials } from "@/modules/supporter-billing/runtime/managedProvider";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";
import {
  SupporterRequestDeniedError,
  findSupporterRequestDeniedError,
} from "@/modules/supporter-billing/runtime/funding";
import { getSupporterRequestFailureCopy } from "@/modules/supporter-billing/discord/requestFailure";
import { localizer } from "@/utils/text/localizer";

export type Capability = "text" | "embedding" | "image-standard" | "image-nai" | "video" | "vision";

export interface ResolvedCredentials {
  provider: string;
  apiKey: string;
  keyVersion: number;
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow | null;
  source: "server" | "personal";
  customEndpoint?: CustomEndpointRow;
  apiStyle?: string;
  supporterFunding?: SupporterFundingContext;
  modelId?: number;
}

interface ResolverOptions {
  userId?: number | null;
  textModel?: LlmRow;
}

type CapabilityConfigColumns = Pick<
  AssembledServerConfig,
  | "llm_id"
  | "embedding_model_id"
  | "diffusion_model_id"
  | "nai_diffusion_model_id"
  | "video_model_id"
  | "vision_llm_id"
  | "user_byok_mode"
  | "subscription_capabilities"
>;

export class CredentialUnavailableError extends Error {
  constructor(
    public provider: string,
    public capability: Capability,
    public reason: "no_saved_config" | "decryption_failed" | "placeholder_key" | "missing_model_id",
    public source: "server" | "personal" = "server",
  ) {
    super(`No usable credentials for ${provider} (${capability}, ${source}): ${reason}`);
    this.name = "CredentialUnavailableError";
  }
}

export class PersonalProviderRequiredError extends Error {
  constructor(public capability: Capability) {
    super(`A personal provider is required for ${capability}`);
    this.name = "PersonalProviderRequiredError";
  }
}

export function getCapabilityCredentialFailureCopy(
  error: unknown,
  locale: string,
): { titleKey: string; description: string } | null {
  const denied = findSupporterRequestDeniedError(error);
  if (denied) return getSupporterRequestFailureCopy(denied, locale);
  const keys =
    error instanceof PersonalProviderRequiredError
      ? {
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
        }
      : error instanceof CredentialUnavailableError
        ? error.source === "personal"
          ? {
              titleKey: "general.errors.personal_provider_credentials_error_title",
              descriptionKey: "general.errors.personal_provider_credentials_error_description",
            }
          : error.reason === "decryption_failed"
            ? {
                titleKey: "general.errors.api_key_error_title",
                descriptionKey: "general.errors.api_key_error_description",
              }
            : {
                titleKey: "general.errors.api_key_missing_title",
                descriptionKey: "general.errors.api_key_missing_description",
              }
        : null;
  return keys ? { titleKey: keys.titleKey, description: localizer(locale, keys.descriptionKey) } : null;
}

function mapCapabilityToPersonalCapability(capability: Capability): PersonalProviderCapability {
  switch (capability) {
    case "text":
      return "text";
    case "embedding":
      return "embedding";
    case "image-standard":
      return "image";
    case "image-nai":
      return "image_nai";
    case "video":
      return "video";
    case "vision":
      return "vision";
  }
}

function getCapabilityModelId(
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow,
  capability: Capability,
): number | null {
  switch (capability) {
    case "text":
      return savedConfig.llm_id ?? null;
    case "embedding":
      return savedConfig.embedding_model_id ?? null;
    case "image-standard":
      return savedConfig.diffusion_model_id ?? null;
    case "image-nai":
      return savedConfig.nai_diffusion_model_id ?? null;
    case "video":
      return savedConfig.video_model_id ?? null;
    case "vision":
      return savedConfig.vision_llm_id ?? null;
  }
}

/**
 * Reads the active model id for a capability from live server config columns.
 *
 * Used to tell the custom-endpoint resolver which specific model is active (server scope), so the
 * correct endpoint row is chosen when a label hosts several models of the same capability.
 */
function capabilityModelIdFromColumns(config: CapabilityConfigColumns | null, capability: Capability): number | null {
  if (!config) {
    return null;
  }
  switch (capability) {
    case "text":
      return config.llm_id ?? null;
    case "embedding":
      return config.embedding_model_id ?? null;
    case "image-standard":
      return config.diffusion_model_id ?? null;
    case "image-nai":
      return config.nai_diffusion_model_id ?? null;
    case "video":
      return config.video_model_id ?? null;
    case "vision":
      return config.vision_llm_id ?? null;
  }
}

export function getResolvedCapabilityModelId(
  resolved: Pick<ResolvedCredentials, "savedConfig" | "source" | "modelId">,
  capability: Capability,
): number | null {
  if (resolved.modelId !== undefined) return resolved.modelId;
  if (resolved.source === "server" || !resolved.savedConfig) {
    return null;
  }
  return getCapabilityModelId(resolved.savedConfig, capability);
}

async function loadCapabilityConfig(serverId: number): Promise<CapabilityConfigColumns | null> {
  return configRepository.loadModelCapabilityIds(serverId);
}

function providerSupportsCapability(provider: string, capability: Capability): boolean {
  if (isCustomProvider(provider)) {
    return capability !== "image-nai";
  }
  const info = getStaticProviderInfo(provider);
  if (!info) {
    return true;
  }
  if (capability === "image-standard") {
    return info.featureSupport.imageGeneration === "chat-completion";
  }
  if (capability === "image-nai") {
    return info.featureSupport.imageGeneration === "nai-pipeline";
  }
  return true;
}

async function resolveProviderForCapability(serverId: number, capability: Capability): Promise<string> {
  const config = await loadCapabilityConfig(serverId);
  if (!config) {
    throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
  }

  switch (capability) {
    case "text": {
      if (!config.llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const llm = await llmModelRepo.loadById(config.llm_id);
      if (!llm?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return llm.llm_provider.toLowerCase();
    }
    case "embedding": {
      if (!config.embedding_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const embModel = await llmModelRepo.loadEmbeddingModelById(config.embedding_model_id);
      if (!embModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(embModel.provider).toLowerCase();
    }
    case "image-standard": {
      if (!config.diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const diffModel = await llmModelRepo.loadDiffusionModelById(config.diffusion_model_id);
      if (!diffModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const provider = String(diffModel.provider).toLowerCase();
      if (!providerSupportsCapability(provider, capability)) {
        throw new CredentialUnavailableError(provider, capability, "missing_model_id");
      }
      return provider;
    }
    case "image-nai": {
      if (!config.nai_diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const naiModel = await llmModelRepo.loadDiffusionModelById(config.nai_diffusion_model_id);
      if (!naiModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const provider = String(naiModel.provider).toLowerCase();
      if (!providerSupportsCapability(provider, capability)) {
        throw new CredentialUnavailableError(provider, capability, "missing_model_id");
      }
      return provider;
    }
    case "video": {
      if (!config.video_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const videoModel = await llmModelRepo.loadVideoGenerationModelById(config.video_model_id);
      if (!videoModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(videoModel.provider).toLowerCase();
    }
    case "vision": {
      if (!config.vision_llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const visionLlm = await llmModelRepo.loadById(config.vision_llm_id);
      if (!visionLlm?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return visionLlm.llm_provider.toLowerCase();
    }
  }
}

async function decryptResolvedApiKey(
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow,
  provider: string,
  capability: Capability,
  source: "server" | "personal",
  contextLabel: string,
  activeModelId?: number | null,
): Promise<ResolvedCredentials> {
  if (provider === SUPPORTER_PROVIDER_VALUE) {
    const modelId = activeModelId ?? getCapabilityModelId(savedConfig, capability);
    if (!modelId || capability === "image-nai" || !isSupporterBillingEnabled(resolveEnvironment())) {
      throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
    }
    const credentials = await resolveSupporterCapabilityCredentials({
      scope:
        "user_id" in savedConfig
          ? { kind: "personal", userId: savedConfig.user_id }
          : { kind: "server", serverId: savedConfig.server_id },
      capability: capability === "image-standard" ? "image" : capability,
      modelId,
    });
    return {
      provider: "openrouter",
      apiKey: credentials.apiKey,
      keyVersion: 1,
      savedConfig,
      source,
      supporterFunding: credentials.funding,
      modelId,
    };
  }
  const customEndpointCapability =
    capability === "image-standard"
      ? "image"
      : capability === "vision"
        ? "text"
        : capability === "image-nai"
          ? null
          : capability;
  // Pass the active model id so the right endpoint row is chosen when several models share a
  // label+capability; resolution falls back to the label's default when no id matches.
  const customEndpoint =
    isCustomProvider(provider) && customEndpointCapability
      ? await resolveCustomEndpointForProvider(provider, customEndpointCapability, activeModelId)
      : null;

  if (!savedConfig.api_key) {
    throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
  }

  let decryptedKey: string;
  try {
    decryptedKey = await decryptApiKey(savedConfig.api_key, savedConfig.key_version || 1);
  } catch (error) {
    log.warn(`Failed to decrypt credentials for provider ${provider} (${capability}) on ${contextLabel}`, error);
    throw new CredentialUnavailableError(provider, capability, "decryption_failed", source);
  }

  if (!decryptedKey || decryptedKey === CUSTOM_ENDPOINT_PLACEHOLDER_KEY) {
    if (customEndpoint && customEndpoint.requires_auth === false) {
      return {
        provider,
        apiKey: "",
        keyVersion: savedConfig.key_version || 1,
        savedConfig,
        source,
        customEndpoint,
        apiStyle: customEndpoint.api_style,
      };
    }
    throw new CredentialUnavailableError(provider, capability, "placeholder_key", source);
  }

  return {
    provider,
    apiKey: decryptedKey,
    keyVersion: savedConfig.key_version || 1,
    savedConfig,
    source,
    customEndpoint: customEndpoint ?? undefined,
    apiStyle: customEndpoint?.api_style,
  };
}

async function resolvePersonalCredentials(
  userId: number,
  capability: Capability,
  retainUnavailable = false,
): Promise<ResolvedCredentials | null> {
  const personalCapability = mapCapabilityToPersonalCapability(capability);
  personalProviderCapabilitySchema.parse(personalCapability);

  const qualifyingRows = (await llmProviderRepo.loadUserSavedProviderConfigs(userId))
    .filter((row) => row.provider !== SUPPORTER_PROVIDER_VALUE || isSupporterBillingEnabled(resolveEnvironment()))
    .filter((row) => row.enabled_capabilities.includes(personalCapability))
    .filter((row) => getCapabilityModelId(row, capability) !== null)
    .filter((row) => providerSupportsCapability(row.provider.toLowerCase(), capability))
    .sort((left, right) => left.provider.localeCompare(right.provider));

  if (qualifyingRows.length === 0) {
    return null;
  }

  if (qualifyingRows.length > 1) {
    log.warn(
      `Multiple personal providers matched user ${userId} capability ${capability}. Falling back to ${qualifyingRows[0].provider}.`,
    );
  }

  const savedConfig = qualifyingRows[0];
  try {
    return await decryptResolvedApiKey(
      savedConfig,
      savedConfig.provider.toLowerCase(),
      capability,
      "personal",
      `user ${userId}`,
      getCapabilityModelId(savedConfig, capability),
    );
  } catch (error) {
    if (
      !retainUnavailable &&
      savedConfig.provider === SUPPORTER_PROVIDER_VALUE &&
      isUnavailablePersonalSubscription(error)
    )
      return null;
    throw error;
  }
}

export async function resolvePersonalCapabilityCredentials(
  userId: number,
  capability: Capability,
): Promise<ResolvedCredentials | null> {
  return await resolvePersonalCredentials(userId, capability, true);
}

export async function resolveCapabilityCredentials(
  serverId: number,
  capability: Capability,
  options?: ResolverOptions,
): Promise<ResolvedCredentials> {
  const userId = options?.userId ?? null;
  const capabilityConfig = await loadCapabilityConfig(serverId);

  if (userId !== null) {
    const personalResolved = await resolvePersonalCredentials(userId, capability);
    if (personalResolved) {
      return personalResolved;
    }

    if (capabilityConfig?.user_byok_mode) {
      throw new PersonalProviderRequiredError(capability);
    }
  }

  const provider =
    options?.textModel?.llm_provider.toLowerCase() ?? (await resolveProviderForCapability(serverId, capability));
  const modelId = options?.textModel?.llm_id ?? capabilityModelIdFromColumns(capabilityConfig, capability);
  const subscription =
    provider === "openrouter" &&
    capabilityConfig?.subscription_capabilities.includes(
      mapCapabilityToPersonalCapability(capability) as SubscriptionCapability,
    );
  const savedConfig = await llmProviderRepo.loadSavedProviderConfig(
    serverId,
    subscription ? SUPPORTER_PROVIDER_VALUE : provider,
  );

  if (!savedConfig) {
    throw new CredentialUnavailableError(provider, capability, "no_saved_config", "server");
  }

  return await decryptResolvedApiKey(
    savedConfig,
    subscription ? SUPPORTER_PROVIDER_VALUE : provider,
    capability,
    "server",
    `server ${serverId}`,
    modelId,
  );
}

export function isUnavailablePersonalSubscription(error: unknown): boolean {
  return (
    error instanceof SupporterRequestDeniedError &&
    (error.reason === "missing_subscription" || error.reason === "inactive_entitlement")
  );
}
