import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import * as executors from "@/providers/utils/providerFeatureExecutors";
import { decisionModelSchema } from "@/types/db/schema";
import type { DecisionModelOption, DecisionResult } from "@/types/provider/featureInterfaces";
import type { DecisionExecutionRequest } from "@/providers/utils/providerFeatureExecutors";
import { callOpenRouterDecisions } from "@/providers/openrouter/openrouterDecisions";
import {
  decisionQuestions,
  decisionCanSkip,
  getDecisionCalibration,
  routeResponseDecision,
  RESPONSE_DECISION_RUBRIC,
  TOOL_DECISION_RUBRIC,
  MAX_DECISION_REQUESTS,
} from "@/utils/chat/responseDecisionRouting";
import type { ResponseReviewState, buildReviewerPacket } from "@/utils/chat/responseReview";
import { log } from "@/utils/misc/logger";

type Packet = NonNullable<ReturnType<typeof buildReviewerPacket>>;
const item = {
  tag: "admitted_context",
  role: "user" as const,
  sender: undefined,
  messageId: "fixture",
  participants: undefined,
  text: "PRIVATE_EVIDENCE",
};
function packet(kind: Packet["kind"] = "response_text"): Packet {
  return {
    kind,
    proposedCall:
      kind === "tool_call"
        ? { status: "not_executed", name: "fixture_action", arguments: { target: "Juno" } }
        : undefined,
    personaName: "Mirri",
    candidate: { status: "pending", text: "PRIVATE_CANDIDATE" },
    trigger: item,
    replyTarget: null,
    requirementsAndEvidence: [item],
    historicalDialogue: [item],
    representativeDialogues: [],
    availableTools: [],
    tools: [],
    revision: { count: 0, toolCorrections: 0, findings: [] },
    coverage: {
      historyIncluded: 1,
      historyTotal: 1,
      samplesIncluded: 0,
      samplesTotal: 0,
      media: "text_only",
      toolArguments: "redacted",
      omittedCatalogs: true,
    },
  };
}
function state(): ResponseReviewState {
  return {
    reviewerId: null,
    prompt: "PRIVATE_PROMPT",
    customPrompt: false,
    decisionModelId: 7,
    decisionRequests: 0,
    rules: { calls: 0 },
    responseReviews: 0,
    revisions: 0,
    toolReviews: 0,
    toolCorrections: 0,
    toolRejections: new Map(),
    rejectedChains: new Map(),
    successfulTools: new Map(),
    unavailable: false,
    functionHistory: [],
    pending: [],
    usage: [],
  };
}
const calibration = (kind: Packet["kind"] = "response_text") => ({
  modelId: 7,
  modelCodename: "fixture-model",
  rubric: kind === "tool_call" ? TOOL_DECISION_RUBRIC : RESPONSE_DECISION_RUBRIC,
  evidenceId: "synthetic-plumbing-only",
  thresholds: Object.fromEntries(decisionQuestions(kind).map((question) => [question.id, 0.1])),
});
function answer(kind: Packet["kind"] = "response_text"): DecisionResult {
  return {
    status: "completed",
    correlationId: "fixture",
    actualModel: "fixture-model",
    answers: decisionQuestions(kind).map((question) => ({ type: "predicate", id: question.id, probability: 0.01 })),
    usage: { inputTokens: 10, outputTokens: 0 },
  };
}
const option: DecisionModelOption = {
  model: decisionModelSchema.parse({
    decision_model_id: 7,
    provider: "openrouter",
    codename: "fixture-model",
    input_token_limit: 32000,
    supported_primitives: ["predicate"],
  }),
  reference: { provider: "openrouter", modelId: 7, registrationId: 9, customEndpointId: null },
};

async function reportedAnswer(request: DecisionExecutionRequest) {
  const result = answer();
  if (result.status === "completed" && result.usage) request.onUsage?.(result.usage);
  return result;
}

describe("response and tool decision routing", () => {
  const load = spyOn(executors, "loadDecisionModelsForScope").mockResolvedValue([option]);
  const call = spyOn(executors, "callDecisionsForProvider").mockImplementation(reportedAnswer);
  const info = spyOn(log, "info").mockImplementation(() => {});
  const errors = spyOn(log, "error").mockImplementation(async () => {});
  afterEach(() => {
    load.mockResolvedValue([option]);
    call.mockImplementation(reportedAnswer);
    for (const spy of [load, call, info, errors]) spy.mockClear();
  });
  afterAll(() => {
    for (const spy of [load, call, info, errors]) spy.mockRestore();
  });

  it("leaves production calibration inactive and never pays for missing calibration or custom prompts", async () => {
    const signal = new AbortController().signal;
    for (const kind of ["response_text", "tool_call"] as const) {
      expect(getDecisionCalibration(7, kind)).toBeUndefined();
      expect(await routeResponseDecision(42, state(), packet(kind), signal, undefined)).toBe("review");
      const custom = state();
      custom.customPrompt = true;
      expect(await routeResponseDecision(42, custom, packet(kind), signal, calibration(kind))).toBe("review");
      expect(custom.decisionModelId).toBe(7);
    }
    expect(call).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("requires every independent category-specific answer, with finite calibrated probabilities", () => {
    const response = decisionQuestions("response_text");
    const tool = decisionQuestions("tool_call");
    expect(tool.every((question) => !response.some((other) => other.id === question.id))).toBe(true);
    const result = answer();
    if (result.status !== "completed") throw new Error("Fixture status");
    expect(decisionCanSkip(result, response, calibration())).toBe(true);
    for (const answers of [
      [],
      result.answers.slice(1),
      [...result.answers, result.answers[0]],
      result.answers.map((entry) => ({ ...entry, id: result.answers[0].id })),
      result.answers.map((entry) => ({ type: "refusal" as const, id: entry.id })),
      ...[NaN, Infinity, -1, 0.1, 0.5, 1].map((probability) =>
        result.answers.map((entry) => ({ type: "predicate" as const, id: entry.id, probability })),
      ),
    ])
      expect(decisionCanSkip({ ...result, answers }, response, calibration())).toBe(false);
    expect(decisionCanSkip(result, tool, calibration("tool_call"))).toBe(false);
    expect(decisionCanSkip(result, response, { ...calibration(), thresholds: {} })).toBe(false);
  });

  it("reuses only the exact candidate, context, kind, rubric and owned selected model", async () => {
    const current = state();
    const signal = new AbortController().signal;
    expect(await routeResponseDecision(42, current, packet(), signal, calibration())).toBe("skip");
    expect(await routeResponseDecision(42, current, packet(), signal, calibration())).toBe("skip");
    expect(call).toHaveBeenCalledTimes(1);
    expect(current.usage[0]).toMatchObject({
      kind: "decision",
      model: "fixture-model",
      decisionModelId: 7,
      usage: { inputTokens: 10 },
    });
    const changed = packet();
    changed.candidate.text += " changed";
    await routeResponseDecision(42, current, changed, signal, calibration());
    const evidence = packet();
    evidence.requirementsAndEvidence = [{ ...item, text: "PRIVATE_NEW_FACT" }];
    await routeResponseDecision(42, current, evidence, signal, calibration());
    call.mockResolvedValue(answer("tool_call"));
    await routeResponseDecision(42, current, packet("tool_call"), signal, calibration("tool_call"));
    expect(call).toHaveBeenCalledTimes(4);
    expect(load.mock.calls.every(([scope]) => scope.kind === "server" && scope.ownerId === 42)).toBe(true);
    expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_");
  });

  it("falls back to review for missing evidence, unknown/removed registration, refusal, errors and actual-model mismatch", async () => {
    const signal = new AbortController().signal;
    const reduced = packet();
    reduced.coverage.historyTotal++;
    expect(await routeResponseDecision(42, state(), reduced, signal, calibration())).toBe("review");
    const missingSamples = packet();
    missingSamples.coverage.samplesTotal++;
    expect(await routeResponseDecision(42, state(), missingSamples, signal, calibration())).toBe("review");
    load.mockResolvedValue([]);
    expect(await routeResponseDecision(42, state(), packet(), signal, calibration())).toBe("review");
    expect(call).not.toHaveBeenCalled();
    load.mockResolvedValue([option]);
    for (const result of [
      { status: "refused", correlationId: "fixture", actualModel: "fixture-model", answers: [] },
      { status: "failed", category: "network", correlationId: "fixture", errorLogged: true },
      { status: "invalid-input", correlationId: "fixture", errorLogged: false },
      { ...answer(), actualModel: "unexpected-model" },
    ] as DecisionResult[]) {
      call.mockResolvedValue(result);
      expect(await routeResponseDecision(42, state(), packet(), signal, calibration())).toBe("review");
    }
    expect(errors).not.toHaveBeenCalled();
    load.mockRejectedValue(new Error("PRIVATE_RESOLUTION_BODY"));
    await routeResponseDecision(42, state(), packet(), signal, calibration());
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("PRIVATE_");
  });

  it("shares the twelve-request budget across checkpoints and keeps reviewer/correction counters unchanged", async () => {
    const current = state();
    current.decisionRequests = MAX_DECISION_REQUESTS - 1;
    const signal = new AbortController().signal;
    await routeResponseDecision(42, current, packet(), signal, calibration());
    expect(await routeResponseDecision(42, current, packet("tool_call"), signal, calibration("tool_call"))).toBe(
      "review",
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(current.responseReviews + current.toolReviews + current.revisions + current.toolCorrections).toBe(0);
    const controller = new AbortController();
    call.mockImplementation(async () => {
      controller.abort();
      return answer();
    });
    expect(await routeResponseDecision(42, state(), packet(), controller.signal, calibration())).toBe("cancelled");
    expect(errors).not.toHaveBeenCalled();
  });

  it("accounts for malformed transport usage and late deadline usage once without approving stale evidence", async () => {
    const current = state();
    call.mockImplementation((request) =>
      callOpenRouterDecisions(
        {
          ...request,
          reference: option.reference,
          model: option.model.codename,
          apiStyle: "openrouter-decisions",
          apiKey: "fixture",
          correlationId: "fixture",
          inputTokenLimit: option.model.input_token_limit,
        },
        async () =>
          Response.json({
            model: option.model.codename,
            answers: {},
            usage: { input_tokens: 19, output_tokens: 1 },
          }),
      ),
    );
    expect(await routeResponseDecision(42, current, packet(), new AbortController().signal, calibration())).toBe(
      "review",
    );
    expect(current.usage).toEqual([
      {
        kind: "decision",
        model: option.model.codename,
        decisionModelId: 7,
        usage: { inputTokens: 19, outputTokens: 1 },
      },
    ]);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockClear();
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    let complete: (() => void) | undefined;
    call.mockImplementation(
      (request) =>
        new Promise<DecisionResult>((resolve) => {
          complete = () => {
            request.onUsage?.({ inputTokens: 23, outputTokens: 0 });
            resolve(answer());
          };
        }),
    );
    try {
      const late = state();
      expect(await routeResponseDecision(42, late, packet(), new AbortController().signal, calibration())).toBe(
        "review",
      );
      complete?.();
      await Promise.resolve();
      expect(late.usage).toHaveLength(1);
      expect(late.usage[0]?.usage.inputTokens).toBe(23);
      expect(late.decisionVerdict).toBeUndefined();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it("revalidates ownership before using a cached skip and bounds silent routing failures", async () => {
    const current = state();
    const signal = new AbortController().signal;
    expect(await routeResponseDecision(42, current, packet(), signal, calibration())).toBe("skip");
    load.mockResolvedValue([]);
    expect(await routeResponseDecision(42, current, packet(), signal, calibration())).toBe("review");
    expect(call).toHaveBeenCalledTimes(1);
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    load.mockImplementation(async () => new Promise(() => {}));
    try {
      expect(await routeResponseDecision(42, state(), packet(), signal, calibration())).toBe("review");
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it("routes child request cancellation and deadline to review when the parent remains active", async () => {
    const controller = new AbortController();
    call.mockResolvedValue({ status: "cancelled", correlationId: "fixture", errorLogged: false });
    expect(await routeResponseDecision(42, state(), packet(), controller.signal, calibration())).toBe("review");
    expect(controller.signal.aborted).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockClear();

    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    call.mockImplementation(async ({ abortSignal }) => {
      return new Promise<DecisionResult>((resolve) => {
        abortSignal?.addEventListener(
          "abort",
          () => resolve({ status: "cancelled", correlationId: "fixture", errorLogged: false }),
          { once: true },
        );
      });
    });
    try {
      expect(await routeResponseDecision(42, state(), packet(), controller.signal, calibration())).toBe("review");
      expect(controller.signal.aborted).toBe(false);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0][2]).toMatchObject({ metadata: { category: "timeout" } });
      expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_");
      expect(JSON.stringify(errors.mock.calls)).not.toContain("PRIVATE_");
    } finally {
      timeout.mockRestore();
    }
  });
});
