import { afterEach, expect, spyOn, test } from "bun:test";
import { generatePresetFromPromptAnthropic } from "@/providers/anthropic/presetGenerator";
import { generatePresetFromPromptCustom } from "@/providers/custom/customPresetGenerator";
import { generatePresetFromPromptDeepseek } from "@/providers/deepseek/presetGenerator";
import { generatePresetFromPromptNvidia } from "@/providers/nvidia/presetGenerator";
import { generatePresetFromPromptOpenrouter } from "@/providers/openrouter/presetGenerator";
import { generatePresetFromPromptZai } from "@/providers/zai/presetGenerator";
import * as toolRegistry from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { createPersona } from "../../helpers/fixtures";
import { collectCaseFailures } from "../../helpers/localeCases";
import { createRouteInteraction } from "../../helpers/routeInteraction";

const restore: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0).reverse()) spy.mockRestore();
});

test("preset providers stop after a failed search without requesting a generation continuation", async () => {
  const interaction = createRouteInteraction();
  const toolContext: ToolContext = {
    channel: interaction.channel as unknown as ToolContext["channel"],
    client: interaction.client as ToolContext["client"],
    tomoriState: createPersona(),
    provider: "openrouter",
    locale: "en-US",
  };
  const params = {
    characterName: "Mirri",
    characterDescription: "A telescope caretaker.",
    speechExamples: "Hello.",
    useWebSearch: true,
  };
  const options = {
    model: "example/model",
    tools: [{ type: "function", function: { name: "web_search", parameters: { type: "object", properties: {} } } }],
    toolContext,
  };
  const canary = "fixture-private-search-detail";
  const execute = spyOn(toolRegistry, "executeTool").mockResolvedValue({ success: false, error: canary });
  let requests = 0;
  const respond = () => {
    requests++;
    if (requests > 1) {
      const fields = {
        attribute_list: ["a", "b", "c", "d", "e", "f"],
        sample_dialogues_in: ["a", "b", "c", "d", "e"],
        sample_dialogues_out: ["a", "b", "c", "d", "e"],
      };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(fields) } }],
        content: [{ type: "tool_use", id: "preset", name: "preset_export_data", input: fields }],
      });
    }
    return Response.json({
      choices: [{ message: { tool_calls: [{ id: "search", function: { name: "web_search", arguments: "{}" } }] } }],
      content: [{ type: "tool_use", id: "search", name: "web_search", input: { query: "Mirri" } }],
    });
  };
  restore.push(
    execute,
    stubGlobalFetch(respond),
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async () => respond()),
  );
  const providers = [
    ["anthropic", () => generatePresetFromPromptAnthropic("fixture-api-key", params, "en-US", options)],
    [
      "custom",
      () =>
        generatePresetFromPromptCustom("fixture-api-key", params, "en-US", {
          ...options,
          endpointUrl: "https://example.com/v1",
        }),
    ],
    ["deepseek", () => generatePresetFromPromptDeepseek("fixture-api-key", params, "en-US", options)],
    ["nvidia", () => generatePresetFromPromptNvidia("fixture-api-key", params, "en-US", options)],
    ["openrouter", () => generatePresetFromPromptOpenrouter("fixture-api-key", params, "en-US", options)],
    ["zai", () => generatePresetFromPromptZai("fixture-api-key", params, "en-US", options)],
  ] as const;
  const failures = collectCaseFailures();
  for (const [provider, generate] of providers) {
    requests = 0;
    execute.mockClear();
    const result = await generate();
    failures.check(provider, () => {
      expect(result.failureStage).toBe("web_search");
      expect(result.preset).toBeUndefined();
      expect(result.error).not.toContain(canary);
      expect(requests).toBe(1);
      expect(execute).toHaveBeenCalledTimes(1);
    });
  }
  failures.expectNoFailures();
});
