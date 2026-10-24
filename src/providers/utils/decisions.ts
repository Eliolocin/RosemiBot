import { z } from "zod";
import type {
  DecisionAnswer,
  DecisionFailureCategory,
  DecisionInput,
  DecisionResult,
  DecisionUsage,
  ProviderDecisionRequest,
} from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { parseIntegerEnvFlag } from "@/utils/misc/envFlags";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";

const DECISION_TIMEOUT_MS = parseIntegerEnvFlag(process.env.STREAM_SDK_CALL_TIMEOUT_MS, 120_000, 10_000);
const MAX_DECISION_RESPONSE_BYTES = 1024 * 1024;
const probabilitySchema = z.number().finite().min(0).max(1);
/** OpenRouter rounds probabilities, so a tie can come back a hair below the maximum. */
const CHOICE_ARGMAX_TOLERANCE = 0.005;
const decisionIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const instructionsSchema = z.string().min(1).max(8_000);
const requestInputSchema = z.object({
  evidence: z.string().min(1).max(2_000_000),
  questions: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("predicate"), id: decisionIdSchema, instructions: instructionsSchema }),
        z.object({
          type: z.literal("choice"),
          id: decisionIdSchema,
          instructions: instructionsSchema,
          options: z
            .array(z.object({ id: decisionIdSchema, description: instructionsSchema }))
            .min(2)
            .max(64)
            .refine((options) => new Set(options.map((option) => option.id)).size === options.length),
        }),
      ]),
    )
    .min(1)
    .max(64),
});

export function validDecisionInput(input: DecisionInput): boolean {
  return (
    requestInputSchema.safeParse(input).success &&
    new Set(input.questions.map((question) => question.id)).size === input.questions.length
  );
}

/** Named styles (OpenRouter, System One) key questions by ID; a choice lists its options as `criteria`. */
export function encodeNamedDecisionQuestions(request: DecisionInput) {
  return Object.fromEntries(
    request.questions.map((question) => [
      question.id,
      question.type === "choice"
        ? {
            type: "choice",
            instructions: question.instructions,
            criteria: Object.fromEntries(question.options.map((option) => [option.id, option.description])),
          }
        : { type: "noul", instructions: question.instructions },
    ]),
  );
}

export function encodeOrderedDecisionQuestions(request: DecisionInput) {
  return request.questions.map((question) =>
    question.type === "choice"
      ? {
          type: "choice",
          name: question.id,
          instructions: question.instructions,
          choices: question.options.map((option) => ({ value: option.id, description: option.description })),
        }
      : { type: "predicate", name: question.id, instructions: question.instructions },
  );
}

/**
 * A choice answer must name one of the offered options, give a probability for each of them, and
 * name the most likely one, because callers act on the choice alone.
 */
function validChoiceAnswer(
  question: DecisionInput["questions"][number],
  choice: string,
  probabilities: Record<string, number>,
): boolean {
  if (question.type !== "choice") return false;
  const ids = question.options.map((option) => option.id);
  const keys = Object.keys(probabilities);
  if (!ids.includes(choice) || keys.length !== ids.length || !keys.every((key) => ids.includes(key))) return false;
  return probabilities[choice] >= Math.max(...Object.values(probabilities)) - CHOICE_ARGMAX_TOLERANCE;
}

const usageSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cost: z.number().finite().nonnegative().optional(),
  input_tokens_details: z
    .object({
      cached_tokens: z.number().int().nonnegative().optional(),
      cache_write_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  output_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).optional(),
});

function parseDecisionUsage(payload: unknown): DecisionUsage | undefined {
  if (payload === undefined) return undefined;
  const usage = usageSchema.parse(payload);
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    costUsd: usage.cost,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens,
    cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens,
  };
}

export function parseNamedDecisionAnswers(payload: unknown, request: DecisionInput): DecisionAnswer[] {
  const answers = z
    .record(
      z.string(),
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("noul"), noul: probabilitySchema }),
        z.object({
          type: z.literal("choice"),
          choice: z.string(),
          probabilities: z.record(z.string(), probabilitySchema),
        }),
      ]),
    )
    .parse(payload);
  const keys = Object.keys(answers);
  if (
    keys.length !== request.questions.length ||
    keys.some((id) => !request.questions.some((question) => question.id === id))
  ) {
    throw new Error("Decision answer membership is invalid");
  }
  return request.questions.map((question): DecisionAnswer => {
    const answer = answers[question.id];
    if (answer.type === "noul" && question.type === "predicate") {
      return { type: "predicate", id: question.id, probability: answer.noul };
    }
    if (answer.type === "choice" && validChoiceAnswer(question, answer.choice, answer.probabilities)) {
      return { type: "choice", id: question.id, choice: answer.choice, probabilities: answer.probabilities };
    }
    throw new Error("Decision answer type or options are invalid");
  });
}

export function parseOrderedDecisionAnswers(payload: unknown, request: DecisionInput): DecisionAnswer[] {
  const answers = z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("predicate"), name: z.string(), probability: probabilitySchema }),
        z.object({
          type: z.literal("choice"),
          name: z.string(),
          choice: z.string(),
          probabilities: z.array(z.object({ value: z.string(), probability: probabilitySchema })),
        }),
        z.object({ type: z.literal("refusal"), name: z.string() }),
      ]),
    )
    .parse(payload);
  if (
    answers.length !== request.questions.length ||
    answers.some((answer, index) => answer.name !== request.questions[index].id)
  ) {
    throw new Error("Decision answer order or membership is invalid");
  }
  return answers.map((answer, index): DecisionAnswer => {
    const question = request.questions[index];
    if (answer.type === "refusal") return { type: "refusal", id: answer.name };
    if (answer.type === "predicate" && question.type === "predicate") {
      return { type: "predicate", id: answer.name, probability: answer.probability };
    }
    if (answer.type === "choice") {
      const probabilities = Object.fromEntries(answer.probabilities.map((row) => [row.value, row.probability]));
      if (
        Object.keys(probabilities).length === answer.probabilities.length &&
        validChoiceAnswer(question, answer.choice, probabilities)
      ) {
        return { type: "choice", id: answer.name, choice: answer.choice, probabilities };
      }
    }
    throw new Error("Decision answer type or options are invalid");
  });
}

function parseDecisionJson(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  // JSON.parse overwrites duplicate named answers. Inspect decoded keys before admitting that map.
  const tokens = raw.match(/"(?:[^"\\]|\\.)*"|[{}[\]:]/g) ?? [];
  const objects: Array<Set<string> | null> = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "{") objects.push(new Set());
    else if (token === "[") objects.push(null);
    else if (token === "}" || token === "]") objects.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const key = JSON.parse(token) as string;
      const keys = objects.at(-1);
      if (keys?.has(key)) throw new Error("Duplicate decision response key");
      keys?.add(key);
    }
  }
  return parsed;
}

export function decisionTrace(
  request: Pick<ProviderDecisionRequest, "apiStyle" | "reference" | "correlationId">,
  outcome: string,
  metadata: Record<string, number | string | DecisionUsage | undefined> = {},
): void {
  log.info(
    `Decision request ${JSON.stringify({
      operation: "decision-request",
      outcome,
      provider: request.reference.provider.startsWith("custom:") ? "custom" : "openrouter",
      apiStyle: request.apiStyle,
      modelId: request.reference.modelId,
      registrationId: request.reference.registrationId,
      customEndpointId: request.reference.customEndpointId,
      correlation: request.correlationId,
      ...metadata,
    })}`,
  );
}

export async function reportDecisionFailure(
  request: Pick<ProviderDecisionRequest, "apiStyle" | "reference" | "correlationId">,
  category: DecisionFailureCategory,
  stage: "resolution" | "transport" | "response" | "validation" | "execution",
  startedAt: number,
  httpStatus?: number,
): Promise<DecisionResult> {
  await log.error("Decision operation failed", new Error(`Decision ${stage} failed (${category})`), {
    errorType: "DecisionOperationFailed",
    metadata: {
      operation: "decision-request",
      stage,
      category,
      provider: request.reference.provider.startsWith("custom:") ? "custom" : "openrouter",
      apiStyle: request.apiStyle,
      modelId: request.reference.modelId,
      registrationId: request.reference.registrationId,
      customEndpointId: request.reference.customEndpointId,
      correlation: request.correlationId,
      httpStatus,
      elapsedMs: Date.now() - startedAt,
    },
  });
  return { status: "failed", category, correlationId: request.correlationId, errorLogged: true };
}

export async function executeDecisionTransport(
  request: ProviderDecisionRequest,
  transport: {
    url: string;
    body: Record<string, unknown>;
    headers?: Record<string, string>;
    fetch(input: string, init: RequestInit): Promise<Response>;
    parseAnswers(payload: unknown): DecisionAnswer[];
  },
): Promise<DecisionResult> {
  const startedAt = Date.now();
  const correlationId = request.correlationId;
  const cancelled = (): DecisionResult => {
    decisionTrace(request, "cancelled", { questionCount: request.questions.length, elapsedMs: Date.now() - startedAt });
    return { status: "cancelled", correlationId, errorLogged: false };
  };
  if (request.abortSignal?.aborted) return cancelled();
  if (!validDecisionInput(request)) return { status: "invalid-input", correlationId, errorLogged: false };
  const body = JSON.stringify(transport.body);
  // A UTF-8 byte ceiling is conservative across tokenizers. Use the model's tokenizer once callers
  // need packets that this ceiling refuses; never truncate evidence to make a request fit.
  if (Buffer.byteLength(body, "utf8") > request.inputTokenLimit) {
    return { status: "invalid-input", correlationId, errorLogged: false };
  }
  const timeout = AbortSignal.timeout(DECISION_TIMEOUT_MS);
  const signal = request.abortSignal ? AbortSignal.any([request.abortSignal, timeout]) : timeout;
  const headers = {
    "Content-Type": "application/json",
    ...transport.headers,
    ...(request.apiKey ? { Authorization: `Bearer ${request.apiKey}` } : {}),
  };
  decisionTrace(request, "start", { questionCount: request.questions.length, elapsedMs: Date.now() - startedAt });
  let stage: "transport" | "response" | "validation" = "transport";
  let httpStatus: number | undefined;
  try {
    const response = await transport.fetch(transport.url, { method: "POST", headers, body, signal });
    httpStatus = response.status;
    if (request.abortSignal?.aborted) {
      await response.body?.cancel();
      return cancelled();
    }
    if (!response.ok) {
      await response.body?.cancel();
      return await reportDecisionFailure(
        request,
        [401, 403].includes(response.status) ? "authentication" : "http",
        stage,
        startedAt,
        httpStatus,
      );
    }
    stage = "response";
    const raw = (await readBoundedResponse(response, MAX_DECISION_RESPONSE_BYTES)).toString("utf8");
    stage = "validation";
    const payload = parseDecisionJson(raw);
    const reportedUsage = z.object({ usage: z.unknown().optional() }).parse(payload);
    const usage = parseDecisionUsage(reportedUsage.usage);
    if (usage) request.onUsage?.(usage);
    if (request.abortSignal?.aborted) return cancelled();
    const envelope = z
      .object({
        model: z.string().min(1).max(200),
        answers: z.unknown(),
        usage: z.unknown().optional(),
        id: z.string().optional(),
        truncated: z.boolean().optional(),
      })
      .parse(payload);
    if (envelope.truncated) throw new Error("Decision evidence was truncated");
    const answers = transport.parseAnswers(envelope.answers);
    const outcome = answers.some((answer) => answer.type === "refusal") ? "refused" : "completed";
    const suppliedId =
      response.headers.get("x-typesafe-request-id") ?? response.headers.get("x-request-id") ?? envelope.id;
    const providerRequestId = suppliedId && /^[a-zA-Z0-9_.:-]{1,200}$/.test(suppliedId) ? suppliedId : undefined;
    decisionTrace(request, outcome, { questionCount: answers.length, elapsedMs: Date.now() - startedAt, usage });
    return { status: outcome, answers, usage, correlationId, providerRequestId, actualModel: envelope.model };
  } catch (error) {
    if (request.abortSignal?.aborted) return cancelled();
    if (error instanceof RemoteUrlPolicyError) return { status: "invalid-input", correlationId, errorLogged: false };
    return await reportDecisionFailure(
      request,
      timeout.aborted ? "timeout" : stage === "transport" ? "network" : "malformed",
      stage,
      startedAt,
      httpStatus,
    );
  }
}
