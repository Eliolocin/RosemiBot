import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { callCustomDecisions } from "@/providers/custom/customDecisions";
import { callOpenRouterDecisions } from "@/providers/openrouter/openrouterDecisions";
import { callDecisionsForProvider } from "@/providers/utils/providerFeatureExecutors";
import type { ProviderDecisionRequest } from "@/types/provider/featureInterfaces";
import { parseOpenRouterDecisionModelList } from "@/utils/cache/openrouterDecisionModelCache";
import { log } from "@/utils/misc/logger";
import { llmModelRepo } from "@/utils/db/repositories";

const customReference = { provider: "custom:3", modelId: 8, registrationId: null, customEndpointId: 2 };

const request: ProviderDecisionRequest = {
  reference: { provider: "openrouter", modelId: 7, registrationId: 9, customEndpointId: null },
  model: "typesafe/jev-1.13",
  apiStyle: "openrouter-decisions",
  apiKey: "private-credential",
  inputTokenLimit: 32_000,
  correlationId: "fixture-correlation",
  evidence: "PRIVATE_EVIDENCE",
  questions: [{ type: "predicate", id: "criterion", instructions: "PRIVATE_QUESTION" }],
};

describe("Decision transports", () => {
  const info = spyOn(log, "info").mockImplementation(() => {});
  const error = spyOn(log, "error").mockImplementation(async () => {});
  afterEach(() => {
    info.mockClear();
    error.mockClear();
  });
  afterAll(() => {
    info.mockRestore();
    error.mockRestore();
  });

  it("translates native and System One requests without chat routes", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(
        {
          model: "jev-1.13.0",
          answers: { criterion: { type: "noul", noul: 0.75 } },
          usage: { input_tokens: 10, output_tokens: 0, cost: 0.00000042 },
        },
        { headers: { "x-typesafe-request-id": "fixture-id" } },
      );
    };
    const native = await callOpenRouterDecisions(request, fakeFetch);
    const custom = await callCustomDecisions(
      {
        ...request,
        reference: customReference,
        model: "jev-1.13.0",
        apiStyle: "system-one",
        endpointUrl: "https://example.invalid/gateway/v1/",
      },
      fakeFetch,
    );
    expect(calls.map((call) => call.url)).toEqual([
      "https://openrouter.ai/api/alpha/decisions",
      "https://example.invalid/gateway/v1/systemone",
    ]);
    expect(calls[0].body).toEqual({
      model: request.model,
      state: request.evidence,
      questions: { criterion: { type: "noul", instructions: "PRIVATE_QUESTION" } },
    });
    expect(custom).toEqual(native);
    expect(native).toMatchObject({
      status: "completed",
      providerRequestId: "fixture-id",
      actualModel: "jev-1.13.0",
      usage: { inputTokens: 10, costUsd: 0.00000042 },
    });
    expect(error).not.toHaveBeenCalled();
    for (const secret of [request.evidence, request.questions[0].instructions, request.apiKey])
      expect(JSON.stringify(info.mock.calls)).not.toContain(String(secret));
  });

  it("translates ordered OpenAI predicates and normalizes valid refusals", async () => {
    let body: unknown;
    const result = await callCustomDecisions(
      {
        ...request,
        reference: customReference,
        model: "fixture-decisions",
        apiStyle: "openai-decisions",
        endpointUrl: "https://example.invalid",
      },
      async (url, init) => {
        expect(url).toBe("https://example.invalid/v1/decisions");
        body = JSON.parse(String(init?.body));
        return Response.json({
          model: "fixture-decisions",
          answers: [{ type: "refusal", name: "criterion" }],
          usage: { input_tokens: 4, output_tokens: 0 },
        });
      },
    );
    expect(body).toEqual({
      model: "fixture-decisions",
      input: request.evidence,
      questions: [{ type: "predicate", name: "criterion", instructions: "PRIVATE_QUESTION" }],
    });
    expect(result).toMatchObject({ status: "refused", answers: [{ type: "refusal", id: "criterion" }] });
    expect(error).not.toHaveBeenCalled();
  });

  it("reports malformed membership, duplicates, types, probabilities and truncation once", async () => {
    const payloads = [
      { model: "fixture", answers: {} },
      { model: "fixture", answers: { criterion: { type: "noul", noul: 0.5 }, extra: { type: "noul", noul: 0.5 } } },
      { model: "fixture", answers: { criterion: { type: "predicate", probability: 0.5 } } },
      ...["0.5", -1, 1.1, null].map((noul) => ({ model: "fixture", answers: { criterion: { type: "noul", noul } } })),
      { model: "fixture", answers: { criterion: { type: "noul", noul: 0.5 } }, truncated: true },
    ];
    const bodies = [
      ...payloads.map((payload) => JSON.stringify(payload)),
      '{"model":"fixture","answers":{"criterion":{"type":"noul","noul":0.5},"criterion":{"type":"noul","noul":0.8}}}',
      '{"model":"fixture","answers":{"criterion":{"type":"noul","noul":1e999}}}',
    ];
    for (const body of bodies) {
      error.mockClear();
      const result = await callOpenRouterDecisions(request, async () => new Response(body));
      expect(result).toMatchObject({ status: "failed", category: "malformed", errorLogged: true });
      expect(error).toHaveBeenCalledTimes(1);
    }
  });

  it("retains validated usage when answers fail or the turn stops during response decoding", async () => {
    const reported: unknown[] = [];
    const controller = new AbortController();
    const tracked = { ...request, abortSignal: controller.signal, onUsage: (usage: unknown) => reported.push(usage) };
    const malformed = await callOpenRouterDecisions(tracked, async () =>
      Response.json({ model: request.model, answers: {}, usage: { input_tokens: 17, output_tokens: 2 } }),
    );
    expect(malformed).toMatchObject({ status: "failed", errorLogged: true });
    expect(reported).toEqual([expect.objectContaining({ inputTokens: 17, outputTokens: 2 })]);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockClear();
    const cancelled = await callOpenRouterDecisions(
      tracked,
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    model: request.model,
                    answers: { criterion: { type: "noul", noul: 0.01 } },
                    usage: { input_tokens: 21, output_tokens: 0 },
                  }),
                ),
              );
            },
            pull(stream) {
              controller.abort();
              stream.close();
            },
          }),
        ),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(reported).toHaveLength(2);
    expect(reported[1]).toMatchObject({ inputTokens: 21, outputTokens: 0 });
    expect(error).not.toHaveBeenCalled();
  });

  it("reports operational failures safely and leaves cancellation and rejected input expected", async () => {
    for (const status of [401, 403, 429, 500]) {
      error.mockClear();
      const result = await callOpenRouterDecisions(request, async () => new Response("PRIVATE_RESPONSE", { status }));
      expect(result).toMatchObject({ status: "failed", errorLogged: true });
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][2]?.metadata).toMatchObject({
        operation: "decision-request",
        httpStatus: status,
        correlation: request.correlationId,
      });
    }
    error.mockClear();
    await callOpenRouterDecisions(request, async () => {
      throw new Error("PRIVATE_EVIDENCE PRIVATE_RESPONSE private-credential https://secret.invalid?token=SECRET");
    });
    expect(error).toHaveBeenCalledTimes(1);
    const records = JSON.stringify(
      error.mock.calls.map(([message, cause, context]) => ({
        message,
        cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
        context,
      })),
    );
    for (const secret of ["PRIVATE_EVIDENCE", "PRIVATE_RESPONSE", "private-credential", "SECRET"])
      expect(records).not.toContain(secret);
    error.mockClear();
    const abort = new AbortController();
    const cancelled = await callOpenRouterDecisions({ ...request, abortSignal: abort.signal }, async () => {
      abort.abort();
      throw new Error("private abort");
    });
    expect(cancelled.status).toBe("cancelled");
    const invalid = await callOpenRouterDecisions({
      ...request,
      questions: [...request.questions, ...request.questions],
    });
    expect(invalid.status).toBe("invalid-input");
    expect(error).not.toHaveBeenCalled();
  });

  it("requires explicit decision discovery and finite documented metadata", () => {
    const entry = {
      id: "typesafe/jev-1.13",
      context_length: 32000,
      architecture: { input_modalities: ["text"], output_modalities: ["decisions"] },
      pricing: { prompt: "0.000000042", completion: "0" },
    };
    const parsed = parseOpenRouterDecisionModelList({
      data: [
        entry,
        { ...entry, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
        { ...entry, context_length: 0 },
        { ...entry, pricing: { prompt: "Infinity", completion: "0" } },
      ],
    });
    expect(parsed.map((model) => model.id)).toEqual([entry.id]);
  });

  it("reports a non-cancellation timeout once", async () => {
    const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("fixture", "TimeoutError")),
    );
    try {
      const result = await callOpenRouterDecisions(request, async (_url, init) => {
        throw init.signal?.reason;
      });
      expect(result).toMatchObject({ status: "failed", category: "timeout", errorLogged: true });
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it("reports unexpected executor failures once and preserves expected missing selection", async () => {
    const load = spyOn(llmModelRepo, "loadDecisionModelOptions").mockRejectedValue(
      new Error("PRIVATE_EVIDENCE private-credential"),
    );
    try {
      const execution = { ...request, scope: { kind: "server" as const, ownerId: 1 } };
      expect(await callDecisionsForProvider({ ...execution, reference: null })).toMatchObject({
        status: "unavailable",
        reason: "not-selected",
        errorLogged: false,
      });
      expect(error).not.toHaveBeenCalled();
      expect(await callDecisionsForProvider(execution)).toMatchObject({
        status: "failed",
        category: "unexpected",
        errorLogged: true,
      });
      expect(error).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(
          error.mock.calls.map(([message, cause, context]) => ({
            message,
            cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
            context,
          })),
        ),
      ).not.toContain("PRIVATE_EVIDENCE");
      expect(
        JSON.stringify(
          error.mock.calls.map(([message, cause, context]) => ({
            message,
            cause: cause instanceof Error ? { ...cause, message: cause.message, stack: cause.stack } : cause,
            context,
          })),
        ),
      ).not.toContain("private-credential");
    } finally {
      load.mockRestore();
    }
  });

  it("emits production ERROR once per recovered fake request, hides INFO and omits private content", async () => {
    const script = `import {callOpenRouterDecisions} from "./src/providers/openrouter/openrouterDecisions";
      const result = await callOpenRouterDecisions(${JSON.stringify(request)}, async () => new Response("PRIVATE_RESPONSE", {status:401}));
      if(result.status !== "failed" || !result.errorLogged) process.exit(1);
      const network = await callOpenRouterDecisions({...${JSON.stringify(request)}, correlationId:"fixture-network"}, async () => {
        throw Object.assign(new Error("PRIVATE_EVIDENCE PRIVATE_QUESTION private-credential"), {response:{body:"PRIVATE_RESPONSE", url:"https://secret.invalid?token=SECRET"}});
      });
      if(network.status !== "failed" || !network.errorLogged) process.exit(1);`;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: process.cwd(),
      env: { ...process.env, RUN_ENV: "production", TEST_PRODUCTION: "false", ERROR_DB_LOGGING_ENABLED: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const records = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const errors = records.filter((record) => record.level === 50);
    for (const correlation of [request.correlationId, "fixture-network"]) {
      expect(errors.filter((record) => record.context?.metadata?.correlation === correlation)).toHaveLength(1);
    }
    expect(records.some((record) => record.level === 30)).toBe(false);
    for (const secret of [
      "PRIVATE_RESPONSE",
      "SECRET",
      request.evidence,
      request.questions[0].instructions,
      request.apiKey,
    ])
      expect(stdout).not.toContain(String(secret));
  });
});
