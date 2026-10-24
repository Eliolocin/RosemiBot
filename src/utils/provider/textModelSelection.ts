import type { Message } from "discord.js";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { getCachedChannelLlm } from "@/utils/cache/channelLlmCache";
import { llmModelRepo } from "@/utils/db/repositories";

export async function resolveServerTextModel(
  state: TomoriState,
  channel: Message["channel"],
  isUserImpersonation: boolean,
  overrideCodename?: string,
): Promise<LlmRow> {
  const channelModel = isUserImpersonation
    ? null
    : await getCachedChannelLlm(state.server_id, channel.id, channel.isThread() ? channel.parentId : null);
  const model = isUserImpersonation ? state.llm : (state.persona_llm ?? channelModel ?? state.llm);
  if (!overrideCodename || overrideCodename === model.llm_codename) return model;
  return (
    (await llmModelRepo.loadByProviderAndCodename(model.llm_provider, overrideCodename)) ?? {
      ...model,
      llm_codename: overrideCodename,
    }
  );
}
