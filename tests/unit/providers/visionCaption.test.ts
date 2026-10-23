import { afterEach, describe, expect, mock, test } from "bun:test";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const requests: RequestInit[] = [];
const remoteFetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
  requests.push(init ?? {});
  return Response.json({ choices: [{ message: { content: "caption" } }] });
});
const scopedMock = createScopedModuleMocker(mock, { "@/utils/security/userRemoteFetch": realRemoteFetch });
scopedMock.module("@/utils/security/userRemoteFetch", () => ({ ...realRemoteFetch, fetchUserRemoteUrl: remoteFetch }));

const { callOpenAiCompatibleVision, resolveChatCompletionsUrl, resolveVisionApiModelName } = await import(
  "@/utils/provider/visionCaption"
);
const originalAttributionSetting = process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;

afterEach(() => {
  requests.length = 0;
  remoteFetch.mockClear();
  if (originalAttributionSetting === undefined) delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
  else process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = originalAttributionSetting;
});

/**
 * The shared vision module is the only place a provider's image transport is chosen, so a
 * provider that supports vision but has no transport here fails at request time rather than
 * at review time. These tests pin both the resolution rules and the coverage gap.
 */
describe("vision api model name resolution", () => {
  test("translates zai codenames to the backend model string", () => {
    expect(resolveVisionApiModelName("zai", "zai/glm-4.6v", "ignored-by-zai")).toBe("glm-4.6v");
    expect(resolveVisionApiModelName("zaicoding", "glm-4.6v", "ignored-by-zai")).toBe("glm-4.6v");
  });

  test("prefers the endpoint's own model name for a custom provider", () => {
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", "upstream-model")).toBe(
      "upstream-model",
    );
  });

  test("falls back to the codename when the endpoint names no model", () => {
    // Backends such as KoboldCpp ignore the field entirely and answer for whatever is loaded.
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", null)).toBe("local-codename");
    expect(resolveVisionApiModelName("custom:s17:koboldcpp", "local-codename", "   ")).toBe("local-codename");
  });

  test("passes a normal provider's codename through untouched", () => {
    expect(resolveVisionApiModelName("google", "gemini-3.5-flash-lite")).toBe("gemini-3.5-flash-lite");
    expect(resolveVisionApiModelName("openrouter", "google/gemma-4-31b-it")).toBe("google/gemma-4-31b-it");
    expect(resolveVisionApiModelName("anthropic", "claude-vision-test")).toBe("claude-vision-test");
  });
});

describe("vision chat-completions transport coverage", () => {
  test("adds attribution only to OpenRouter requests and honors the opt-out setting", async () => {
    const image = { data: "aW1hZ2U=", mimeType: "image/png" };

    delete process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED;
    await callOpenAiCompatibleVision(
      "synthetic-key",
      "vision-model",
      "https://openrouter.ai/api/v1/chat/completions",
      image,
      "Describe this image",
      AbortSignal.timeout(5_000),
    );
    await callOpenAiCompatibleVision(
      "synthetic-key",
      "vision-model",
      "https://api.deepseek.com/chat/completions",
      image,
      "Describe this image",
      AbortSignal.timeout(5_000),
    );
    process.env.OPENROUTER_APP_ATTRIBUTION_ENABLED = "false";
    await callOpenAiCompatibleVision(
      "synthetic-key",
      "vision-model",
      "https://openrouter.ai/api/v1/chat/completions",
      image,
      "Describe this image",
      AbortSignal.timeout(5_000),
    );

    const headers = requests.map((call) => new Headers(call.headers));
    expect(headers[0].get("HTTP-Referer")).toBe("https://tomoribot.app");
    expect(headers[0].get("X-OpenRouter-Title")).toBe("TomoriBot");
    expect(headers[1].has("HTTP-Referer")).toBe(false);
    expect(headers[1].has("X-OpenRouter-Title")).toBe(false);
    expect(headers[2].has("HTTP-Referer")).toBe(false);
    expect(headers[2].has("X-OpenRouter-Title")).toBe(false);
  });

  test("resolves a dedicated endpoint for every OpenAI-compatible provider", () => {
    for (const provider of ["openrouter", "zai", "zaicoding", "deepseek", "nvidia"]) {
      const url = resolveChatCompletionsUrl(provider);
      expect(url).toStartWith("https://");
      expect(url).toEndWith("/chat/completions");
    }
  });

  test("never falls back to an OpenAI URL for a foreign provider", () => {
    // The previous tool-level map had no nvidia entry and fell through to an OpenAI default,
    // which would have sent a foreign bearer key to the wrong host.
    expect(resolveChatCompletionsUrl("nvidia")).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(resolveChatCompletionsUrl("nonexistent-provider")).toBeNull();
  });

  test("builds a custom endpoint URL without doubling the path", () => {
    // The stored name keeps its connection id: canonicalizing to `custom` first would lose the
    // connection the endpoint URL is looked up from, and no transport would be found at all.
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1/chat/completions")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "http://127.0.0.1:5001/v1/")).toBe(
      "http://127.0.0.1:5001/v1/chat/completions",
    );
    expect(resolveChatCompletionsUrl("custom:17", "   ")).toBeNull();
    // The canonical name alone has no connection to resolve an endpoint from.
    expect(resolveChatCompletionsUrl("custom", "http://127.0.0.1:5001/v1")).toBeNull();
  });
});
