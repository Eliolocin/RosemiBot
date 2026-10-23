import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { measureOpenRouterInputTokens } from "@/commands/tool/estimate/cost";
import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { OpenrouterProvider, type OpenrouterProviderConfig } from "@/providers/openrouter/openrouterProvider";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { createPersona } from "../../helpers/fixtures";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
let configSpy: ReturnType<typeof spyOn<OpenrouterProvider, "createConfig">> | undefined;
let messagesSpy: ReturnType<typeof spyOn<OpenrouterStreamAdapter, "buildProbeMessages">> | undefined;

afterEach(() => {
  fetchSpy?.mockRestore();
  configSpy?.mockRestore();
  messagesSpy?.mockRestore();
});

describe("OpenRouter live token estimate billing admission", () => {
  it("admits the paid probe before issuing either request", async () => {
    configSpy = spyOn(OpenrouterProvider.prototype, "createConfig").mockResolvedValue({
      apiKey: "synthetic-member",
      model: "synthetic/model",
      temperature: 0.7,
      tools: [],
    } as OpenrouterProviderConfig);
    messagesSpy = spyOn(OpenrouterStreamAdapter.prototype, "buildProbeMessages").mockResolvedValue([]);
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected transport"));
    const denied = new SupporterRequestDeniedError("allowance_exhausted");
    const admission = spyOn(supporterSpendGuard, "begin").mockRejectedValue(denied);
    try {
      await expect(measureOpenRouterInputTokens(createPersona(), "synthetic-member", [])).rejects.toBe(denied);
      expect(admission.mock.calls[0]?.[0]).toBe("synthetic-member");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      admission.mockRestore();
    }
  });
});
