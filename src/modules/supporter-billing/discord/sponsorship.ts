import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import {
  isSupporterBillingEnabled,
  parseSupporterBillingConfigJson,
  type SupporterBillingConfig,
  type SupporterBillingTierConfig,
  type SupporterCapability,
  SUPPORTER_PROVIDER_VALUE,
} from "@/modules/supporter-billing/config";
import {
  supporterEntitlementRepository,
  supporterIdentityRepository,
  supporterSponsorshipRepository,
  isSupporterEntitlementActive,
  type SupporterEntitlementRow,
  type SupporterIdentityRow,
  type SupporterServerSponsorshipRow,
} from "@/modules/supporter-billing/db";
import type { AppEnvironment } from "@/types/config";
import { resolveEnvironment } from "@/types/config";
import { invalidateAllChannelLlmCacheForServer } from "@/utils/cache/channelLlmCacheStore";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import type { TomoriState } from "@/types/db/schema";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { validateSupporterModelRegistration } from "@/modules/supporter-billing/runtime/managedProvider";
import { registerOpenRouterModelForScope } from "@/utils/provider/openrouterModelRegistry";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  assignPersonalCapabilityToProvider,
  getActivePersonalProviderForCapability,
} from "@/utils/provider/personalProviderHelpers";
import { saveProviderModel } from "@/utils/provider/providerPanelOperations";
import { ColorCode, log } from "@/utils/misc/logger";
import { validateOpenRouterSpeechModel } from "@/utils/cache/openrouterSpeechModelCache";

type EnvRecord = Readonly<Record<string, string | undefined>>;

export interface SupporterSponsorshipRepositories {
  identityRepository?: Pick<typeof supporterIdentityRepository, "loadByDiscordUserId">;
  entitlementRepository?: Pick<typeof supporterEntitlementRepository, "loadByIdentityId">;
  sponsorshipRepository?: Pick<
    typeof supporterSponsorshipRepository,
    "loadActiveSponsorshipForServer" | "startActiveSponsorship"
  >;
}

export interface SupporterSponsorshipChoiceOptions {
  isGuildContext: boolean;
  environment?: AppEnvironment;
  env?: EnvRecord;
}

export interface ValidateSupporterSponsorshipParams {
  discordUserId: string;
  serverId: number | null;
  serverDiscId: string;
  at?: Date;
  env?: EnvRecord;
  environment?: AppEnvironment;
  config?: SupporterBillingConfig;
  repositories?: SupporterSponsorshipRepositories;
}

export type SupporterSponsorshipValidationFailureReason =
  | "billing_unavailable"
  | "unlinked"
  | "inactive"
  | "inconsistent"
  | "unconfigured_tier";

export type SupporterSponsorshipValidationResult =
  | {
      ok: true;
      config: SupporterBillingConfig;
      tier: SupporterBillingTierConfig;
      identity: SupporterIdentityRow;
      entitlement: SupporterEntitlementRow;
      activeSponsorship: SupporterServerSponsorshipRow | null;
    }
  | {
      ok: false;
      reason: SupporterSponsorshipValidationFailureReason;
    };

const VALIDATION_ERROR_DESCRIPTION_KEYS: Record<SupporterSponsorshipValidationFailureReason, string> = {
  billing_unavailable: "commands.subscribe.sponsorship.errors.billing_unavailable",
  unlinked: "commands.subscribe.sponsorship.errors.unlinked",
  inactive: "commands.subscribe.sponsorship.errors.inactive",
  inconsistent: "commands.subscribe.sponsorship.errors.inconsistent",
  unconfigured_tier: "commands.subscribe.sponsorship.errors.unconfigured_tier",
};

export function getSupporterSponsorshipValidationFailureKey(
  reason: SupporterSponsorshipValidationFailureReason,
): string {
  return VALIDATION_ERROR_DESCRIPTION_KEYS[reason];
}

export function isSupporterSponsorshipChoiceEnabled(options: SupporterSponsorshipChoiceOptions): boolean {
  return (
    options.isGuildContext &&
    isSupporterBillingEnabled(options.environment ?? resolveEnvironment(), options.env ?? process.env)
  );
}

type SupporterDefaultsTarget =
  | { kind: "personal"; userId: number; serverDiscId: string; state: TomoriState | null }
  | { kind: "server"; serverId: number; serverDiscId: string; state: TomoriState };

const SUPPORTER_DEFAULT_CAPABILITIES = [
  "text",
  "vision",
  "image",
  "video",
  "embedding",
  "decision",
] as const satisfies readonly SupporterCapability[];

const EMPTY_MODEL_SELECTIONS = {
  llm_id: null,
  diffusion_model_id: null,
  embedding_model_id: null,
  nai_diffusion_model_id: null,
  video_model_id: null,
  vision_llm_id: null,
};

/**
 * Selects the funding tier's defaults on the keyless subscription entry, moving those capabilities off
 * BYOK providers whose saved keys and models remain. Decision defaults are only registered, because
 * selecting one turns on a separate response feature.
 * @returns The capabilities whose default could not be registered or selected.
 * @throws {SupporterRequestDeniedError} When funding is unavailable or the text default fails.
 */
export async function activateSupporterDefaults(target: SupporterDefaultsTarget): Promise<SupporterCapability[]> {
  const { funding } = await validateSupporterModelRegistration({
    scope:
      target.kind === "personal"
        ? { kind: "personal", userId: target.userId }
        : { kind: "server", serverId: target.serverId },
    capability: "text",
  });
  if (!(await ensureSupporterEntry(target)))
    throw new SupporterRequestDeniedError("billing_unavailable", undefined, "text", target.kind);

  const failed: SupporterCapability[] = [];
  for (const capability of SUPPORTER_DEFAULT_CAPABILITIES) {
    const codename = funding.tier.defaultModelByCapability[capability];
    if (!codename || (await selectSupporterDefault(target, capability, codename))) continue;
    if (capability === "text")
      throw new SupporterRequestDeniedError("model_unavailable", undefined, "text", target.kind);
    failed.push(capability);
  }
  const voiceDefaults = funding.tier.defaultModelByCapability.voice;
  for (const mode of ["clone", "design"] as const) {
    const codename = voiceDefaults?.[mode];
    if (
      codename &&
      (!(await validateOpenRouterSpeechModel(codename, mode)) ||
        !(await selectSupporterDefault(target, "voice", codename))) &&
      !failed.includes("voice")
    )
      failed.push("voice");
  }
  if (target.kind === "server") invalidateTomoriStateCache(target.serverDiscId);
  if (failed.length > 0) {
    log.warn("Supporter default models could not be selected", {
      metadata: { fundingScope: target.kind, tierKey: funding.context.tierKey, capabilities: failed },
    });
  }
  return failed;
}

export async function ensureSupporterEntry(target: SupporterDefaultsTarget): Promise<boolean> {
  if (target.kind === "personal") {
    if (await llmProviderRepo.loadUserSavedProviderConfig(target.userId, SUPPORTER_PROVIDER_VALUE)) return true;
    const saved = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: target.userId,
      provider: "openrouter",
      apiKey: null,
      keyVersion: 1,
      baseConfig: target.state?.config,
      enabledCapabilities: [],
    });
    return await llmProviderRepo.upsertUserSavedProviderConfig(target.userId, {
      ...saved,
      ...EMPTY_MODEL_SELECTIONS,
      speech_design_model_id: null,
      speech_clone_model_id: null,
      provider: SUPPORTER_PROVIDER_VALUE,
    });
  }
  if (await llmProviderRepo.loadSavedProviderConfig(target.serverId, SUPPORTER_PROVIDER_VALUE)) return true;
  const saved = await buildSavedProviderConfigFromExistingOrDefaults({
    serverId: target.serverId,
    provider: "openrouter",
    apiKey: null,
    keyVersion: 1,
    baseConfig: target.state.config,
  });
  return await llmProviderRepo.upsertSavedProviderConfig(target.serverId, {
    ...saved,
    ...EMPTY_MODEL_SELECTIONS,
    provider: SUPPORTER_PROVIDER_VALUE,
  });
}

export async function ensurePersonalSupporterDefaults(
  target: Extract<SupporterDefaultsTarget, { kind: "personal" }>,
): Promise<void> {
  const saved = await llmProviderRepo.loadUserSavedProviderConfig(target.userId, SUPPORTER_PROVIDER_VALUE);
  if (saved?.llm_id) return;
  await activateSupporterDefaults(target);
}

async function selectSupporterDefault(
  target: SupporterDefaultsTarget,
  capability: SupporterCapability,
  codename: string,
): Promise<boolean> {
  const registryScope =
    target.kind === "personal"
      ? { kind: "personal" as const, ownerId: target.userId }
      : { kind: "server" as const, ownerId: target.serverId };
  if (capability === "vision") return await selectSupporterVisionDefault(target, registryScope, codename);
  if (capability === "embedding") {
    const registered = await registerOpenRouterModelForScope(registryScope, "embedding", codename);
    if (registered.status === "invalid_model" || registered.status === "write_failed") return false;
    if (!(await canSwitchEmbeddingModel(target, registered.model.modelId))) return true;
  }
  const result = await saveProviderModel({
    serverDiscId: target.serverDiscId,
    ...(target.kind === "personal"
      ? { ownerId: target.userId, scopeKind: "personal" as const, state: target.state }
      : { ownerId: target.serverId, scopeKind: "server" as const, state: target.state }),
    entryId: `provider:${SUPPORTER_PROVIDER_VALUE}`,
    capability: capability === "voice" ? "speech" : capability,
    codeName: codename,
  });
  return result.status === "success";
}

async function selectSupporterVisionDefault(
  target: SupporterDefaultsTarget,
  registryScope: { kind: "personal" | "server"; ownerId: number },
  codename: string,
): Promise<boolean> {
  const registered = await registerOpenRouterModelForScope(registryScope, "text", codename);
  if (registered.status === "invalid_model" || registered.status === "write_failed") return false;
  const visionLlmId = registered.model.modelId;
  if (!(await llmModelRepo.loadById(visionLlmId))?.sees_images) return false;
  if (target.kind === "personal") {
    return await assignPersonalCapabilityToProvider(target.userId, SUPPORTER_PROVIDER_VALUE, "vision", (row) => ({
      ...row,
      vision_llm_id: visionLlmId,
    }));
  }
  const saved = await llmProviderRepo.loadSavedProviderConfig(target.serverId, SUPPORTER_PROVIDER_VALUE);
  return (
    !!saved &&
    (await llmProviderRepo.upsertSavedProviderConfig(target.serverId, { ...saved, vision_llm_id: visionLlmId })) &&
    (await configRepository.updateModelConfig(target.serverId, { vision_llm_id: visionLlmId }))
  );
}

/**
 * Stored document vectors are only searchable with their own embedding family, and activation cannot
 * afford a synchronous re-embed, so a default from another family is registered but left unselected.
 */
async function canSwitchEmbeddingModel(target: SupporterDefaultsTarget, embeddingModelId: number): Promise<boolean> {
  const currentId =
    target.kind === "server"
      ? target.state.config.embedding_model_id
      : getActivePersonalProviderForCapability(
          await llmProviderRepo.loadUserSavedProviderConfigs(target.userId),
          "embedding",
        )?.embedding_model_id;
  if (!currentId || currentId === embeddingModelId) return true;
  const [current, chosen] = await Promise.all([
    llmModelRepo.loadEmbeddingModelById(currentId),
    llmModelRepo.loadEmbeddingModelById(embeddingModelId),
  ]);
  return !current?.model_family || current.model_family === chosen?.model_family;
}

export function parseSupporterBillingConfigForCommands(env: EnvRecord = process.env): SupporterBillingConfig {
  return parseSupporterBillingConfigJson(env.TOMORI_SUPPORTER_CONFIG_JSON, {
    env,
    validateReferencedSecrets: false,
  });
}

export async function validateSupporterSponsorshipRequest(
  params: ValidateSupporterSponsorshipParams,
): Promise<SupporterSponsorshipValidationResult> {
  const env = params.env ?? process.env;
  const environment = params.environment ?? resolveEnvironment();
  if (!isSupporterBillingEnabled(environment, env)) {
    return { ok: false, reason: "billing_unavailable" };
  }

  let config: SupporterBillingConfig;
  try {
    config = params.config ?? parseSupporterBillingConfigForCommands(env);
  } catch {
    return { ok: false, reason: "billing_unavailable" };
  }

  const repositories = params.repositories ?? {};
  const identityRepository = repositories.identityRepository ?? supporterIdentityRepository;
  const entitlementRepository = repositories.entitlementRepository ?? supporterEntitlementRepository;
  const sponsorshipRepository = repositories.sponsorshipRepository ?? supporterSponsorshipRepository;

  const identity = await identityRepository.loadByDiscordUserId(params.discordUserId);
  if (!identity) {
    return { ok: false, reason: "unlinked" };
  }

  const entitlement = await entitlementRepository.loadByIdentityId(identity.supporter_identity_id);
  if (!entitlement) {
    return { ok: false, reason: "inconsistent" };
  }

  if (!isSupporterEntitlementActive(entitlement, params.at)) {
    return { ok: false, reason: "inactive" };
  }

  const tier = config.tiers[entitlement.tier_key];
  if (!tier) {
    return { ok: false, reason: "unconfigured_tier" };
  }

  const activeSponsorship =
    params.serverId !== null ? await sponsorshipRepository.loadActiveSponsorshipForServer(params.serverId) : null;

  return {
    ok: true,
    config,
    tier,
    identity,
    entitlement,
    activeSponsorship,
  };
}

export async function replySupporterSponsorshipValidationFailure(
  interaction: ModalSubmitInteraction | ButtonInteraction,
  locale: string,
  result: Exclude<SupporterSponsorshipValidationResult, { ok: true }>,
): Promise<void> {
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.subscribe.sponsorship.errors.title",
    descriptionKey: VALIDATION_ERROR_DESCRIPTION_KEYS[result.reason],
    color: ColorCode.ERROR,
    flags: MessageFlags.Ephemeral,
  });
}

export async function persistSupporterSponsorship(params: {
  serverId: number;
  serverDiscId: string;
  sponsorIdentityId: number;
  createdByDiscId: string;
  repositories?: SupporterSponsorshipRepositories;
}): Promise<SupporterServerSponsorshipRow> {
  const sponsorshipRepository = params.repositories?.sponsorshipRepository ?? supporterSponsorshipRepository;
  const sponsorship = await sponsorshipRepository.startActiveSponsorship({
    serverId: params.serverId,
    serverDiscId: params.serverDiscId,
    sponsorIdentityId: params.sponsorIdentityId,
    createdByDiscId: params.createdByDiscId,
  });

  invalidateTomoriStateCache(params.serverDiscId);
  invalidateAllChannelLlmCacheForServer(params.serverId);

  let defaultsScope: "server" | "personal" = "server";
  try {
    const state = await getCachedTomoriState(params.serverDiscId);
    if (!state) throw new SupporterRequestDeniedError("inconsistent");
    await activateSupporterDefaults({
      kind: "server",
      serverId: params.serverId,
      serverDiscId: params.serverDiscId,
      state,
    });
    defaultsScope = "personal";
    const identity = await supporterIdentityRepository.loadById(params.sponsorIdentityId);
    const user = identity ? await getCachedUserRow(identity.discord_user_id) : null;
    if (!user?.user_id) throw new SupporterRequestDeniedError("inconsistent");
    await ensurePersonalSupporterDefaults({
      kind: "personal",
      userId: user.user_id,
      serverDiscId: params.serverDiscId,
      state,
    });
  } catch (error) {
    log.error("Subscription defaults could not be selected after sponsorship", error, {
      errorType: "SupporterDefaultsUnavailable",
      metadata: {
        serverId: params.serverId,
        fundingScope: defaultsScope,
        reason: error instanceof SupporterRequestDeniedError ? error.reason : "unexpected",
      },
    });
  }

  return sponsorship;
}

export async function serverHasConfiguredTextProvider(serverId: number): Promise<boolean> {
  const modelIds = await configRepository.loadModelCapabilityIds(serverId);
  return Boolean(modelIds?.llm_id);
}
