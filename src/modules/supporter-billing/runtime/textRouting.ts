import type { FallbackEntry, LlmRow, TomoriState } from "@/types/db/schema";
import type { LLMProvider, ProviderConfig } from "@/types/provider/interfaces";
import { resolveSupporterMemberKey } from "@/modules/supporter-billing/runtime/managedProvider";
import type { SupporterFundingContext } from "@/modules/supporter-billing/runtime/types";

export type SupporterManagedModelLoader = (provider: string, modelCodename: string) => Promise<LlmRow | null>;

export async function buildSupporterPrimaryTomoriState(params: {
  baseState: TomoriState;
  funding: SupporterFundingContext | null | undefined;
  loadModel: SupporterManagedModelLoader;
}): Promise<TomoriState> {
  const { baseState, funding, loadModel } = params;

  if (!funding) {
    throw new Error("Supporter text credential source is missing funding context.");
  }

  const model = await loadModel("openrouter", funding.modelCodename);
  if (!model) {
    throw new Error("Supporter managed OpenRouter model is not present in the model catalog.");
  }

  // Null every server-owned credential field so only the managed key can drive this turn.
  return {
    ...baseState,
    llm: model,
    config: {
      ...baseState.config,
      api_key: null,
      key_version: 1,
      custom_endpoint_url: null,
      custom_model_name: null,
    },
  };
}

export function buildSupporterFallbackTomoriState(baseState: TomoriState, entry: FallbackEntry): TomoriState | null {
  if (entry.kind === "custom_endpoint") {
    return null;
  }

  // Null the server-owned key so the managed key drives the attempt.
  return {
    ...baseState,
    llm: entry.model,
    config: {
      ...baseState.config,
      api_key: null,
      key_version: 1,
    },
  };
}

export async function resolveSupporterManagedProviderConfig(
  provider: Pick<LLMProvider, "createConfig">,
  tomoriState: TomoriState,
  options: {
    resolveMemberKey?: typeof resolveSupporterMemberKey;
    funding: SupporterFundingContext;
  },
): Promise<ProviderConfig> {
  const apiKey = await (options.resolveMemberKey ?? resolveSupporterMemberKey)(options.funding);
  return await provider.createConfig(tomoriState, apiKey);
}
