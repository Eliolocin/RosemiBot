import type { ZodType } from "zod";
import type { ProviderStructuredJsonRequest, StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { normalizeProviderUsage } from "@/utils/text/tokenEstimate";

const MAX_PRIVATE_RESPONSE_BYTES = 1024 * 1024;
const MAX_PRIVATE_OUTPUT_CHARS = 16384;

export function privateStructuredFailure<T>(
  request: ProviderStructuredJsonRequest,
  failure: "transport" | "malformed" | "refusal" = "transport",
  httpStatus?: number,
): StructuredOutputResult<T> {
  return {
    success: false,
    error: "Structured request unavailable",
    failure: request.abortSignal?.aborted ? "cancelled" : failure,
    httpStatus,
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
  try {
    const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
    if (!serialized || serialized.length > MAX_PRIVATE_OUTPUT_CHARS)
      return privateStructuredFailure(request, "malformed");
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    const result = schema.safeParse(parsed);
    return result.success ? { success: true, data: result.data } : privateStructuredFailure(request, "malformed");
  } catch {
    return privateStructuredFailure(request, "malformed");
  }
}
