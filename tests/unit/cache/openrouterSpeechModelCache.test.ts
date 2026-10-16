import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
  parseOpenRouterSpeechModelList,
  validateOpenRouterSpeechModel,
} from "@/utils/cache/openrouterSpeechModelCache";

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
const originalAttributionSetting = process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
afterEach(() => {
  fetchSpy?.mockRestore();
  if (originalAttributionSetting === undefined) delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
  else process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = originalAttributionSetting;
});

describe("OpenRouter speech admission", () => {
  it("admits only verified Fish codenames from the speech catalogue", () => {
    const models = parseOpenRouterSpeechModelList({
      data: [
        { id: "fish-audio/s2.1-pro" },
        { id: "fish-audio/s2.1-pro-free:free" },
        { id: "fish-audio/s2-pro" },
        { id: "fish-audio/drama-3" },
        { id: "bytedance-seed/seed-audio-1-0" },
      ],
    });
    expect(models.map((model) => model.id)).toEqual(["fish-audio/s2.1-pro", "fish-audio/s2.1-pro-free:free"]);
  });

  it("requires current catalogue membership and a typed endpoint cloning flag", async () => {
    delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
    let catalogue: unknown = { data: [{ id: "fish-audio/s2.1-pro" }] };
    let endpoints: unknown = { data: { endpoints: [{ supports_voice_cloning: true }] } };
    let requests = 0;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requests += 1;
          calls.push({ url: String(input), init: init ?? {} });
          return Response.json(String(input).endsWith("/endpoints") ? endpoints : catalogue);
        },
        { preconnect: () => undefined },
      ),
    );
    expect(await validateOpenRouterSpeechModel("fish-audio/s2-pro")).toBe(false);
    expect(requests).toBe(0);
    expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(true);
    const endpointCall = calls.find((call) => call.url.endsWith("/endpoints"));
    const endpointHeaders = new Headers(endpointCall?.init.headers);
    expect(endpointHeaders.get("HTTP-Referer")).toBe("https://tomoribot.app");
    expect(endpointHeaders.get("X-OpenRouter-Title")).toBe("TomoriBot");
    for (const flag of [false, "true", undefined]) {
      endpoints = { data: { endpoints: [{ supports_voice_cloning: flag }] } };
      expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(false);
    }
    endpoints = { data: { endpoints: [{ supports_voice_cloning: true }] } };
    catalogue = { data: [{ id: "fish-audio/s2.1-pro-free:free" }] };
    expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(false);
    catalogue = { data: [{ id: "fish-audio/s2.1-pro" }] };
    expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(true);
    catalogue = { invalid: [] };
    expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(false);
    catalogue = { data: [] };
    expect(await validateOpenRouterSpeechModel("fish-audio/s2.1-pro")).toBe(false);
  });
});
