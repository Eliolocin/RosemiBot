import { beforeAll, describe, expect, it } from "bun:test";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { NvidiaStreamAdapter } from "@/providers/nvidia/nvidiaStreamAdapter";
import { createOpenAICompatibleErrorDescription } from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import { VertexexpressStreamAdapter } from "@/providers/vertexexpress/vertexexpressStreamAdapter";
import type { ProviderError } from "@/types/stream/interfaces";
import { formatProviderErrorCodeForDisplay } from "@/utils/provider/providerErrorClassification";
import { initializeLocalizer } from "@/utils/text/localizer";

// A synthetic credential an endpoint reflects back, in the encodings a pattern redactor misses.
const CANARY = "sk-live-CANARY0001";
const ECHOES = [
  CANARY,
  Buffer.from(CANARY).toString("base64"),
  encodeURIComponent(`Bearer ${CANARY}`).replace(/-/g, "%2D"),
  Buffer.from(CANARY).toString("hex"),
];
const INJECTED = "@everyone <@123456789012345678> <@&42>";
const FORBIDDEN = ["CANARY", ...ECHOES.slice(1), "@everyone", "<@"];

const describers: Array<[string, (error: ProviderError) => string | null]> = [
  ["anthropic", (error) => new AnthropicStreamAdapter().createErrorDescription(error, "en-US")],
  ["openrouter", (error) => new OpenrouterStreamAdapter().createErrorDescription(error, "en-US")],
  ["google", (error) => new GoogleStreamAdapter().createErrorDescription(error, "en-US")],
  ["vertex", (error) => new VertexStreamAdapter().createErrorDescription(error, "en-US")],
  ["vertexexpress", (error) => new VertexexpressStreamAdapter().createErrorDescription(error, "en-US")],
  ["novelai", (error) => new NovelaiStreamAdapter().createErrorDescription(error, "en-US")],
  ["nvidia", (error) => new NvidiaStreamAdapter().createErrorDescription(error, "en-US")],
  ...["genai.custom", "genai.deepseek", "genai.zai"].map(
    (localeNamespace) =>
      [
        localeNamespace,
        (error: ProviderError) =>
          createOpenAICompatibleErrorDescription(error, "en-US", { localeNamespace, fallbackMessage: "Failed." }),
      ] as [string, (error: ProviderError) => string | null],
  ),
];

const types: ProviderError["type"][] = [
  "model_error",
  "api_error",
  "provider_overloaded",
  "rate_limit",
  "timeout",
  "content_blocked",
  "unknown",
];
const codes = [
  "400",
  "500",
  "599",
  CANARY,
  "vertex_config_error",
  "vertex_auth_error",
  "invalid_request_error",
  undefined,
];

describe("public provider error descriptions", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("never repeat upstream text, echoed credentials or injected mentions", () => {
    const leaks: string[] = [];
    for (const [name, describe] of describers) {
      for (const type of types) {
        for (const code of codes) {
          for (const echo of ECHOES) {
            const upstream = `Invalid key ${echo} ${INJECTED} Unsupported model. Privacy Policy Error billing`;
            const description = describe({
              type,
              code,
              message: upstream,
              userMessage: upstream,
              originalError: new Error(upstream),
              retryable: false,
            });
            const found = FORBIDDEN.filter((fragment) => description?.includes(fragment));
            if (!description?.trim() || found.length > 0) {
              leaks.push(`${name}/${type}/${code}: ${found.join(", ") || "empty"}`);
            }
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("shows only status and enum-shaped codes", () => {
    expect(
      ["429", "429_balance", "404_model", "ECONNREFUSED", "invalid_request_error"].map(
        formatProviderErrorCodeForDisplay,
      ),
    ).toEqual(["429", "429_balance", "404_model", "ECONNREFUSED", "invalid_request_error"]);
    for (const code of [CANARY, "sk_live_Abc123", "AbcDef", "a".repeat(41), "<@&42>", "", null, undefined]) {
      expect(formatProviderErrorCodeForDisplay(code)).toBe("unknown");
    }
  });
});
