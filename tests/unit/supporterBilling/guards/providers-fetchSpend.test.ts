import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { z } from "zod";
import * as spendEstimates from "@/modules/supporter-billing/runtime/spendEstimates";
import {
  generateConversationSummaryOpenrouter,
  generateRoleplaySummaryOpenrouter,
} from "@/providers/openrouter/compactGenerator";
import { callOpenRouterDecisions } from "@/providers/openrouter/openrouterDecisions";
import { generateOpenRouterImage } from "@/providers/openrouter/openrouterImageGeneration";
import { callOpenrouterStructuredJSON } from "@/providers/openrouter/openrouterStructuredOutput";
import { generatePresetFromPromptOpenrouter } from "@/providers/openrouter/presetGenerator";
import type {
  GeneratePresetParams,
  ProviderCompactSummaryRequest,
  ProviderDecisionRequest,
  ProviderStructuredJsonRequest,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { stubGlobalFetch } from "../../../helpers/fetchStub";
import { installSpendHarness, type SpendHarness, type SpendKey } from "./utils-fundingFixtures";

const ESTIMATE_USD = 0.05;
const USAGE_COST_USD = 0.02;
const UNFUNDED_API_KEY = "unfunded-fixture-key";

let harness: SpendHarness;
let restoreEstimate: () => void = () => undefined;
let restoreLogs: Array<() => void> = [];
let fetchSpy: ReturnType<typeof stubGlobalFetch> | undefined;

beforeAll(() => {
  harness = installSpendHarness();
});

afterAll(() => {
  harness.restore();
});

beforeEach(() => {
  const estimate = spyOn(spendEstimates, "estimateSupporterRequestCost").mockResolvedValue(ESTIMATE_USD);
  const error = spyOn(log, "error").mockImplementation(async () => {});
  const warn = spyOn(log, "warn").mockImplementation(() => undefined);
  const info = spyOn(log, "info").mockImplementation(() => undefined);
  restoreEstimate = () => estimate.mockRestore();
  restoreLogs = [() => error.mockRestore(), () => warn.mockRestore(), () => info.mockRestore()];
});

afterEach(() => {
  restoreEstimate();
  restoreEstimate = () => undefined;
  for (const restore of restoreLogs.splice(0)) restore();
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function registerKey(): SpendKey {
  return harness.register();
}

function usage(cost: number): Record<string, unknown> {
  return { prompt_tokens: 12, completion_tokens: 4, cost };
}

async function settle<T>(operation: Promise<T>): Promise<T | undefined> {
  return await operation.catch(() => undefined);
}

interface ImageVariant {
  label: string;
  modelCodename: string;
  responseBody: () => Record<string, unknown>;
  expectedImageData: string | null;
}

const IMAGE_VARIANTS: ImageVariant[] = [
  {
    label: "chat completions",
    modelCodename: "google/gemini-3.1-flash-image",
    responseBody: () => ({
      choices: [{ message: { content: "generated image marker" } }],
      usage: usage(USAGE_COST_USD),
    }),
    expectedImageData: null,
  },
  {
    label: "images endpoint",
    modelCodename: "example/image-model",
    responseBody: () => ({
      data: [{ b64_json: Buffer.from("fixture image").toString("base64"), media_type: "image/png" }],
      usage: usage(USAGE_COST_USD),
    }),
    expectedImageData: Buffer.from("fixture image").toString("base64"),
  },
];

function imageRequest(apiKey: string, modelCodename: string, abortSignal?: AbortSignal) {
  return {
    apiKey,
    modelCodename,
    prompt: "paint the moon",
    aspectRatio: "1:1",
    ...(abortSignal ? { abortSignal } : {}),
  };
}

describe.each(IMAGE_VARIANTS)("openrouter image generation via $label", (variant) => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(variant.responseBody());
    });

    const result = await generateOpenRouterImage(imageRequest(key.apiKey, variant.modelCodename));

    expect(result.imageData).toBe(variant.expectedImageData);
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: "fixture failure" }, { status: 500, statusText: "Internal Server Error" });
    });

    await settle(generateOpenRouterImage(imageRequest(key.apiKey, variant.modelCodename)));

    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(variant.responseBody());
    });

    const result = await generateOpenRouterImage(imageRequest(UNFUNDED_API_KEY, variant.modelCodename));

    expect(result.imageData).toBe(variant.expectedImageData);
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });

  it("releases the funded hold when the request is aborted", async () => {
    const key = registerKey();
    const controller = new AbortController();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      controller.abort();
      throw controller.signal.reason;
    });

    await settle(generateOpenRouterImage(imageRequest(key.apiKey, variant.modelCodename, controller.signal)));

    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });
});

const structuredOutputSchema = z.object({ verdict: z.boolean() });
const structuredResponseSchema = {
  type: "object",
  properties: { verdict: { type: "boolean" } },
  required: ["verdict"],
};

function structuredRequest(apiKey: string, abortSignal?: AbortSignal): ProviderStructuredJsonRequest {
  return {
    apiKey,
    model: "example/structured-model",
    systemPrompt: "Reply with JSON.",
    userPrompt: "Is the reply friendly?",
    ...(abortSignal ? { abortSignal } : {}),
  };
}

function structuredBody() {
  return {
    choices: [{ message: { content: JSON.stringify({ verdict: true }) } }],
    usage: usage(USAGE_COST_USD),
  };
}

describe("openrouter structured output", () => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(structuredBody());
    });

    const result = await callOpenrouterStructuredJSON(
      structuredRequest(key.apiKey),
      structuredResponseSchema,
      structuredOutputSchema,
      "fixture_output",
    );

    expect(result.success).toBe(true);
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: "fixture failure" }, { status: 502, statusText: "Bad Gateway" });
    });

    const result = await settle(
      callOpenrouterStructuredJSON(
        structuredRequest(key.apiKey),
        structuredResponseSchema,
        structuredOutputSchema,
        "fixture_output",
      ),
    );

    expect(result?.success).toBe(false);
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(structuredBody());
    });

    const result = await callOpenrouterStructuredJSON(
      structuredRequest(UNFUNDED_API_KEY),
      structuredResponseSchema,
      structuredOutputSchema,
      "fixture_output",
    );

    expect(result.success).toBe(true);
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });

  it("releases the funded hold when the request is aborted", async () => {
    const key = registerKey();
    const controller = new AbortController();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      controller.abort();
      throw controller.signal.reason;
    });

    await settle(
      callOpenrouterStructuredJSON(
        structuredRequest(key.apiKey, controller.signal),
        structuredResponseSchema,
        structuredOutputSchema,
        "fixture_output",
      ),
    );

    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });
});

function makeDecisionRequest(apiKey: string, abortSignal?: AbortSignal): ProviderDecisionRequest {
  return {
    evidence: "The user greeted the bot.",
    questions: [{ type: "predicate", id: "friendly", instructions: "Is the reply friendly?" }],
    reference: { provider: "openrouter", modelId: 1, registrationId: null, customEndpointId: null },
    model: "example/decision-model",
    inputTokenLimit: 1_000_000,
    apiKey,
    apiStyle: "openrouter-decisions",
    correlationId: "fixture-correlation",
    ...(abortSignal ? { abortSignal } : {}),
  };
}

function decisionBody() {
  return {
    model: "example/decision-model",
    answers: { friendly: { type: "noul", noul: 0.82 } },
    usage: usage(USAGE_COST_USD),
  };
}

describe("openrouter decisions", () => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    const result = await callOpenRouterDecisions(makeDecisionRequest(key.apiKey), async () => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(decisionBody());
    });

    expect(result.status).toBe("completed");
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    const result = await settle(
      callOpenRouterDecisions(makeDecisionRequest(key.apiKey), async () => {
        expect(harness.pending(key.identityId)).toBeGreaterThan(0);
        return Response.json({ error: "fixture failure" }, { status: 503, statusText: "Service Unavailable" });
      }),
    );

    expect(result?.status).toBe("failed");
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    const result = await callOpenRouterDecisions(makeDecisionRequest(UNFUNDED_API_KEY), async () => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(decisionBody());
    });

    expect(result.status).toBe("completed");
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });

  it("releases the funded hold when the request is aborted", async () => {
    const key = registerKey();
    const controller = new AbortController();
    const result = await settle(
      callOpenRouterDecisions(makeDecisionRequest(key.apiKey, controller.signal), async () => {
        expect(harness.pending(key.identityId)).toBeGreaterThan(0);
        controller.abort();
        throw controller.signal.reason;
      }),
    );

    expect(result?.status).toBe("cancelled");
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });
});

function compactRequest(apiKey: string): ProviderCompactSummaryRequest {
  return {
    apiKey,
    model: "example/compact-model",
    systemPrompt: "Summarize the conversation.",
    userPrompt: "User: hello\nAssistant: hi",
  };
}

function conversationBody() {
  return {
    choices: [{ message: { content: "fixture summary" } }],
    usage: usage(USAGE_COST_USD),
  };
}

function roleplayBody() {
  return {
    choices: [{ message: { content: JSON.stringify({ overall_scene_summary: "fixture scene" }) } }],
    usage: usage(USAGE_COST_USD),
  };
}

describe("openrouter compact conversation summary", () => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(conversationBody());
    });

    const result = await generateConversationSummaryOpenrouter(compactRequest(key.apiKey));

    expect(result.summary).toBe("fixture summary");
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: "fixture failure" }, { status: 500, statusText: "Internal Server Error" });
    });

    const result = await generateConversationSummaryOpenrouter(compactRequest(key.apiKey));

    expect(result.error).toBeDefined();
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(conversationBody());
    });

    const result = await generateConversationSummaryOpenrouter(compactRequest(UNFUNDED_API_KEY));

    expect(result.summary).toBe("fixture summary");
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });
});

describe("openrouter compact roleplay summary", () => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(roleplayBody());
    });

    const result = await generateRoleplaySummaryOpenrouter(compactRequest(key.apiKey));

    expect(result.summary?.overall_scene_summary).toBe("fixture scene");
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: "fixture failure" }, { status: 502, statusText: "Bad Gateway" });
    });

    const result = await generateRoleplaySummaryOpenrouter(compactRequest(key.apiKey));

    expect(result.error).toBeDefined();
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(roleplayBody());
    });

    const result = await generateRoleplaySummaryOpenrouter(compactRequest(UNFUNDED_API_KEY));

    expect(result.summary?.overall_scene_summary).toBe("fixture scene");
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });
});

const PRESET_FIELDS = {
  attribute_list: ["Description", "Appearance", "Personality", "Likes", "Dislikes", "Quirks"],
  sample_dialogues_in: ["Who are you?", "I feel low today.", "Can you help me plan?", "Tea?", "Goodnight."],
  sample_dialogues_out: [
    "I am Mirri, your archivist.",
    "I am here with you.",
    "Start with one small step.",
    "Always.",
    "Sleep well.",
  ],
};

function presetParams(): GeneratePresetParams {
  return {
    characterName: "Mirri",
    characterDescription: "A moonlit archivist.",
    speechExamples: "Soft, precise, and warm.",
  };
}

function presetBody() {
  return {
    choices: [{ message: { content: JSON.stringify(PRESET_FIELDS) } }],
    usage: usage(USAGE_COST_USD),
  };
}

describe("openrouter preset generation", () => {
  it("holds spend before the funded request and observes its reported cost", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json(presetBody());
    });

    const result = await generatePresetFromPromptOpenrouter(key.apiKey, presetParams(), "en-US", {
      model: "example/preset-model",
    });

    expect(result.preset?.tomori_nickname).toBe("Mirri");
    expect(harness.observed(key.keyHash)).toBe(USAGE_COST_USD);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("releases the funded hold without observed spend when the response fails", async () => {
    const key = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(key.identityId)).toBeGreaterThan(0);
      return Response.json({ error: "fixture failure" }, { status: 500, statusText: "Internal Server Error" });
    });

    const result = await generatePresetFromPromptOpenrouter(key.apiKey, presetParams(), "en-US", {
      model: "example/preset-model",
    });

    expect(result.error).toBeDefined();
    expect(harness.observed(key.keyHash)).toBe(0);
    expect(harness.pending(key.identityId)).toBe(0);
  });

  it("sends an unfunded request without taking a hold", async () => {
    const funded = registerKey();
    fetchSpy = stubGlobalFetch(() => {
      expect(harness.pending(funded.identityId)).toBe(0);
      return Response.json(presetBody());
    });

    const result = await generatePresetFromPromptOpenrouter(UNFUNDED_API_KEY, presetParams(), "en-US", {
      model: "example/preset-model",
    });

    expect(result.preset?.tomori_nickname).toBe("Mirri");
    expect(harness.observed(funded.keyHash)).toBe(0);
    expect(harness.pending(funded.identityId)).toBe(0);
  });
});
