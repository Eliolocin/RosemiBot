import { z, type ZodType } from "zod";
import type { DecisionModelRow, TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import type { CompactRoleplaySummary } from "@/types/misc/compact";
import type { PresetExportData } from "@/types/preset/presetExport";
import type { ToolContext } from "@/types/tool/interfaces";

export type EmbeddingTaskType =
  | "SEMANTIC_SIMILARITY"
  | "CLASSIFICATION"
  | "CLUSTERING"
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "CODE_RETRIEVAL_QUERY"
  | "QUESTION_ANSWERING"
  | "FACT_VERIFICATION";

export interface EmbeddingRequest {
  provider: string;
  apiKey: string;
  model: string;
  inputs: string[];
  taskType?: EmbeddingTaskType;
  /**
   * Internal embedding model id (DB primary key). Lets custom providers resolve the exact endpoint
   * when a label hosts several embedding models. Optional; resolution falls back without it.
   */
  modelId?: number;
}

export interface ProviderImageInput {
  url: string;
  name?: string;
  mimeType?: string;
}

export type StructuredOutputResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      failure?: "transport" | "malformed" | "refusal" | "cancelled";
      httpStatus?: number;
    };

export interface ProviderStructuredJsonRequest {
  abortSignal?: AbortSignal;
  onUsage?: (usage: import("@/utils/text/tokenEstimate").TokenUsage) => void;
  /** Private output uses one attempt and returns safe failure metadata to its caller for logging. */
  privateOutput?: boolean;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt: string;
  userPrompt: string;
  images?: ProviderImageInput[];
  temperature?: number;
  maxOutputTokens?: number;
  schemaName?: string;
}

export interface GeneratePresetParams {
  characterName: string;
  characterDescription: string;
  speechExamples: string;
  additionalInstructions?: string;
  imageBase64?: string;
  imageMimeType?: string;
  useWebSearch?: boolean;
  modelName?: string;
  /** Serialized existing card/preset data extracted from the uploaded image, used as AI reference context */
  existingPresetContext?: string;
  /**
   * Visual appearance text a vision model produced from the uploaded avatar.
   *
   * Kept separate from `existingPresetContext` because the two are different kinds of input:
   * that field carries a structured character card the user uploaded, while this carries a
   * description of an image the primary model cannot see. The prompt labels them separately
   * so the model does not read a caption as extracted card data.
   */
  appearanceDescription?: string;
  /**
   * Output-token budget for this request, already resolved by the caller.
   *
   * Passed through rather than re-derived in each provider so the server's configured ceiling
   * and a known model limit apply once, and every provider asks for the same budget.
   */
  maxOutputTokens?: number;
}

/** Failure classes a provider reports to the command layer, which maps each to its own copy. */
export type PresetGenerationErrorType =
  | "RATE_LIMIT"
  | "BLOCKED_CONTENT"
  | "API_KEY"
  | "CONNECTION"
  | "MODEL_ERROR"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export interface PresetGenerationResult {
  preset?: PresetExportData;
  error?: string;
  errorType?: PresetGenerationErrorType;
}

export interface ProviderPresetGenerationRequest {
  apiKey: string;
  locale: string;
  params: GeneratePresetParams;
  tomoriState: TomoriState;
  toolContext?: ToolContext;
  maxToolRounds?: number;
}

export interface ProviderCompactSummaryRequest {
  apiKey: string;
  model: string;
  endpointUrl?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  images?: ProviderImageInput[];
}

export interface CompactConversationResult {
  summary?: string;
  error?: string;
}

export interface CompactRoleplayResult {
  summary?: CompactRoleplaySummary;
  error?: string;
}

interface ProviderLiveTokenCountRequest {
  apiKey: string;
  tomoriState: TomoriState;
  contextItems: StructuredContextItem[];
}

interface ProviderLiveTokenCountResult {
  providerLabel: string;
  model: string;
  inputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

interface ProviderNativeImageReference {
  mimeType: string;
  data: string;
}

type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string | null;
  referenceImageDataUrl?: string | null;
  inpaint?: boolean;
  maskPrompt?: string | null;
  maskThreshold?: number | null;
  maskGrow?: number | null;
  maskFeather?: number | null;
  cfg?: number | null;
  denoise?: number | null;
  referenceDenoise?: number | null;
  seed?: number | null;
};

export interface ProviderNativeImageGenerationRequest extends ImageGenerationRequest {
  apiKey: string;
  model: string;
  aspectRatio: string;
  endpointUrl?: string;
  referenceImages?: ProviderNativeImageReference[];
}

export interface ProviderNativeImageGenerationResult {
  imageData: string | null;
  mimeType: string | null;
  diagnosticImages?: Array<{
    label: string;
    imageData: string;
    mimeType: string;
    filename?: string;
    details?: string;
  }>;
}

export interface SupportsEmbeddings {
  generateEmbeddings(request: EmbeddingRequest): Promise<number[][]>;
  supportsEmbeddingTaskType(): boolean;
}

export interface SupportsStructuredOutput {
  callStructuredJSON<T>(
    request: ProviderStructuredJsonRequest,
    responseSchema: Record<string, unknown>,
    zodSchema: ZodType<T>,
  ): Promise<StructuredOutputResult<T>>;
  getExpressionInitializationBatchSize?(): number | null;
}

export interface SupportsPresetGeneration {
  generatePreset(request: ProviderPresetGenerationRequest): Promise<PresetGenerationResult>;
}

export interface SupportsConversationCompaction {
  generateConversationSummary(request: ProviderCompactSummaryRequest): Promise<CompactConversationResult>;
  generateRoleplaySummary(request: ProviderCompactSummaryRequest): Promise<CompactRoleplayResult>;
}

export interface SupportsLiveTokenCounting {
  measureInputTokens(request: ProviderLiveTokenCountRequest): Promise<ProviderLiveTokenCountResult>;
}

export interface SupportsNativeImageGeneration {
  generateNativeImage(request: ProviderNativeImageGenerationRequest): Promise<ProviderNativeImageGenerationResult>;
}

/** Reference image input for image-to-video generation */
interface ProviderNativeVideoReference {
  mimeType: string;
  data: string; // Base64-encoded image data (used when url is not available)
  url?: string; // Original source URL ; preferred over base64 for remote APIs to avoid body size limits
  fallbackUrl?: string;
}

export type ProviderNativeVideoResolution = "480p" | "720p" | "1080p";

/** Shared across all providers. */
export interface ProviderNativeVideoGenerationRequest {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  durationSeconds?: number;
  /**
   * Target frames-per-second for the generated video. Optional : most hosted providers
   * (Google Veo, OpenRouter, Z.ai) do not expose an FPS control and silently ignore this.
   * Primarily consumed by custom ComfyUI workflows via the `TOMORI_VIDEO_FPS` placeholder.
   */
  fps?: number;
  resolution?: ProviderNativeVideoResolution;
  endpointUrl?: string;
  referenceImages?: ProviderNativeVideoReference[];
  /** Whether the provider should generate audio alongside the video. Defaults to false. */
  generateAudio?: boolean;
  /** Optional separate prompt describing the desired audio, foley, ambience, music, or speech. */
  audioPrompt?: string;
  /** Whether image-to-video generation should reuse the start image as the end frame for a loop. Defaults to false. */
  loop?: boolean;
  /** Turn-level cancellation from /kill. Stops local polling; hosted jobs keep running and may still bill. */
  abortSignal?: AbortSignal;
}

/** Result of a native video generation operation */
export interface ProviderNativeVideoGenerationResult {
  videoData: Buffer | null; // Raw MP4 bytes (not base64 : videos are too large)
  mimeType: string | null;
  filename?: string;
  durationSeconds?: number;
}

export interface SupportsNativeVideoGeneration {
  generateNativeVideo(request: ProviderNativeVideoGenerationRequest): Promise<ProviderNativeVideoGenerationResult>;
}

export interface ProviderCapabilityMap {
  decisions: SupportsDecisions;
  embeddings: SupportsEmbeddings;
  structuredOutput: SupportsStructuredOutput;
  presetGeneration: SupportsPresetGeneration;
  conversationCompaction: SupportsConversationCompaction;
  liveTokenCounting: SupportsLiveTokenCounting;
  imageGeneration: SupportsNativeImageGeneration;
  videoGeneration: SupportsNativeVideoGeneration;
}

export type ProviderCapabilityName = keyof ProviderCapabilityMap;

export type DecisionApiStyle = "openrouter-decisions" | "system-one" | "openai-decisions";

export const decisionModelReferenceSchema = z
  .object({
    provider: z.string().regex(/^(openrouter|custom:[1-9][0-9]*)$/),
    modelId: z.number().int().positive(),
    /** Null for a global catalog row or custom endpoint; scoped registrations retain their exact ID. */
    registrationId: z.number().int().positive().nullable(),
    customEndpointId: z.number().int().positive().nullable(),
  })
  .refine((reference) =>
    reference.provider === "openrouter"
      ? reference.customEndpointId === null
      : reference.customEndpointId !== null && reference.registrationId === null,
  );
export type DecisionModelReference = z.infer<typeof decisionModelReferenceSchema>;

export interface DecisionModelOption {
  model: DecisionModelRow;
  reference: DecisionModelReference;
}

export interface DecisionPredicateQuestion {
  type: "predicate";
  id: string;
  instructions: string;
}

export interface DecisionInput {
  evidence: string;
  questions: readonly DecisionPredicateQuestion[];
  abortSignal?: AbortSignal;
  /** Report validated usage before verdict validation, including late cancelled responses. */
  onUsage?: (usage: DecisionUsage) => void;
}

export interface ProviderDecisionRequest extends DecisionInput {
  reference: DecisionModelReference;
  model: string;
  inputTokenLimit: number;
  apiKey: string | null;
  apiStyle: DecisionApiStyle;
  endpointUrl?: string;
  correlationId: string;
}

export type DecisionAnswer = { type: "predicate"; id: string; probability: number } | { type: "refusal"; id: string };

export interface DecisionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
}

export type DecisionFailureCategory =
  | "http"
  | "authentication"
  | "network"
  | "timeout"
  | "malformed"
  | "unexpected"
  | "credentials";

export type DecisionResult =
  | {
      status: "completed" | "refused";
      answers: DecisionAnswer[];
      usage?: DecisionUsage;
      correlationId: string;
      providerRequestId?: string;
      actualModel: string;
    }
  | { status: "cancelled" | "invalid-input"; correlationId: string; errorLogged: false }
  | {
      status: "unavailable";
      reason: "not-selected" | "unsupported" | "not-owned";
      correlationId: string;
      errorLogged: false;
    }
  | { status: "failed"; category: DecisionFailureCategory; correlationId: string; errorLogged: true };

export interface SupportsDecisions {
  callDecisions(request: ProviderDecisionRequest): Promise<DecisionResult>;
}
