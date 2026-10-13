import type { LlmRow } from "@/types/db/schema";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";

export function getEffectiveLlmModelName(
  llm: LlmRow,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): string {
  const trimmedCustomModelName = customModelName?.trim();
  if (isCustomProvider(llm.llm_provider) && trimmedCustomModelName) {
    return trimmedCustomModelName;
  }

  const trimmedOtherModelCodename = otherModelCodename?.trim();
  if (llm.llm_provider === "openrouter" && llm.llm_codename === "other-model" && trimmedOtherModelCodename) {
    return trimmedOtherModelCodename;
  }

  return llm.llm_codename;
}

export function getLlmDisplayName(
  llm: LlmRow,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): string {
  return getEffectiveLlmModelName(llm, customModelName, otherModelCodename);
}

export function formatLlmDisplayLabel(
  llm: LlmRow,
  customModelName?: string | null,
  otherModelCodename?: string | null,
): string {
  return `\`${getLlmDisplayName(llm, customModelName, otherModelCodename)}\` (${getProviderDisplayName(llm.llm_provider)})`;
}
