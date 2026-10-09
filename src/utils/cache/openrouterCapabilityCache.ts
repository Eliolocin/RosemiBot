/**
 * OpenRouter Capability Cache
 *
 * Caches per-model metadata from OpenRouter's text catalog so routing decisions use the
 * provider's own view of a model rather than database flags, which drift as OpenRouter
 * changes what a model supports.
 *
 * The catalog refreshes on a miss and on a TTL, so a model published after boot becomes
 * usable without a restart and long-lived deployments do not serve a frozen snapshot of
 * pricing and context limits.
 */

import { createOpenRouterCatalog } from "@/utils/cache/openrouterCatalog";

/**
 * OpenRouter API model response structure
 * Based on https://openrouter.ai/api/v1/models endpoint
 */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number; // Total context window size (input + output tokens)
  supported_parameters?: string[];
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number; // Maximum output tokens the provider supports
  };
}

/**
 * Cached model capabilities
 * Extracted from OpenRouter API's supported_parameters and architecture fields
 */
export interface ModelCapabilities {
  hasTools: boolean; // Function calling support
  seesImages: boolean; // Vision/image input support
  seesVideos: boolean; // Video input support
  supportsStructuredOutput: boolean; // JSON mode / structured output support
}

/**
 * Cached model token limits
 * Extracted from OpenRouter API's context_length and top_provider fields
 */
export interface ModelTokenLimits {
  contextLength: number; // Total context window (input + output)
  maxCompletionTokens: number | undefined; // Max output tokens, undefined if not reported
}

/** Values are normalized to USD per million tokens for prompt/completion cost math. */
export interface ModelPricing {
  promptPricePerMillion: number;
  completionPricePerMillion: number;
}

/** Everything the catalog knows about one text model, swapped as a unit on refresh. */
export interface OpenRouterModelMetadata {
  id: string;
  capabilities: ModelCapabilities;
  supportedParameters: ReadonlySet<string>;
  tokenizer: string | undefined;
  tokenLimits: ModelTokenLimits;
  pricing: ModelPricing | undefined;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

/**
 * Determines if a model supports function calling
 *
 * Requirements:
 * - Prefer explicit "tools" in supported_parameters
 * - Fall back to description-based detection when OpenRouter metadata is inconsistent
 *
 * Rationale:
 * - OpenRouter tool calling works when the model accepts the `tools` parameter.
 * - `tool_choice` is optional for our chat path because OpenRouter defaults it to
 *   automatic selection when omitted.
 * - Some models expose native function calling but do not advertise `tool_choice`.
 * - Some models also advertise native function calling in the description while
 *   omitting `tools` from supported_parameters, so we need a fallback to avoid
 *   incorrectly disabling working tools.
 */
function detectToolSupport(model: OpenRouterModel): boolean {
  if (model.supported_parameters && Array.isArray(model.supported_parameters)) {
    if (model.supported_parameters.includes("tools")) {
      return true;
    }
  }

  // OpenRouter metadata is occasionally contradictory: the model description can
  // advertise native function/tool calling even when supported_parameters omits `tools`.
  const normalizedDescription = model.description?.toLowerCase() ?? "";
  return normalizedDescription.includes("function calling") || normalizedDescription.includes("tool calling");
}

/**
 * Determines if a model supports image inputs (vision)
 *
 * OpenRouter uses arrow notation ("text+image->text"), not "vision"/"multimodal";
 * the other keywords are accepted only as forward compatibility with format changes.
 */
function detectImageSupport(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality?.toLowerCase();

  return modality?.includes("image") || modality?.includes("vision") || modality?.includes("multimodal") || false;
}

function detectVideoSupport(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality?.toLowerCase();
  const hasVideoModality = modality?.includes("video") || false;

  const hasVideoParam = model.supported_parameters?.includes("video") || false;

  return hasVideoModality || hasVideoParam;
}

function detectStructuredOutputSupport(model: OpenRouterModel): boolean {
  return (
    model.supported_parameters?.includes("response_format") ||
    model.supported_parameters?.includes("structured_outputs") ||
    false
  );
}

function parseUsdPerMillion(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;

  // OpenRouter /models pricing values are per-token USD.
  return parsed * 1_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildModelMetadata(model: OpenRouterModel): OpenRouterModelMetadata {
  const promptPricePerMillion = parseUsdPerMillion(model.pricing?.prompt);
  const completionPricePerMillion = parseUsdPerMillion(model.pricing?.completion);
  const tokenizer = model.architecture?.tokenizer?.trim();

  return {
    id: model.id,
    capabilities: {
      hasTools: detectToolSupport(model),
      seesImages: detectImageSupport(model),
      seesVideos: detectVideoSupport(model),
      supportsStructuredOutput: detectStructuredOutputSupport(model),
    },
    supportedParameters: new Set(model.supported_parameters ?? []),
    tokenizer: tokenizer && tokenizer.length > 0 ? tokenizer : undefined,
    tokenLimits: {
      contextLength: model.context_length ?? 0,
      maxCompletionTokens: model.top_provider?.max_completion_tokens,
    },
    pricing:
      promptPricePerMillion !== undefined && completionPricePerMillion !== undefined
        ? { promptPricePerMillion, completionPricePerMillion }
        : undefined,
  };
}

export function parseOpenRouterModelList(payload: unknown): OpenRouterModelMetadata[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Unexpected API response format - missing data array");
  }

  const models: OpenRouterModelMetadata[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim().length === 0) {
      continue;
    }
    models.push(buildModelMetadata(entry as unknown as OpenRouterModel));
  }

  return models;
}

const textCatalog = createOpenRouterCatalog<OpenRouterModelMetadata>({
  label: "text",
  url: OPENROUTER_MODELS_URL,
  parse: parseOpenRouterModelList,
  keyOf: (entry) => entry.id,
});

/**
 * Fetches the text catalog once at startup.
 *
 * Failure here is non-fatal and no longer permanent: callers refresh on a cache miss and
 * the background refresher retries on the TTL, so a boot-time network blip degrades to
 * database flags for one refresh window instead of the process lifetime.
 */
export async function initializeOpenRouterCapabilityCache(): Promise<void> {
  await textCatalog.initialize();
}

export function refreshOpenRouterCapabilityCacheIfStale(): Promise<boolean> {
  return textCatalog.refreshIfStale();
}

/**
 * Gets cached capabilities for a specific OpenRouter model.
 *
 * @returns undefined when the model is not cached; use {@link getOrFetchOpenRouterCapabilities}
 * when a miss should be allowed to reach the network.
 */
export function getOpenRouterCapabilities(modelCodename: string): ModelCapabilities | undefined {
  return textCatalog.get(modelCodename)?.capabilities;
}

export function getOpenRouterSupportedParameters(modelCodename: string): ReadonlySet<string> | undefined {
  return textCatalog.get(modelCodename)?.supportedParameters;
}

/** Raw tokenizer label reported by OpenRouter, used to pick a logit-bias encoder. */
export function getOpenRouterTokenizer(modelCodename: string): string | undefined {
  return textCatalog.get(modelCodename)?.tokenizer;
}

/**
 * Reports whether the catalog holds a usable snapshot.
 *
 * Consumers gate on this to decide between OpenRouter metadata and database flags; it says
 * nothing about any individual model, so a lookup can still miss.
 */
export function isOpenRouterCapabilityCacheReady(): boolean {
  return textCatalog.isReady();
}

export function getOpenRouterCapabilityCacheSize(): number {
  return textCatalog.size();
}

export function getOpenRouterTokenLimits(modelCodename: string): ModelTokenLimits | undefined {
  return textCatalog.get(modelCodename)?.tokenLimits;
}

export function getOpenRouterPricing(modelCodename: string): ModelPricing | undefined {
  return textCatalog.get(modelCodename)?.pricing;
}

/** Every complete rate in the current text catalog, keyed by OpenRouter codename. */
export function getAllOpenRouterPricing(): ReadonlyMap<string, ModelPricing> {
  const pricing = new Map<string, ModelPricing>();
  for (const model of textCatalog.values()) {
    if (model.pricing) {
      pricing.set(model.id, model.pricing);
    }
  }
  return pricing;
}

export function resetOpenRouterCapabilityCache(): void {
  textCatalog.reset();
}

/**
 * Gets capabilities for an OpenRouter model, refreshing the catalog on a miss.
 *
 * Use this wherever the codename can be newer than the cached catalog (scoped model
 * registration, account-setting resolution). The refresh is cooldown-gated, so repeated
 * lookups of a codename OpenRouter does not publish cost one fetch per window; `fresh`
 * lifts that gate for callers a human is waiting on.
 */
export async function getOrFetchOpenRouterCapabilities(
  modelCodename: string,
  options?: { fresh?: boolean },
): Promise<ModelCapabilities | undefined> {
  return (await textCatalog.getOrFetch(modelCodename, options))?.capabilities;
}
