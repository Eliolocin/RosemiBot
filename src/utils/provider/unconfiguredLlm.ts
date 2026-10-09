import type { LlmRow } from "@/types/db/schema";

const UNCONFIGURED_LLM_PROVIDER = "user-byok";
const UNCONFIGURED_LLM_CODENAME = "None";

const UNCONFIGURED_LLM: LlmRow = {
  llm_id: 0,
  llm_provider: UNCONFIGURED_LLM_PROVIDER,
  llm_codename: UNCONFIGURED_LLM_CODENAME,
  is_scoped_registration: false,
  is_smartest: false,
  is_default: false,
  is_reasoning: false,
  is_deprecated: false,
  is_free: false,
  has_tools: false,
  sees_images: false,
  sees_videos: false,
  sees_youtube: false,
  is_uncensored: false,
  supports_structoutput: false,
  strict_role_alternation: false,
  supports_prefix_completion: false,
  supports_assistant_prefill: false,
  verbatim_tool_calling: false,
  llm_description: null,
  descriptions: null,
};

export function getUnconfiguredLlm(): LlmRow {
  return { ...UNCONFIGURED_LLM };
}
