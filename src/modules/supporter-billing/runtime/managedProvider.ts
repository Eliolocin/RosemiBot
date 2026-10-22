import type { SupporterCapability } from "@/modules/supporter-billing/config";
import { MemberKeyRepository } from "@/modules/supporter-billing/db/repositories/memberKeys";
import { supporterSponsorshipRepository, supporterIdentityRepository } from "@/modules/supporter-billing/db";
import type { SupporterIdentityRepository, SupporterSponsorshipRepository } from "@/modules/supporter-billing/db";
import type { SupporterFundingContext, SupporterFundingScope } from "@/modules/supporter-billing/runtime/types";
import { resolveSupporterFunding } from "@/modules/supporter-billing/runtime/funding";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { getOrFetchOpenRouterCapabilities } from "@/utils/cache/openrouterCapabilityCache";
import { getOrFetchOpenRouterEmbeddingModel } from "@/utils/cache/openrouterEmbeddingModelCache";
import { getOrFetchOpenRouterDecisionModel } from "@/utils/cache/openrouterDecisionModelCache";
import { getOrFetchOpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";
import { getOrFetchOpenRouterImageModel } from "@/utils/cache/openrouterImageModelCache";
import { llmModelRepo } from "@/utils/db/repositories";
import { validateOpenRouterSpeechModel } from "@/utils/cache/openrouterSpeechModelCache";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";

export async function resolveSupporterMemberKey(
  funding: SupporterFundingContext,
  repositories: {
    memberKeys?: Pick<MemberKeyRepository, "loadCredential">;
    sponsorships?: Pick<SupporterSponsorshipRepository, "loadActiveSponsorshipById">;
    identities?: Pick<SupporterIdentityRepository, "loadByUserId">;
  } = {},
  at = new Date(),
): Promise<string> {
  try {
    const owner =
      funding.fundingScope === "personal"
        ? await (repositories.identities ?? supporterIdentityRepository).loadByUserId(funding.personalUserId)
        : await (repositories.sponsorships ?? supporterSponsorshipRepository).loadActiveSponsorshipById(
            funding.sponsorshipId,
          );
    const identityId =
      owner && ("sponsor_identity_id" in owner ? owner.sponsor_identity_id : owner.supporter_identity_id);
    if (identityId !== funding.sponsorIdentityId) {
      throw new SupporterRequestDeniedError("inconsistent", undefined, funding.capability, funding.fundingScope);
    }
    let keyHash: string | undefined;
    const apiKey = await (repositories.memberKeys ?? new MemberKeyRepository()).loadCredential(
      funding.sponsorIdentityId,
      at,
      (hash) => {
        keyHash = hash;
      },
    );
    if (apiKey) {
      if (!keyHash)
        throw new SupporterRequestDeniedError(
          "billing_unavailable",
          undefined,
          funding.capability,
          funding.fundingScope,
        );
      supporterSpendGuard.registerCredential(apiKey, funding, keyHash);
      return apiKey;
    }
  } catch (error) {
    if (error instanceof SupporterRequestDeniedError) throw error;
    throw new SupporterRequestDeniedError("billing_unavailable", undefined, funding.capability, funding.fundingScope);
  }
  throw new SupporterRequestDeniedError("inactive_entitlement", undefined, funding.capability, funding.fundingScope);
}

export async function resolveSupporterCapabilityCredentials(params: {
  scope: SupporterFundingScope;
  capability: SupporterCapability;
  modelId: number;
}): Promise<{ apiKey: string; funding: SupporterFundingContext }> {
  const model =
    params.capability === "voice"
      ? await llmModelRepo.loadSpeechModelById(params.modelId)
      : params.capability === "embedding"
        ? await llmModelRepo.loadEmbeddingModelById(params.modelId)
        : params.capability === "image"
          ? await llmModelRepo.loadDiffusionModelById(params.modelId)
          : params.capability === "decision"
            ? await llmModelRepo.loadDecisionModelById(params.modelId)
            : params.capability === "video"
              ? await llmModelRepo.loadVideoGenerationModelById(params.modelId)
              : await llmModelRepo.loadById(params.modelId);
  const provider = model && ("llm_provider" in model ? model.llm_provider : model.provider);
  const codename = model && ("llm_codename" in model ? model.llm_codename : model.codename);
  if (!model || model.is_deprecated || provider !== "openrouter" || !codename) {
    throw new SupporterRequestDeniedError("model_unavailable", undefined, params.capability, params.scope.kind);
  }
  const funding = await resolveSupporterFunding({
    scope: params.scope,
    capability: params.capability,
    requestedModelCodename: codename,
  });
  if (!funding.ok)
    throw new SupporterRequestDeniedError(funding.reason, undefined, params.capability, params.scope.kind);
  return { apiKey: await resolveSupporterMemberKey(funding.context), funding: funding.context };
}

export async function validateSupporterModelRegistration(params: {
  scope: SupporterFundingScope;
  capability: SupporterCapability;
  modelCodename?: string;
}) {
  const funding = await resolveSupporterFunding({
    ...params,
    requestedModelCodename: params.modelCodename,
  });
  if (!funding.ok)
    throw new SupporterRequestDeniedError(funding.reason, undefined, params.capability, params.scope.kind);
  const codename = funding.context.modelCodename;
  const model =
    params.capability === "voice"
      ? (await validateOpenRouterSpeechModel(codename))
        ? { id: codename }
        : undefined
      : params.capability === "video"
        ? await getOrFetchOpenRouterVideoModelCapabilities(codename)
        : params.capability === "decision"
          ? await getOrFetchOpenRouterDecisionModel(codename)
          : params.capability === "image"
            ? await getOrFetchOpenRouterImageModel(codename)
            : params.capability === "embedding"
              ? await getOrFetchOpenRouterEmbeddingModel(codename)
              : (await getOrFetchOpenRouterCapabilities(codename))
                ? { id: codename }
                : undefined;
  if (!model)
    throw new SupporterRequestDeniedError("model_unavailable", undefined, params.capability, params.scope.kind);
  return { funding, model };
}
