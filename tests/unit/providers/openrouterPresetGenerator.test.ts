import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { generatePresetFromPromptOpenrouter } from "@/providers/openrouter/presetGenerator";
import { PRESET_ATTRIBUTE_COUNT, PRESET_DIALOGUE_PAIR_COUNT } from "@/providers/utils/presetCommon";
import * as toolRegistry from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createPersona } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";

const fields = {
  attribute_list: Array.from({ length: PRESET_ATTRIBUTE_COUNT }, (_, index) => `Attribute ${index}`),
  sample_dialogues_in: Array.from({ length: PRESET_DIALOGUE_PAIR_COUNT }, (_, index) => `Question ${index}`),
  sample_dialogues_out: Array.from({ length: PRESET_DIALOGUE_PAIR_COUNT }, (_, index) => `Answer ${index}`),
};
const params = { characterName: "Mirri", characterDescription: "A telescope caretaker.", speechExamples: "Hello." };
let fetchStub: ReturnType<typeof stubGlobalFetch> | undefined;

afterEach(() => fetchStub?.mockRestore());

interface PresetRequest {
  provider?: { require_parameters: boolean };
  response_format: {
    json_schema: {
      strict?: boolean;
      schema: {
        additionalProperties?: boolean;
        properties: Record<string, { minItems?: number; maxItems?: number }>;
      };
    };
  };
}

describe("OpenRouter preset response contract", () => {
  it("sends exact array counts and strict output on the initial request and search continuation", async () => {
    const requests: PresetRequest[] = [];
    const interaction = createRouteInteraction();
    const execute = spyOn(toolRegistry, "executeTool").mockResolvedValue({ success: true, message: "Fixture result" });
    fetchStub = stubGlobalFetch((_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as PresetRequest);
      return Response.json({
        choices: [
          {
            message:
              requests.length === 1
                ? {
                    content: null,
                    tool_calls: [
                      { id: "search-1", type: "function", function: { name: "web_search", arguments: "{}" } },
                    ],
                  }
                : { content: JSON.stringify(fields) },
          },
        ],
      });
    });
    try {
      const result = await generatePresetFromPromptOpenrouter(
        "synthetic-api-key",
        { ...params, useWebSearch: true },
        "en-US",
        {
          model: "deepseek/test-model",
          tools: [
            { type: "function", function: { name: "web_search", parameters: { type: "object", properties: {} } } },
          ],
          toolContext: {
            tomoriState: createPersona(),
            provider: "openrouter",
            locale: "en-US",
            channel: interaction.channel as unknown as ToolContext["channel"],
            client: interaction.client as ToolContext["client"],
          },
        },
      );
      expect(result.preset).toMatchObject(fields);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.provider?.require_parameters).toBe(true);
        expect(request.response_format.json_schema.strict).toBe(true);
        expect(request.response_format.json_schema.schema.additionalProperties).toBe(false);
        for (const [field, count] of Object.entries({
          attribute_list: PRESET_ATTRIBUTE_COUNT,
          sample_dialogues_in: PRESET_DIALOGUE_PAIR_COUNT,
          sample_dialogues_out: PRESET_DIALOGUE_PAIR_COUNT,
        })) {
          expect(request.response_format.json_schema.schema.properties[field]).toMatchObject({
            minItems: count,
            maxItems: count,
          });
        }
      }
    } finally {
      execute.mockRestore();
    }
  });

  it("retains Anthropic schema compatibility while still rejecting invalid dialogue counts locally", async () => {
    for (const model of ["deepseek/test-model", "anthropic/test-model"]) {
      let requests = 0;
      fetchStub = stubGlobalFetch((_input, init) => {
        requests++;
        const request = JSON.parse(String(init?.body)) as PresetRequest;
        expect(request.provider?.require_parameters).toBe(true);
        expect(request.response_format.json_schema.strict).toBe(true);
        if (model.startsWith("anthropic/")) {
          expect(request.response_format.json_schema.schema.properties.sample_dialogues_in?.minItems).toBeUndefined();
          expect(request.response_format.json_schema.schema.properties.sample_dialogues_in?.maxItems).toBeUndefined();
        }
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ ...fields, sample_dialogues_in: fields.sample_dialogues_in.slice(1) }),
              },
            },
          ],
        });
      });
      try {
        const result = await generatePresetFromPromptOpenrouter("synthetic-api-key", params, "en-US", { model });
        expect(result.errorType).toBe("VALIDATION_ERROR");
        expect(result.preset).toBeUndefined();
        expect(requests).toBe(1);
      } finally {
        fetchStub.mockRestore();
      }
    }
  });
});
