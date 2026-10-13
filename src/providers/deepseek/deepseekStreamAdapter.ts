import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { buildDeepSeekThinkingRequest } from "@/utils/provider/thinkingControl";

export interface DeepseekStreamConfig extends OpenAICompatibleStreamConfig {
  endpointUrl: string;
}

export class DeepseekStreamAdapter extends OpenAICompatibleStreamAdapter {
  constructor() {
    super({
      providerName: "deepseek",
      adapterName: "DeepseekStreamAdapter",
      localeNamespace: ["genai", "deepseek"].join("."),
      errorMessagePrefix: "DeepSeek API error",
      preserveReasoningContent: true,
      requiresReasoningContentReplay: true,
      mandatoryBodyKeys: ["thinking"],
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("DeepSeek endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config, context }) => {
        const thinkingRequest = buildDeepSeekThinkingRequest(
          config.model,
          context.tomoriState.config.thinking_level,
          config.forceReason,
        );
        if (thinkingRequest.thinking) {
          requestBody.thinking = thinkingRequest.thinking;
        }
        if (thinkingRequest.reasoning_effort) {
          requestBody.reasoning_effort = thinkingRequest.reasoning_effort;
        }
        if (thinkingRequest.omitSampling) {
          delete requestBody.temperature;
          delete requestBody.top_p;
          delete requestBody.presence_penalty;
          delete requestBody.frequency_penalty;
        }
        // Assistant prefix-completion is applied by the shared seam in
        // OpenAICompatibleStreamAdapter (providerRequiresPrefixCompletion → "deepseek").
      },
    });
  }
}
