/**
 * Shared resolution for the "max output tokens" figure used in two places that
 * MUST agree:
 *
 * - The provider request builders (e.g. `openrouterProvider`, `googleProvider`),
 *    which send it as `max_tokens` / `maxOutputTokens`.
 * - The context truncator (`applyProviderContextTruncation`), which reserves
 *    this many tokens for the reply *before* deciding how much dialogue history
 *    to keep.
 *
 * When these two figures drift, the truncator over-reserves output budget and
 * silently drops chat history that would otherwise fit: the "TomoriBot forgets
 * everything after each message" class of bug. Keeping the resolution in one
 * place makes the intended parity explicit.
 *
 * Resolution order (highest priority first):
 *   - `configured`: the server's `/model parameters` output-token override
 *      (`config.llm_max_output_tokens`).
 *   - `envRaw`: the provider-specific env cap (e.g. `OPENROUTER_MAX_OUTPUT_TOKENS`,
 *      `GOOGLE_MAX_OUTPUT_TOKENS`), when set to a usable positive integer.
 *   - `fallback`: the caller's last-resort value. Providers that want to fall
 *      back to the model's own reported ceiling pass that ceiling here; providers
 *      that want a flat default (OpenRouter's historical 8192) pass that instead.
 *
 * The result is always clamped to `providerReportedMax` when that is a positive
 * number, so neither the reservation nor the request can exceed what the model
 * can actually emit.
 */

/** Chat reply budget for OpenRouter, the Gemini family, and Anthropic when no override or env cap is set. */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Fallback for preset generation (`/persona generate`), deliberately independent of
 * `DEFAULT_MAX_OUTPUT_TOKENS` and never resolved with `config.llm_max_output_tokens`.
 *
 * That config value is a per-persona chat-reply-length knob; coupling preset generation
 * to it would let a user who capped chat replies short for brevity silently truncate
 * every persona they generate, with nothing connecting the two settings from their side.
 * Preset generation is a one-off structured-output task the schema itself sizes up to
 * 16 string fields (`PRESET_MAX_STRING_LENGTH` each), so its budget is set by this
 * constant alone.
 */
export const DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS = 16384;

/**
 * Fallback for one vision caption call, which describes an image rather than answering a
 * conversation turn. Sized for a few paragraphs of appearance detail; the analysis tool's
 * historical literal of 1024 was small enough to clip a detailed character description.
 */
const DEFAULT_VISION_CAPTION_MAX_OUTPUT_TOKENS = 2048;

/**
 * Returns `undefined` for an unset or invalid value rather than a default, so the caller falls through
 * to the next resolution tier.
 */
function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Resolves the output-token budget to reserve (truncation) or request (provider).
 *
 * @param params.configured - `config.llm_max_output_tokens` server override (nullable/optional).
 * @param params.envRaw - Raw provider-specific env override string, or undefined.
 * @param params.fallback - Value used when neither the override nor the env cap is set.
 * @param params.providerReportedMax - The model's reported max completion tokens; when a
 *   positive number, the result is clamped to it so we never exceed the model's ceiling.
 * @returns The resolved output-token budget (always a positive integer).
 */
export function resolveMaxOutputTokens(params: {
  configured: number | null | undefined;
  envRaw: string | undefined;
  fallback: number;
  providerReportedMax?: number;
}): number {
  const { configured, envRaw, fallback, providerReportedMax } = params;

  // Highest-priority intent: server override → provider env cap → caller fallback.
  const desired = (configured ?? parsePositiveIntEnv(envRaw) ?? fallback) || fallback;

  if (typeof providerReportedMax === "number" && providerReportedMax > 0) {
    return Math.max(1, Math.min(providerReportedMax, desired));
  }
  return Math.max(1, desired);
}

/**
 * Each chat request builder's env cap and last-resort budget, keyed by canonical provider name.
 * The OpenAI-compatible first parties and custom endpoints historically sent a flat 4096 with no env
 * cap; changing that alters the live request, not just the reserve.
 */
const CHAT_OUTPUT_BUDGETS: Readonly<Record<string, { envVar?: string; fallback: number }>> = {
  openrouter: { envVar: "OPENROUTER_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  google: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  vertex: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  vertexexpress: { envVar: "GOOGLE_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  anthropic: { envVar: "ANTHROPIC_MAX_OUTPUT_TOKENS", fallback: DEFAULT_MAX_OUTPUT_TOKENS },
  novelai: { fallback: 2048 },
};
const OPENAI_COMPATIBLE_CHAT_OUTPUT_FALLBACK = 4096;

/**
 * The largest share of a known window the default reply budget may take. The truncator reserves the
 * reply before keeping history, so a 4096 default on a 4096 `num_ctx` (the value the setup wizard
 * suggests) would keep no history at all. Every catalog window is at least 128K, where a quarter
 * exceeds every default, so in practice this only lowers custom endpoints and small OpenRouter models.
 */
const MAX_DEFAULT_OUTPUT_WINDOW_SHARE = 0.25;

/**
 * Resolves the chat reply budget a provider requests and the truncator reserves, so the two can only
 * agree. NovelAI's truncation reserve is the exception: it follows the subscription tier instead.
 * An explicit server override or env cap is honored as set; only the provider default shrinks to fit
 * a small window.
 *
 * @param provider - Canonical provider name (`normalizeProviderName`).
 * @param modelMaxOutputTokens - The model's output ceiling from `resolveModelLimits()`, when known.
 * @param contextWindow - The model's window from `resolveModelLimits()`, when known.
 */
export function resolveChatMaxOutputTokens(params: {
  provider: string;
  configured: number | null | undefined;
  modelMaxOutputTokens: number | null;
  contextWindow: number | null;
}): number {
  const budget = CHAT_OUTPUT_BUDGETS[params.provider];
  const providerFallback = budget?.fallback ?? OPENAI_COMPATIBLE_CHAT_OUTPUT_FALLBACK;
  const fallback = params.contextWindow
    ? Math.min(providerFallback, Math.floor(params.contextWindow * MAX_DEFAULT_OUTPUT_WINDOW_SHARE))
    : providerFallback;
  return resolveMaxOutputTokens({
    configured: params.configured,
    envRaw: budget?.envVar ? process.env[budget.envVar] : undefined,
    fallback,
    providerReportedMax: params.modelMaxOutputTokens ?? undefined,
  });
}

/**
 * Resolves the output-token budget for a preset-generation request (`/persona generate`).
 *
 * The preset default is deliberately larger than a chat reply's, because the schema sizes the
 * payload up to 16 string fields. It is not larger than the server's explicit
 * `config.llm_max_output_tokens`, though: a user who capped output there chose a ceiling, and a
 * preset request that exceeds it either gets rejected or bills past what they allowed.
 *
 * @param params.modelCeiling - The model's reported max completion tokens when known, which
 *                             clamps the result so the request is never over the model's limit.
 */
export function resolvePresetGenerationMaxOutputTokens(params?: {
  configured?: number | null;
  modelCeiling?: number;
}): number {
  const configured = params?.configured;

  // A configured ceiling wins only when it is lower; otherwise the preset default applies.
  const desired =
    typeof configured === "number" && configured > 0
      ? Math.min(configured, DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS)
      : DEFAULT_PRESET_GENERATION_MAX_OUTPUT_TOKENS;

  return resolveMaxOutputTokens({
    configured: desired,
    envRaw: undefined,
    fallback: desired,
    providerReportedMax: params?.modelCeiling,
  });
}

/**
 * Resolves the output-token budget for one vision caption call.
 *
 * A caption answers a single question about one image, so it needs a chat reply's worth of
 * room rather than a structured persona's. Deliberately omits `configured`: a user who capped
 * chat replies short for brevity would otherwise truncate the appearance description that the
 * persona generation depends on, and they would see the loss as a bad persona, not a short reply.
 */
export function resolveVisionCaptionMaxOutputTokens(providerReportedMax?: number): number {
  return resolveMaxOutputTokens({
    configured: undefined,
    envRaw: undefined,
    fallback: DEFAULT_VISION_CAPTION_MAX_OUTPUT_TOKENS,
    providerReportedMax,
  });
}
