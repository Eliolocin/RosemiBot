import { supporterSpendGuard } from "@/modules/supporter-billing/runtime/spendGuard";
import { SupporterRequestDeniedError } from "@/modules/supporter-billing/runtime/funding";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { measureOpenRouterInputTokens } from "@/commands/tool/estimate/cost";
import { OpenrouterProvider, type OpenrouterProviderConfig } from "@/providers/openrouter/openrouterProvider";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { useEnvSandbox } from "../../helpers/env";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
let configSpy: ReturnType<typeof spyOn<OpenrouterProvider, "createConfig">> | undefined;
let messagesSpy: ReturnType<typeof spyOn<OpenrouterStreamAdapter, "buildProbeMessages">> | undefined;

useEnvSandbox(["OPENROUTER_APP_ATTRIBUTION_ENABLED"]);

afterEach(() => {
  fetchSpy?.mockRestore();
  configSpy?.mockRestore();
  messagesSpy?.mockRestore();
});

describe("OpenRouter live token estimate attribution", () => {
  it("attributes both probe requests and honors the attribution opt-out", async () => {
    configSpy = spyOn(OpenrouterProvider.prototype, "createConfig").mockResolvedValue({
      apiKey: "synthetic-key",
      model: "synthetic/model",
      temperature: 0.7,
      tools: [],
      seesImages: true,
      seesVideos: false,
    } as OpenrouterProviderConfig);
    messagesSpy = spyOn(OpenrouterStreamAdapter.prototype, "buildProbeMessages").mockResolvedValue([]);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = String(input);
          calls.push({ url, init: init ?? {} });
          return url.includes("/generation/")
            ? Response.json({ data: { native_prompt_tokens: 9 } })
            : Response.json({ id: "gen_synthetic", usage: { prompt_tokens: 10 } });
        },
        { preconnect: () => undefined },
      ),
    );
    const tomoriState = createPersona({
      llm: createLlmRow({ llm_provider: "openrouter", input_price_per_million: 1, output_price_per_million: 2 }),
    });

    delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
    const measured = await measureOpenRouterInputTokens(tomoriState, "synthetic-key", []);
    expect(measured.inputTokens).toBe(9);
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      const headers = new Headers(init.headers);
      expect(headers.get("HTTP-Referer")).toBe("https://tomoribot.app");
      expect(headers.get("X-OpenRouter-Title")).toBe("TomoriBot");
    }

    calls.length = 0;
    process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = "false";
    await measureOpenRouterInputTokens(tomoriState, "synthetic-key", []);
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      const headers = new Headers(init.headers);
      expect(headers.has("HTTP-Referer")).toBe(false);
      expect(headers.has("X-OpenRouter-Title")).toBe(false);
    }
  });
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
