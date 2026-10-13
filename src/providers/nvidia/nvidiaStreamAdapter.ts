import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { OpenAICompatibleStreamConfig } from "@/providers/openaiCompatible/openaiCompatibleTypes";
import { buildNvidiaThinkingRequest } from "@/utils/provider/thinkingControl";

export interface NvidiaStreamConfig extends OpenAICompatibleStreamConfig {
  endpointUrl: string;
}

export class NvidiaStreamAdapter extends OpenAICompatibleStreamAdapter {
  constructor() {
    super({
      providerName: "nvidia",
      adapterName: "NvidiaStreamAdapter",
      localeNamespace: ["genai", "nvidia"].join("."),
      errorMessagePrefix: "NVIDIA API error",
      // NIM answers "I do not support this input" with an opaque mid-SSE 500 rather than a
      // parameter rejection, so without this the ladder queues no retry at all. Gated on a
      // generic message, so a descriptive NVIDIA outage still fails fast into key/model fallback.
      degradeOnOpaque5xx: true,
      // Both thinking keys are droppable: losing them falls back to the model's own thinking
      // default, which beats failing the reply, and NIM needs no reasoning_content replay that a
      // mid-tool-loop change in thinking could break.
      degradationPriorityKeys: ["reasoning_effort", "chat_template_kwargs"],
      resolveApiUrl: (config) => {
        if (!config.endpointUrl) {
          throw new Error("NVIDIA endpoint URL is required");
        }
        return config.endpointUrl;
      },
      mutateRequestBody: ({ requestBody, config, context }) => {
        Object.assign(
          requestBody,
          buildNvidiaThinkingRequest(context.tomoriState.config.thinking_level, config.forceReason),
        );
      },
    });
  }
}
