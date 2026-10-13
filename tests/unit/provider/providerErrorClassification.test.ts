import { describe, expect, it } from "bun:test";
import type { ProviderError } from "@/types/stream/interfaces";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import {
  createOpenAICompatibleHttpError,
  normalizeOpenAICompatibleProviderError,
} from "@/providers/openaiCompatible/openaiCompatibleErrorFormatter";
import {
  isAccountBalanceExhaustedError,
  isCreditAffordabilityError,
  isNvidiaCredentialRejected,
  isOperatorActionableProviderError,
  isProviderModelError,
} from "@/utils/provider/providerErrorClassification";
import { stubLogMembers } from "../../helpers/mockSurface";

function providerError(message: string, code = "402"): ProviderError {
  return {
    type: "api_error",
    message,
    code,
    retryable: false,
    originalError: new Error(message),
  };
}

describe("account balance exhaustion classification", () => {
  it("classifies a DeepSeek 402 as exhausted balance, not an affordability ceiling", () => {
    const error = providerError("Deepseek Stream Error: HTTP 402: Insufficient Balance");

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
    // Overlap here would hand the user a `reduce_output_tokens` tip that cannot work on a zero balance.
    expect(isCreditAffordabilityError(error)).toBe(false);
  });

  it("keeps an OpenRouter affordability ceiling out of the exhausted-balance branch", () => {
    const error = providerError(
      "OpenRouter: HTTP 402: This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 7783.",
    );

    expect(isCreditAffordabilityError(error)).toBe(true);
    expect(isAccountBalanceExhaustedError(error)).toBe(false);
  });

  it("classifies the Z.ai billing denial that arrives as a 429", () => {
    const error = providerError("Z.ai Stream Error: HTTP 429: no resource package. Please recharge.", "429_balance");

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
  });

  it("leaves a genuine rate limit unclassified", () => {
    const error = providerError("HTTP 429: rate limit exceeded, please slow down", "429");

    expect(isAccountBalanceExhaustedError(error)).toBe(false);
    expect(isCreditAffordabilityError(error)).toBe(false);
  });

  it("reads the balance signal out of the original error payload", () => {
    const error: ProviderError = {
      type: "api_error",
      message: "Provider request failed",
      code: "402",
      retryable: false,
      originalError: { error: { message: "Insufficient Balance" } },
    };

    expect(isAccountBalanceExhaustedError(error)).toBe(true);
  });
});

/** Runs a NIM HTTP failure through the same normalizer the stream path uses, so the tests pin the real shape. */
function nimError(status: number, statusText: string, body: string): ProviderError {
  return normalizeOpenAICompatibleProviderError(createOpenAICompatibleHttpError(status, statusText, body), {
    errorMessagePrefix: "NVIDIA API error",
  });
}

describe("NVIDIA credential rejection classification", () => {
  const authorizationFailed = '{"status":403,"title":"Forbidden","detail":"Authorization failed"}';

  it("classifies the 403 NIM returns for a mistyped or expired key", () => {
    expect(isNvidiaCredentialRejected("nvidia", nimError(403, "Forbidden", authorizationFailed))).toBe(true);
  });

  it("does not attach expiry advice to another provider's 403", () => {
    expect(isNvidiaCredentialRejected("anthropic", nimError(403, "Forbidden", authorizationFailed))).toBe(false);
  });

  it("leaves a key without the nvapi- prefix to the plain key check", () => {
    // NIM answers a malformed key with 401 rather than 403; expiry cannot explain that one.
    const error = nimError(401, "Unauthorized", '{"detail":"Authentication failed"}');

    expect(isNvidiaCredentialRejected("nvidia", error)).toBe(false);
  });
});

describe("NVIDIA model availability classification", () => {
  it("treats a retired model's 410 as a model error", () => {
    const error = nimError(
      410,
      "Gone",
      `{"status":410,"title":"Gone","detail":"The model 'z-ai/glm-5.2' has reached its end of life on 2026-08-21T09:00:00Z and is no longer available."}`,
    );

    expect(error.type).toBe("model_error");
    expect(isProviderModelError(error)).toBe(true);
  });

  it("treats a model the account cannot reach as a model error", () => {
    const error = nimError(
      404,
      "Not Found",
      `{"status":404,"title":"Not Found","detail":"Function '23d4f03a-b8a6-4adb-a183-7daa083a09cc': Not found for account 'abc'"}`,
    );

    expect(error.type).toBe("model_error");
  });

  it("leaves NIM's bare 404 for a retired route as an api_error", () => {
    expect(nimError(404, "Not Found", "404 page not found").type).toBe("api_error");
  });
});

const errorCalls: string[] = [];
stubLogMembers({
  error: async (msg: string) => {
    errorCalls.push(msg);
  },
});

function makeOpenAICompatibleAdapter(): OpenAICompatibleStreamAdapter {
  return new OpenAICompatibleStreamAdapter({
    providerName: "custom",
    adapterName: "CustomStreamAdapter",
    localeNamespace: "genai.custom",
    errorMessagePrefix: "Custom API error",
    resolveApiUrl: () => "https://llm.example.invalid/v1/chat/completions",
  });
}

/** Runs a network failure through a custom endpoint's adapter, the path a server's own endpoint takes. */
function customEndpointError(message: string): ProviderError {
  return makeOpenAICompatibleAdapter().handleProviderError(new TypeError(message));
}

/** Runs a Google SDK failure through the adapter's own normalizer, which embeds the API body in the message. */
function googleError(code: number, status: string, message: string): ProviderError {
  return new GoogleStreamAdapter().handleProviderError(
    new Error(`got status: ${code}. ${JSON.stringify({ error: { code, message, status } })}`),
  );
}

describe("operator-actionable provider errors", () => {
  it("escalates a request TomoriBot built wrong", () => {
    const error = googleError(
      400,
      "INVALID_ARGUMENT",
      "Please ensure that function response turn comes immediately after a function call turn.",
    );

    expect(isOperatorActionableProviderError(error)).toBe(true);
  });

  it("escalates a failure no classifier recognized", () => {
    const error = normalizeOpenAICompatibleProviderError(new Error("Unexpected end of JSON input"), {
      errorMessagePrefix: "Custom API error",
    });

    expect(error.type).toBe("unknown");
    expect(isOperatorActionableProviderError(error)).toBe(true);
  });

  it("keeps failures the server repairs, or that clear on their own, out of error_logs", () => {
    const nonIncidents: Record<string, ProviderError> = {
      googleInvalidKey: googleError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."),
      googleBilling: googleError(400, "FAILED_PRECONDITION", "User location is not supported for billing."),
      revokedKey: nimError(401, "Unauthorized", '{"detail":"Authentication failed"}'),
      retiredModel: nimError(404, "Not Found", "404 page not found"),
      contextOverflow: nimError(400, "Bad Request", '{"message":"The maximum context length is 16384 tokens."}'),
      exhaustedBalance: nimError(402, "Payment Required", '{"message":"Insufficient Balance"}'),
      rateLimit: nimError(429, "Too Many Requests", '{"message":"rate limit exceeded"}'),
      outage: nimError(503, "Service Unavailable", '{"message":"upstream unavailable"}'),
      malformedVertexKey: new VertexStreamAdapter().handleProviderError(
        new Error("Vertex composite key is empty. Expected format: {project_id}::{location}"),
      ),
      anthropicMidStreamRateLimit: {
        type: "api_error",
        message: "Number of request tokens has exceeded your per-minute rate limit",
        code: "rate_limit_error",
        retryable: false,
      },
      // Bun's own fetch failure text, captured from a live refused, closed, timed-out, and unresolvable request.
      refusedEndpoint: customEndpointError("Unable to connect. Is the computer able to access the url?"),
      resetEndpoint: customEndpointError(
        "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
      ),
      timedOutEndpoint: customEndpointError("The operation timed out."),
      unresolvableHost: customEndpointError("getaddrinfo ENOTFOUND llm.example.invalid"),
    };

    const escalated = Object.entries(nonIncidents)
      .filter(([, error]) => isOperatorActionableProviderError(error))
      .map(([name]) => name);
    expect(escalated).toEqual([]);
  });

  it("does not file a NovelAI tool-call parse failure a second time", () => {
    const error: ProviderError = {
      type: "api_error",
      message: "Failed to parse tool call from model output.",
      code: "tool_call_parse_error",
      retryable: false,
    };

    expect(isOperatorActionableProviderError(error)).toBe(false);
  });

  it("leaves severity to the gate instead of logging an error while normalizing", () => {
    errorCalls.length = 0;
    const rejectedKey = new Error("HTTP 401: Incorrect API key provided");

    makeOpenAICompatibleAdapter().handleProviderError(rejectedKey);
    new OpenrouterStreamAdapter().handleProviderError(rejectedKey);

    expect(errorCalls).toEqual([]);
  });
});

describe("Bun fetch timeout classification", () => {
  it("lets every adapter retry the request Bun abandoned after its built-in 300 second wait", () => {
    // The exact object Bun's fetch throws when a server stays silent for its default timeout.
    const bunTimeout = new DOMException("The operation timed out.", "TimeoutError");
    const classifiers: Record<string, (error: unknown) => ProviderError> = {
      openaiCompatible: (error) => makeOpenAICompatibleAdapter().handleProviderError(error),
      openrouter: (error) => new OpenrouterStreamAdapter().handleProviderError(error),
      novelai: (error) => new NovelaiStreamAdapter().handleProviderError(error),
      google: (error) => new GoogleStreamAdapter().handleProviderError(error),
      vertex: (error) => new VertexStreamAdapter().handleProviderError(error),
      anthropic: (error) => new AnthropicStreamAdapter().handleProviderError(error),
    };

    const misclassified = Object.entries(classifiers)
      .map(([name, classify]) => ({ name, error: classify(bunTimeout) }))
      .filter(({ error }) => error.type !== "timeout" || !error.retryable)
      .map(({ name, error }) => `${name}: ${error.type} retryable=${error.retryable}`);
    expect(misclassified).toEqual([]);
  });
});
