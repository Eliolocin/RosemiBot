import type { ZodType } from "zod";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { parseEmbeddedJson } from "@/utils/text/jsonRepair";
import { normalizeProviderUsage, type TokenUsage } from "@/utils/text/tokenEstimate";

const MAX_PRIVATE_RESPONSE_BYTES = 1024 * 1024;
const MAX_PRIVATE_OUTPUT_CHARS = 16384;

export function privateStructuredFailure<T>(
  request: ProviderStructuredJsonRequest,
  failure: "transport" | "malformed" | "refusal" = "transport",
  httpStatus?: number,
  malformed?: MalformedDetail,
  cause?: Error,
): StructuredOutputResult<T> {
  return {
    success: false,
    error: "Structured request unavailable",
    failure: request.abortSignal?.aborted ? "cancelled" : failure,
    httpStatus,
    malformed,
    cause,
  };
}

export async function readStructuredResponse(
  request: ProviderStructuredJsonRequest,
  response: Response,
): Promise<unknown> {
  return request.privateOutput
    ? JSON.parse((await readBoundedResponse(response, MAX_PRIVATE_RESPONSE_BYTES)).toString("utf8"))
    : response.json();
}

/**
 * Info is hidden at the production default level, the same exposure as the reviewer prompt dump, and
 * a rejected reply is the one an operator needs to see to tell a format drift from a refusal. Output
 * tokens beside an empty reply separate an exhausted budget (reasoning or truncation) from a blank answer.
 */
function logMalformedPrivateOutput(serialized: string, usage: TokenUsage | null): void {
  const detail = serialized
    ? serialized.length > MAX_PRIVATE_OUTPUT_CHARS
      ? `${serialized.length} chars, over the ${MAX_PRIVATE_OUTPUT_CHARS} char limit`
      : serialized
    : "empty reply";
  log.info(`Structured output rejected as malformed (output tokens: ${usage?.outputTokens ?? "unknown"})\n${detail}`);
}

/** Private callers receive validated data or bounded metadata, never provider prose in errors. */
export function parsePrivateStructuredOutput<T>(
  request: ProviderStructuredJsonRequest,
  raw: unknown,
  schema: ZodType<T>,
  usage?: unknown,
  refused = false,
): StructuredOutputResult<T> {
  const normalized = normalizeProviderUsage(usage);
  if (normalized) request.onUsage?.(normalized);
  if (request.abortSignal?.aborted) return privateStructuredFailure(request);
  if (refused) return privateStructuredFailure(request, "refusal");
  const malformed = (serialized: string, detail: MalformedDetail): StructuredOutputResult<T> => {
    logMalformedPrivateOutput(serialized, normalized);
    return privateStructuredFailure<T>(request, "malformed", undefined, detail);
  };
  const serialized = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "");
  if (!serialized.trim()) return malformed(serialized, { reason: "empty" });
  if (serialized.length > MAX_PRIVATE_OUTPUT_CHARS) return malformed(serialized, { reason: "unparsable" });
  // Models wrap valid JSON in a fence or reasoning tags even in JSON mode; the object inside is still exact.
  const parsed: unknown = typeof raw === "string" ? parseEmbeddedJson(raw) : raw;
  if (parsed === undefined) return malformed(serialized, { reason: "unparsable" });
  const result = schema.safeParse(parsed);
  if (result.success) return { success: true, data: result.data };
  return malformed(serialized, {
    reason: "schema",
    issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).slice(0, 8),
  });
}

type MalformedDetail = NonNullable<Extract<StructuredOutputResult<unknown>, { success: false }>["malformed"]>;
