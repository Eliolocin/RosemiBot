import { ThinkingLevel, type ThinkingConfig } from "@google/genai";
import { toDeepseekApiModelName } from "@/providers/deepseek/deepseekShared";
import {
  DEFAULT_THINKING_LEVEL,
  THINKING_LEVEL_LOCALIZER_KEYS,
  type ThinkingLevelValue,
  isThinkingLevelValue,
} from "@/constants/thinkingLevels";

const DEFAULT_LOW_BUDGET_TOKENS = 1024;
const DEFAULT_MEDIUM_BUDGET_TOKENS = 4096;
const DEFAULT_HIGH_BUDGET_TOKENS = 8192;
const GOOGLE_GEMINI_25_PRO_MIN_BUDGET = 128;
const GOOGLE_GEMINI_25_FLASH_LITE_MIN_BUDGET = 512;

export interface AnthropicThinkingRequest {
  thinking?: {
    type: "adaptive" | "disabled" | "between_tools";
  };
  output_config?: {
    effort: "low" | "medium" | "high";
  };
  omitSampling: boolean;
}

export interface OpenRouterReasoningRequest {
  reasoning?: {
    effort: "none" | "low" | "medium" | "high";
  };
}

export interface ThinkingModeRequest {
  thinking?: {
    type: "enabled" | "disabled";
  };
  omitSampling: boolean;
}

export interface DeepSeekThinkingRequest extends ThinkingModeRequest {
  reasoning_effort?: "low" | "medium" | "high";
}

export interface CustomThinkingRequest {
  /** Ollama-native boolean thinking toggle (on/off only). */
  think?: boolean;
  /** OpenAI-convention effort level (vLLM, other compatible servers). */
  reasoning_effort?: "none" | "low" | "medium" | "high";
}

export interface NvidiaThinkingRequest {
  chat_template_kwargs?: {
    enable_thinking: boolean;
    thinking: boolean;
  };
  reasoning_effort?: "low" | "medium" | "high";
}

type ProviderEffortLevel = "low" | "medium" | "high";
type ProviderReasoningEffortLevel = "none" | ProviderEffortLevel;

function getLevelBudget(level: Exclude<ThinkingLevelValue, "auto" | "none">): number {
  switch (level) {
    case "minimal":
      return 1;
    case "low":
      return DEFAULT_LOW_BUDGET_TOKENS;
    case "medium":
      return DEFAULT_MEDIUM_BUDGET_TOKENS;
    case "high":
      return DEFAULT_HIGH_BUDGET_TOKENS;
  }
}

function normalizeModel(model: string): string {
  return model.trim().toLowerCase();
}

function isGemini25Model(model: string): boolean {
  return normalizeModel(model).startsWith("gemini-2.5");
}

function isGemini3FamilyModel(model: string): boolean {
  const normalized = normalizeModel(model);
  return normalized.startsWith("gemini-3") || normalized.startsWith("gemini-3.1");
}

function isGeminiFlashLiteModel(model: string): boolean {
  return normalizeModel(model).includes("flash-lite");
}

function isGeminiProModel(model: string): boolean {
  return normalizeModel(model).includes("pro");
}

// Pro models and Gemini 3.7 Flash onward reject MINIMAL with a 400 instead of clamping it, while
// every Gemini 3 model accepts LOW. An allow-list therefore costs an unlisted release a little extra
// thinking rather than every request; add a Flash release here once it is confirmed to accept MINIMAL.
const GEMINI_MINIMAL_THINKING_PREFIXES = [
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

function supportsGeminiMinimalThinking(model: string): boolean {
  const normalized = normalizeModel(model);
  return GEMINI_MINIMAL_THINKING_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

interface AnthropicThinkingProfile {
  /** How `none` turns thinking off; `null` where the model always thinks and `none` falls to low effort. */
  off: "disabled" | "between_tools" | null;
  /** The API rejects `top_p` and any `temperature` other than 1 with a 400 even when thinking is off. */
  samplingLocked: boolean;
}

// Each family answers another family's off switch or sampling fields with a 400, so every profile
// was confirmed against the live API. An unlisted release keeps the pre-adaptive request (no thinking
// fields, sampling sent); add it here once its accepted fields are confirmed. A longer codename
// precedes its prefix so `claude-sonnet-5-5` is not read as `claude-sonnet-5`.
const ANTHROPIC_THINKING_PROFILES: ReadonlyArray<readonly [prefix: string, profile: AnthropicThinkingProfile]> = [
  ["claude-fable-", { off: null, samplingLocked: true }],
  ["claude-opus-5-5", { off: null, samplingLocked: true }],
  ["claude-sonnet-5-5", { off: "between_tools", samplingLocked: true }],
  ["claude-haiku-5-5", { off: "disabled", samplingLocked: true }],
  ["claude-opus-5", { off: "disabled", samplingLocked: true }],
  ["claude-sonnet-5", { off: "disabled", samplingLocked: true }],
  ["claude-opus-4-8", { off: "disabled", samplingLocked: true }],
  ["claude-opus-4-7", { off: "disabled", samplingLocked: true }],
  ["claude-opus-4-6", { off: "disabled", samplingLocked: false }],
  ["claude-sonnet-4-6", { off: "disabled", samplingLocked: false }],
  ["claude-mythos-preview", { off: "disabled", samplingLocked: false }],
];

function resolveAnthropicThinkingProfile(model: string): AnthropicThinkingProfile | undefined {
  const normalized = normalizeModel(model);
  return ANTHROPIC_THINKING_PROFILES.find(([prefix]) => normalized.startsWith(prefix))?.[1];
}

// API names (after `toDeepseekApiModelName`) that accept the `thinking` switch.
const DEEPSEEK_THINKING_TOGGLE_MODELS = new Set(["deepseek-flash", "deepseek-v4-pro"]);

function looksLikeOllamaEndpoint(endpointUrl: string): boolean {
  try {
    const { hostname, port } = new URL(endpointUrl);
    const normalizedHost = hostname.toLowerCase();
    return normalizedHost.includes("ollama") || port === "11434";
  } catch {
    return endpointUrl.toLowerCase().includes("ollama");
  }
}

function toProviderEffortLevel(level: Exclude<ThinkingLevelValue, "auto" | "none">): ProviderEffortLevel {
  return level === "minimal" ? "low" : level;
}

function toProviderReasoningEffortLevel(level: Exclude<ThinkingLevelValue, "auto">): ProviderReasoningEffortLevel {
  return level === "none" ? "none" : toProviderEffortLevel(level);
}

function resolveConfiguredThinkingLevel(value: string | null | undefined): ThinkingLevelValue {
  return value && isThinkingLevelValue(value) ? value : DEFAULT_THINKING_LEVEL;
}

function resolveEffectiveThinkingLevel(
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): ThinkingLevelValue {
  const resolved = resolveConfiguredThinkingLevel(configuredLevel);
  if (forceReason && (resolved === "auto" || resolved === "none")) {
    return "high";
  }
  return resolved;
}

export function getThinkingLevelLocalizerKey(value: string | null | undefined): string {
  return THINKING_LEVEL_LOCALIZER_KEYS[resolveConfiguredThinkingLevel(value)];
}

export function buildGoogleThinkingConfig(
  model: string,
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): ThinkingConfig | undefined {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);

  if (isGemini25Model(model)) {
    if (effectiveLevel === "auto") {
      return { thinkingBudget: -1 };
    }

    if (effectiveLevel === "none") {
      if (isGeminiProModel(model)) {
        return { thinkingBudget: GOOGLE_GEMINI_25_PRO_MIN_BUDGET };
      }
      return { thinkingBudget: 0 };
    }

    const requestedBudget = getLevelBudget(effectiveLevel);
    const minimumBudget = isGeminiProModel(model)
      ? GOOGLE_GEMINI_25_PRO_MIN_BUDGET
      : isGeminiFlashLiteModel(model)
        ? GOOGLE_GEMINI_25_FLASH_LITE_MIN_BUDGET
        : 1;

    return {
      thinkingBudget: Math.max(requestedBudget, minimumBudget),
    };
  }

  if (!isGemini3FamilyModel(model)) {
    return undefined;
  }

  if (effectiveLevel === "auto") {
    return undefined;
  }

  if (effectiveLevel === "none" || effectiveLevel === "minimal") {
    return {
      thinkingLevel: supportsGeminiMinimalThinking(model) ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
    };
  }

  if (effectiveLevel === "low") {
    return { thinkingLevel: ThinkingLevel.LOW };
  }

  if (effectiveLevel === "medium") {
    return { thinkingLevel: ThinkingLevel.MEDIUM };
  }

  return { thinkingLevel: ThinkingLevel.HIGH };
}

export function serializeGoogleThinkingConfig(thinkingConfig?: ThinkingConfig): Record<string, unknown> | undefined {
  if (!thinkingConfig) {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  if (thinkingConfig.thinkingBudget !== undefined) {
    out.thinking_budget = thinkingConfig.thinkingBudget;
  }
  if (thinkingConfig.thinkingLevel !== undefined) {
    out.thinking_level = thinkingConfig.thinkingLevel;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildAnthropicThinkingRequest(
  model: string,
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): AnthropicThinkingRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  const profile = resolveAnthropicThinkingProfile(model);
  if (!profile) {
    return { omitSampling: false };
  }

  if (effectiveLevel === "none") {
    if (profile.off === null) {
      return {
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        omitSampling: true,
      };
    }
    return {
      thinking: { type: profile.off },
      omitSampling: profile.samplingLocked,
    };
  }

  if (effectiveLevel === "auto") {
    return {
      thinking: { type: "adaptive" },
      omitSampling: true,
    };
  }

  return {
    thinking: { type: "adaptive" },
    output_config: { effort: toProviderEffortLevel(effectiveLevel) },
    omitSampling: true,
  };
}

export function buildOpenRouterReasoningRequest(
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): OpenRouterReasoningRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  if (effectiveLevel === "auto") {
    return {};
  }

  return {
    reasoning: {
      effort: toProviderReasoningEffortLevel(effectiveLevel),
    },
  };
}

export function buildDeepSeekThinkingRequest(
  model: string,
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): DeepSeekThinkingRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  const apiModel = normalizeModel(toDeepseekApiModelName(model));
  if (!DEEPSEEK_THINKING_TOGGLE_MODELS.has(apiModel) || effectiveLevel === "auto") {
    return { omitSampling: false };
  }

  // V4 models think at high effort when the switch is omitted, so `none` has to send it.
  if (effectiveLevel === "none") {
    return {
      thinking: { type: "disabled" },
      omitSampling: false,
    };
  }

  // DeepSeek folds medium into high and minimal into low on its side.
  return {
    thinking: { type: "enabled" },
    reasoning_effort: toProviderEffortLevel(effectiveLevel),
    omitSampling: true,
  };
}

export function buildZaiThinkingRequest(
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): ThinkingModeRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);

  if (effectiveLevel === "auto") {
    return { omitSampling: false };
  }

  if (effectiveLevel === "none") {
    return {
      thinking: { type: "disabled" },
      omitSampling: false,
    };
  }

  return {
    thinking: { type: "enabled" },
    omitSampling: true,
  };
}

export function buildCustomThinkingRequest(
  endpointUrl: string | null | undefined,
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): CustomThinkingRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  if (effectiveLevel === "auto") {
    return {};
  }

  // Ollama supports a boolean think toggle only (no budget levels).
  if (endpointUrl && looksLikeOllamaEndpoint(endpointUrl)) {
    return { think: effectiveLevel !== "none" };
  }

  // Non-Ollama OpenAI-compatible servers (vLLM, etc.) may support reasoning_effort.
  return { reasoning_effort: toProviderReasoningEffortLevel(effectiveLevel) };
}

/**
 * Maps `thinking_level` onto NVIDIA NIM, which serves many model families behind one endpoint and
 * each family reads a different switch, so every level other than `auto` sends all of them:
 * `enable_thinking` (Nemotron) and `thinking` (DeepSeek) are chat-template kwargs that other
 * templates ignore, and `reasoning_effort` is the only control GLM and gpt-oss honor.
 *
 * `none` still sends effort `"low"`: NIM validates `reasoning_effort` against low/medium/high on
 * gpt-oss and Llama and returns 400 for `"none"`, and GLM ignores both template switches, so low
 * effort is the closest it gets to off. Levels map to effort rather than a token budget because
 * NIM's V2 model runner rejects `reasoning_budget`.
 */
export function buildNvidiaThinkingRequest(
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): NvidiaThinkingRequest {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  if (effectiveLevel === "auto") {
    return {};
  }

  if (effectiveLevel === "none") {
    return {
      chat_template_kwargs: { enable_thinking: false, thinking: false },
      reasoning_effort: "low",
    };
  }

  return {
    chat_template_kwargs: { enable_thinking: true, thinking: true },
    reasoning_effort: toProviderEffortLevel(effectiveLevel),
  };
}

export function getNovelAiThinkingDirective(
  configuredLevel: string | null | undefined,
  forceReason?: boolean,
): "<think></think>" | "/nothink" {
  const effectiveLevel = resolveEffectiveThinkingLevel(configuredLevel, forceReason);
  if (effectiveLevel === "none") {
    return "/nothink";
  }
  if (effectiveLevel === "auto") {
    return (process.env.NAI_GLM_THINKING_ENABLED ?? "true").toLowerCase() === "true" ? "<think></think>" : "/nothink";
  }
  return "<think></think>";
}
