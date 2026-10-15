import type { ResponseReviewItem } from "@/constants/responseReview";
import { observeStopRequest } from "@/utils/discord/stream/stopRequests";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ErrorContext, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StructuredOutputResult, SupportsStructuredOutput } from "@/types/provider/featureInterfaces";
import type { LLMProvider, ProviderConfig } from "@/types/provider/interfaces";
import type { PendingResponseLimit, PendingStreamResponse } from "@/types/stream/pendingResponse";
import type { ChatTurnContext, ToolHistoryEntry } from "@/utils/chat/types";
import { getChannelTurnAbortSignal, runUnderWatchdog, touchChannelLock } from "@/utils/chat/channelQueue";
import { llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { MAX_PENDING_RESPONSE_BYTES, MAX_PENDING_RESPONSE_SEGMENTS } from "@/utils/discord/stream/constants";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { containsCredential, log, sanitizeLogPayload } from "@/utils/misc/logger";
import { resolveCustomTextEndpointTarget } from "@/utils/provider/customEndpointService";
import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import { resolveModelLimits } from "@/utils/provider/modelLimits";
import { normalizeProviderName } from "@/utils/provider/providerInfoRegistry";
import { resolveStructuredOutputCapability } from "@/utils/provider/providerCapabilityResolver";
import { withSavedProviderConfig } from "@/utils/provider/savedProviderConfig";
import { decryptApiKey } from "@/utils/security/crypto";
import { localizer } from "@/utils/text/localizer";
import { charsToTokensText, type TokenUsage } from "@/utils/text/tokenEstimate";
import { redactToolParametersForStorage } from "@/utils/tools/toolParameterRedaction";
import { checkResponseRules, type RuleCheckState } from "@/utils/chat/responseRuleCheck";
import { routeResponseDecision, getDecisionCalibration } from "@/utils/chat/responseDecisionRouting";

export const MAX_RESPONSE_REVISIONS = 1;
// Every revision is reviewed again, after the original candidate's review.
const MAX_RESPONSE_REVIEWS = MAX_RESPONSE_REVISIONS + 1;
export const MAX_TOOL_REVIEWS = 8;
export const MAX_TOOL_CORRECTIONS = 2;
const REVIEW_TIMEOUT_MS = 120000;
// Role and message framing the provider adds around the system and user prompts.
const PROMPT_FRAMING_TOKENS = 1024;
const RUBRIC_VERSION = "roleplay-response-v1";

const REPLY_FINDING_CATEGORIES = [
  "character",
  "voice",
  "initiative",
  "chemistry",
  "repetition",
  "continuity",
  "prose",
] as const;

function reviewResultSchema<const Categories extends readonly [string, ...string[]]>(categories: Categories) {
  const finding = z
    .object({
      category: z.enum(categories),
      problem: z.string().trim().min(1).max(300),
      direction: z.string().trim().min(1).max(300),
    })
    .strict();
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("pass") }).strict(),
    z.object({ status: z.literal("revise"), findings: z.array(finding).min(1).max(4) }).strict(),
    z.object({ status: z.literal("unavailable") }).strict(),
  ]);
}
export const draftReviewResultSchema = reviewResultSchema([...REPLY_FINDING_CATEGORIES, "tool_use"]);
// Even an unused `tool_use` enum value invites the reviewer to critique tool choice.
const replyOnlyReviewResultSchema = reviewResultSchema(REPLY_FINDING_CATEGORIES);
export type DraftReviewResult = z.infer<typeof draftReviewResultSchema>;

/**
 * The provider still receives the strict schema; this only decides what is accepted back. A pass or
 * unavailable carries no other meaning, so a stray key such as `"findings": []` is dropped instead of
 * voiding the review. A revise is never repaired: its findings go to the author verbatim.
 */
function acceptReviewResult<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const status = (value as { status?: unknown }).status;
    return status === "pass" || status === "unavailable" ? { status } : value;
  }, schema);
}

type MalformedReply = NonNullable<Extract<StructuredOutputResult<unknown>, { success: false }>["malformed"]>;

function formatRetryNote(malformed: MalformedReply): string {
  const ask = "Answer again with only the JSON object, without code fences or other text.";
  if (malformed.reason === "empty")
    return `Your previous answer was empty, most likely because reasoning used up the output limit. ${ask}`;
  if (malformed.reason === "unparsable") return `Your previous answer was not one valid JSON object. ${ask}`;
  const issues = (malformed.issues ?? []).map((issue) => `- ${issue}`).join("\n");
  return `Your previous answer did not match the schema:\n${issues}\n${ask}`;
}

export type TurnUsageEntry = {
  model: string;
  usage: TokenUsage;
} & ({ kind: "author" | "reviewer" } | { kind: "decision"; decisionModelId: number });

/** Shared by stream passes, key rotation and model fallback for one admitted persona turn. */
export interface ResponseReviewState {
  reviewerId: number | null;
  prompt: string;
  customPrompt: boolean;
  decisionModelId: number | null;
  reviewItems: ResponseReviewItem[];
  decisionRequests: number;
  decisionVerdict?: { identity: string; skip: boolean };
  rules: RuleCheckState;
  responseReviews: number;
  revisions: number;
  toolReviews: number;
  toolCorrections: number;
  toolRejections: Map<string, Extract<DraftReviewResult, { status: "revise" }>>;
  rejectedChains: Map<string, { retried: boolean; verdict: Extract<DraftReviewResult, { status: "revise" }> }>;
  successfulTools: Map<string, ToolHistoryEntry>;
  unavailable: boolean;
  feedback?: Extract<DraftReviewResult, { status: "revise" }>;
  revisionDraft?: string;
  functionHistory: ToolHistoryEntry[];
  pending: PendingStreamResponse[];
  usage: TurnUsageEntry[];
  usageRecorder?: (entry: TurnUsageEntry) => void;
  verdict?: { identity: string; result: DraftReviewResult };
}

/**
 * Room left for held prose before the next stream pass. Pre-tool narration from earlier passes is
 * still pending, so the turn ceiling covers the whole candidate rather than each pass.
 */
export function remainingPendingResponseLimit(state: ResponseReviewState): PendingResponseLimit {
  let bytes = 0;
  let segments = 0;
  for (const part of state.pending) {
    bytes += part.retainedBytes;
    segments += part.segments;
  }
  return {
    maxBytes: Math.max(0, MAX_PENDING_RESPONSE_BYTES - bytes),
    maxSegments: Math.max(0, MAX_PENDING_RESPONSE_SEGMENTS - segments),
  };
}

/** Late auxiliary usage still reaches accounting after post-turn effects drain the ledger. */
export function recordResponseReviewUsage(state: ResponseReviewState, entry: TurnUsageEntry): void {
  state.usage.push(entry);
  state.usageRecorder?.(entry);
}

export function createResponseReviewState(context: ChatTurnContext): ResponseReviewState | undefined {
  if (
    !context.currentPersona.config.response_drafting_enabled ||
    context.streamingContext.suppressTextOutput ||
    context.isUserImpersonation
  )
    return undefined;
  return {
    reviewerId: context.currentPersona.config.response_reviewer_llm_id,
    customPrompt: context.currentPersona.config.response_reviewer_prompt !== null,
    decisionModelId: context.currentPersona.config.response_decision_model_id,
    reviewItems: [...context.currentPersona.config.response_review_items],
    decisionRequests: 0,
    rules: { calls: 0 },
    prompt:
      context.currentPersona.config.response_reviewer_prompt ??
      localizer(context.locale, "commands.config.drafting.default_prompt"),
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

const OMITTED_TAGS = new Set([
  ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
  ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
  ContextItemTag.KNOWLEDGE_PERSONA_SPRITES,
  ContextItemTag.KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS,
  ContextItemTag.SYSTEM_FUNCTION_GUIDE,
]);

const PERSONA_TAGS = new Set([
  ContextItemTag.SYSTEM_PERSONALITY,
  ContextItemTag.SYSTEM_PERSONA_PROMPT,
  ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
  ContextItemTag.SYSTEM_HUMANIZER_RULES,
  ContextItemTag.SYSTEM_CHANNEL_PROMPT,
]);

function reviewItemGroup(item: StructuredContextItem): ResponseReviewItem {
  if (item.metadataTag && PERSONA_TAGS.has(item.metadataTag)) return "persona";
  if (item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE) return "examples";
  if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY) return "history";
  return "context";
}

/**
 * The reviewer reads as a blind model even when it has vision: it judges prose, and loading media
 * would add a fetch and image tokens to each of up to ten reviews per turn for little gain.
 */
const MEDIA_PLACEHOLDERS = {
  image: "[Image attached here. It is not shown to the reviewer.]",
  video: "[Video attached here. It is not shown to the reviewer.]",
} as const;

function projectItem(item: StructuredContextItem) {
  return {
    tag: item.metadataTag ?? "admitted_context",
    role: item.role,
    sender: item.sender,
    messageId: item.messageId,
    participants: item.participantReviewEvidence
      ? (sanitizeLogPayload(
          item.participantReviewEvidence,
          0,
          false,
        ) as StructuredContextItem["participantReviewEvidence"])
      : undefined,
    text: item.participantReviewEvidence
      ? undefined
      : item.parts.map((part) => (part.type === "text" ? part.text : MEDIA_PLACEHOLDERS[part.type])).join("\n"),
  };
}
type ProjectedItem = ReturnType<typeof projectItem>;

export interface ProposedToolRequest {
  name: string;
  args: Record<string, unknown>;
}

interface ReviewerToolEntry {
  name: string;
  description?: string;
  parameters: string[];
}

/**
 * The reviewer judges tool choice, not argument syntax, so it gets names, purposes and parameter
 * names. Full schemas nest past the sanitizer's depth cap (array-of-object parameters such as
 * NovelAI characters), and the `[TRUNCATED` marker that leaves would void every packet of the turn.
 * Providers hand tools in OpenAI (`function`), Gemini (`functionDeclarations`) or flat Anthropic shape.
 */
function compactToolCatalog(tools: ProviderConfig["tools"] = []): ReviewerToolEntry[] {
  const describe = (definition: Record<string, unknown>): ReviewerToolEntry[] => {
    if (typeof definition.name !== "string") return [];
    const schema = (definition.parameters ?? definition.input_schema ?? definition.parametersJsonSchema) as
      | { properties?: Record<string, unknown> }
      | undefined;
    return [
      {
        name: definition.name,
        description: typeof definition.description === "string" ? definition.description : undefined,
        parameters: Object.keys(schema?.properties ?? {}),
      },
    ];
  };
  return tools.flatMap((tool) => {
    if (Array.isArray(tool.functionDeclarations))
      return (tool.functionDeclarations as Array<Record<string, unknown>>).flatMap(describe);
    if (tool.function && typeof tool.function === "object") return describe(tool.function as Record<string, unknown>);
    return describe(tool);
  });
}

/** Why a reviewer packet could not be built; traced as the unavailable category. */
type ReviewerPacketGap =
  | "review_inactive"
  | "candidate_credential"
  | "tool_arguments_redacted"
  | "unknown_tool"
  | "trigger_missing"
  | "persona_missing"
  | "reply_target_missing"
  | "evidence_over_budget"
  | "evidence_truncated";

/** Uses admitted evidence only. Required prose is complete; optional dialogue carries coverage. */
export function buildReviewerPacket(
  context: ChatTurnContext,
  candidate: string,
  inputTokens: number,
  tools: ProviderConfig["tools"] = [],
  proposedCall?: ProposedToolRequest,
) {
  const state = context.responseReview;
  if (!state || (proposedCall && !state.reviewItems.includes("tools")))
    return "review_inactive" satisfies ReviewerPacketGap;
  if (containsCredential(candidate)) return "candidate_credential" satisfies ReviewerPacketGap;
  // Proposed speech stays in transient reviewer evidence because storage redaction would hide the prose being judged.
  if (
    proposedCall &&
    JSON.stringify(
      sanitizeLogPayload(
        proposedCall.name === "generate_voice_message"
          ? proposedCall.args
          : redactToolParametersForStorage(proposedCall.name, proposedCall.args),
        0,
        false,
      ),
    ) !== JSON.stringify(proposedCall.args)
  )
    return "tool_arguments_redacted" satisfies ReviewerPacketGap;
  const catalog = state.reviewItems.includes("tools") ? compactToolCatalog(tools) : [];
  if (proposedCall && !catalog.some((tool) => tool.name === proposedCall.name))
    return "unknown_tool" satisfies ReviewerPacketGap;
  const items = context.contextItems.filter((item) => !item.metadataTag || !OMITTED_TAGS.has(item.metadataTag));
  // A persona's own message pushes its leading `[System: ...]` blocks as a separate item before its
  // prose under the same ID, so the last match is the prose the reviewer needs.
  const findMessage = (id: string) =>
    items.findLast((item) => item.messageId === id || item.combinedMessageIds?.includes(id));
  const trigger = findMessage(context.message.id);
  const replyId = context.message.reference?.messageId;
  const replyTarget = replyId ? findMessage(replyId) : undefined;
  const persona = items.filter(
    (item) =>
      item.metadataTag === ContextItemTag.SYSTEM_PERSONALITY ||
      item.metadataTag === ContextItemTag.SYSTEM_PERSONA_PROMPT ||
      item.metadataTag === ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
  );
  if (!trigger) return "trigger_missing" satisfies ReviewerPacketGap;
  if (state.reviewItems.includes("persona") && !persona.length) return "persona_missing" satisfies ReviewerPacketGap;
  if (replyId && !replyTarget) return "reply_target_missing" satisfies ReviewerPacketGap;
  const selectedItems = items.filter((item) => state.reviewItems.includes(reviewItemGroup(item)));
  const functionHistory = state.reviewItems.includes("tools") ? state.functionHistory : [];
  const history = selectedItems.filter(
    (item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item !== trigger && item !== replyTarget,
  );
  const samples = selectedItems.filter((item) => item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE);
  const required = selectedItems.filter(
    (item) =>
      item !== trigger &&
      item !== replyTarget &&
      item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY &&
      item.metadataTag !== ContextItemTag.DIALOGUE_SAMPLE,
  );
  const packet = {
    kind: proposedCall ? ("tool_call" as const) : ("response_text" as const),
    proposedCall: proposedCall
      ? { status: "not_executed", name: proposedCall.name, arguments: proposedCall.args }
      : undefined,
    personaName: context.currentPersona.persona_nickname,
    candidate: {
      status: state.pending.some((part) => part.truncation) ? "pending_cut_at_length_limit" : "pending",
      text: candidate,
    },
    trigger: sanitizeLogPayload(projectItem(trigger), 0, false) as ProjectedItem,
    replyTarget: replyTarget ? (sanitizeLogPayload(projectItem(replyTarget), 0, false) as ProjectedItem) : null,
    requirementsAndEvidence: required.map((item) => sanitizeLogPayload(projectItem(item), 0, false) as ProjectedItem),
    historicalDialogue: history
      .slice(-2)
      .map((item) => sanitizeLogPayload(projectItem(item), 0, false) as ReturnType<typeof projectItem>),
    representativeDialogues: [] as ReturnType<typeof projectItem>[],
    availableTools: sanitizeLogPayload(catalog, 0, false) as ReviewerToolEntry[],
    tools: functionHistory.map((entry) => ({
      name: entry.functionCall.name,
      arguments: sanitizeLogPayload(
        redactToolParametersForStorage(entry.functionCall.name, entry.functionCall.args ?? {}),
        0,
        false,
      ),
      outcome: sanitizeLogPayload(entry.functionResponse, 0, false),
      status: "actual_outcome",
      imageOmitted: entry.imageMetadata ? true : undefined,
    })),
    revision: {
      count: state.revisions,
      toolCorrections: state.reviewItems.includes("tools") ? state.toolCorrections : undefined,
      findings: state.feedback?.findings ?? [],
    },
    coverage: {
      reviewItems: state.reviewItems,
      historyIncluded: Math.min(2, history.length),
      historyTotal: items.filter(
        (item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && item !== trigger && item !== replyTarget,
      ).length,
      samplesIncluded: 0,
      // Samples are user/model pairs and are admitted whole, so coverage counts pairs.
      samplesTotal: Math.ceil(items.filter((item) => item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE).length / 2),
      // Decision routing treats anything but "text_only" as insufficient evidence for skipping review.
      media:
        [trigger, ...(replyTarget ? [replyTarget] : []), ...selectedItems].some((item) =>
          item.parts.some((part) => part.type !== "text"),
        ) || functionHistory.some((entry) => entry.imageMetadata)
          ? "placeholders"
          : "text_only",
      toolArguments: "redacted",
      omittedCatalogs: true,
    },
  };
  const fits = () => charsToTokensText(renderReviewerPrompt(packet).length) <= inputTokens;
  if (!fits()) return "evidence_over_budget" satisfies ReviewerPacketGap;
  if (JSON.stringify(packet).includes("[TRUNCATED")) return "evidence_truncated" satisfies ReviewerPacketGap;
  // Keep recent dialogue and complete user/model sample pairs; an oversized optional item is omitted.
  for (let index = 0; index < samples.length; index += 2) {
    const pair = samples
      .slice(index, index + 2)
      .map((item) => sanitizeLogPayload(projectItem(item), 0, false) as ReturnType<typeof projectItem>);
    packet.representativeDialogues.push(...pair);
    packet.coverage.samplesIncluded++;
    if (!fits()) {
      packet.representativeDialogues.splice(-pair.length);
      packet.coverage.samplesIncluded--;
    }
  }
  for (const item of history.slice(-24, -2).reverse()) {
    packet.historicalDialogue.unshift(
      sanitizeLogPayload(projectItem(item), 0, false) as ReturnType<typeof projectItem>,
    );
    packet.coverage.historyIncluded++;
    if (!fits()) {
      packet.historicalDialogue.shift();
      packet.coverage.historyIncluded--;
    }
  }
  return packet;
}

export type ReviewerPacket = Exclude<ReturnType<typeof buildReviewerPacket>, ReviewerPacketGap>;

const section = (name: string, body: string, attributes = "") => `<${name}${attributes}>\n${body}\n</${name}>`;

function renderEvidenceItem(item: ProjectedItem): string {
  if (!item.participants) return item.text ?? "";
  const { channel, currentTime, participants } = item.participants;
  return [
    `Channel: ${channel}. Current time: ${currentTime}.`,
    ...participants.map((participant) => [`${participant.name}:`, ...participant.fields].join("\n")),
  ].join("\n");
}

/**
 * The reviewer judges voice and flow, so evidence reads as a tagged transcript rather than escaped JSON.
 * Evidence fixed for the turn comes first and everything a revision changes comes last, so a second
 * review of the same turn reuses the provider's prompt-prefix cache up to `<coverage>`.
 */
export function renderReviewerPrompt(packet: ReviewerPacket, ruleEvidence?: unknown): string {
  const items = (list: ProjectedItem[]) => list.map(renderEvidenceItem).join("\n\n");
  const tools = packet.availableTools;
  const { coverage, revision } = packet;
  const findings = revision.findings.map(
    (finding) => `- [${finding.category}] ${finding.problem} Direction: ${finding.direction}`,
  );
  return [
    `Persona under review: ${packet.personaName}`,
    packet.requirementsAndEvidence.length
      ? section("persona_and_requirements", items(packet.requirementsAndEvidence))
      : "",
    packet.representativeDialogues.length
      ? section("representative_dialogues", items(packet.representativeDialogues))
      : "",
    packet.historicalDialogue.length ? section("recent_dialogue", items(packet.historicalDialogue)) : "",
    packet.replyTarget ? section("reply_target", renderEvidenceItem(packet.replyTarget)) : "",
    section("trigger", renderEvidenceItem(packet.trigger)),
    tools.length ? section("available_tools", JSON.stringify(tools)) : "",
    section(
      "coverage",
      `Selected review items: ${coverage.reviewItems.join(", ") || "draft only"}. Intentionally disabled context is not a defect. Recent dialogue: ${coverage.historyIncluded} of ${coverage.historyTotal} messages. Representative dialogues: ${coverage.samplesIncluded} of ${coverage.samplesTotal} pairs. Media: ${coverage.media}. Tool arguments: ${coverage.toolArguments}. Emoji, sticker and sprite catalogs omitted.`,
    ),
    packet.tools.length
      ? section(
          "completed_tools",
          packet.tools
            .map(
              (tool) =>
                `${tool.name} ${JSON.stringify(tool.arguments)}\nOutcome: ${JSON.stringify(tool.outcome)}${tool.imageOmitted ? `\n${MEDIA_PLACEHOLDERS.image}` : ""}`,
            )
            .join("\n\n"),
        )
      : "",
    section(
      "revision_state",
      findings.length ? findings.join("\n") : "No earlier findings.",
      ` revisions="${revision.count}"${revision.toolCorrections === undefined ? "" : ` tool_corrections="${revision.toolCorrections}"`}`,
    ),
    ruleEvidence === undefined
      ? ""
      : section(
          "prose_linter_report",
          typeof ruleEvidence === "string" ? ruleEvidence : JSON.stringify(ruleEvidence),
          ` advisory="true"`,
        ),
    packet.proposedCall
      ? section(
          "proposed_tool_call",
          `${packet.proposedCall.name} ${JSON.stringify(packet.proposedCall.arguments)}`,
          ` status="${packet.proposedCall.status}"`,
        )
      : "",
    packet.kind === "response_text"
      ? section("pending_candidate", packet.candidate.text, ` status="${packet.candidate.status}"`)
      : packet.candidate.text
        ? section("pending_narration", packet.candidate.text, ` status="${packet.candidate.status}"`)
        : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function resolveReviewer(
  context: ChatTurnContext,
  author: LLMProvider,
  config: ProviderConfig,
  failureContext: ErrorContext,
): Promise<
  { capability: SupportsStructuredOutput; state: TomoriState; apiKey: string } | { errorLogged: true } | null
> {
  const review = context.responseReview;
  if (!review) return null;
  if (review.reviewerId === null) {
    if (
      !context.tomoriState.llm.supports_structoutput ||
      typeof (author as Partial<SupportsStructuredOutput>).callStructuredJSON !== "function"
    )
      return null;
    return {
      capability: author as LLMProvider & SupportsStructuredOutput,
      state: context.tomoriState,
      apiKey: config.apiKey,
    };
  }
  const model = await llmModelRepo.loadById(review.reviewerId);
  if (!model || model.is_deprecated || !model.supports_structoutput) return null;
  const available = await llmModelRepo.loadAvailableModelsForProvider(model.llm_provider, false, {
    kind: "server",
    ownerId: context.currentPersona.server_id,
  });
  if (!available?.some((entry) => entry.llm_id === model.llm_id)) return null;
  const saved = await llmProviderRepo.loadSavedProviderConfig(context.currentPersona.server_id, model.llm_provider);
  if (!saved?.api_key) return null;
  const capability = await resolveStructuredOutputCapability(model.llm_provider);
  if (!capability) return null;
  const state = withSavedProviderConfig({ ...context.currentPersona, llm: model }, saved);
  // A pinned model must resolve its own endpoint rather than the author's mirrored endpoint.
  state.config = { ...state.config, custom_endpoint_url: null, custom_num_ctx: null };
  try {
    return { capability, state, apiKey: await decryptApiKey(saved.api_key, saved.key_version ?? 1, failureContext) };
  } catch {
    return { errorLogged: true };
  }
}

export function responseReviewCancelled(context: ChatTurnContext): boolean {
  return Boolean(
    getChannelTurnAbortSignal(context.channel.id)?.aborted || StreamOrchestrator.hasStopRequest(context.channel.id),
  );
}

async function reviewCandidate(
  context: ChatTurnContext,
  author: LLMProvider,
  config: ProviderConfig,
  proposedCall?: ProposedToolRequest,
): Promise<DraftReviewResult | { status: "cancelled" }> {
  const state = context.responseReview;
  if (!state) return { status: "unavailable" };
  if (responseReviewCancelled(context)) return { status: "cancelled" };
  const kind = proposedCall ? "tool_call" : "response_text";
  const started = Date.now();
  const correlation = randomUUID();
  let modelId: number | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let thinkingLevel: string | undefined;
  const trace = (outcome: string, extra: Record<string, unknown> = {}) =>
    log.info(
      `Response review ${JSON.stringify({
        correlation,
        candidateKind: kind,
        enabled: true,
        authorModel: context.tomoriState.llm.llm_codename,
        credentialSource: state.reviewerId === null ? context.textCredentialSource : "server",
        maxReviews: proposedCall ? MAX_TOOL_REVIEWS : MAX_RESPONSE_REVIEWS,
        maxToolCorrections: MAX_TOOL_CORRECTIONS,
        toolReviews: state.toolReviews,
        toolCorrections: state.toolCorrections,
        maxRevisions: MAX_RESPONSE_REVISIONS,
        rubric: RUBRIC_VERSION,
        outcome,
        modelId,
        model,
        provider,
        thinkingLevel,
        reviews: state.responseReviews,
        revisions: state.revisions,
        elapsedMs: Date.now() - started,
        ...extra,
      })}`,
    );
  // Unavailable holds for the rest of the turn; logging each skip keeps a later held reply
  // from looking reviewed when only the first failure was traced.
  if (state.unavailable) {
    trace("unavailable", { category: "earlier_in_turn" });
    return { status: "unavailable" };
  }
  const unavailable = async (
    category: string,
    operational = false,
    httpStatus?: number,
  ): Promise<DraftReviewResult> => {
    state.unavailable = true;
    if (operational)
      await log.error("Response review unavailable", new Error("Reviewer operation failed"), {
        errorType: "ResponseReviewError",
        metadata: {
          correlation,
          operation: kind,
          category,
          modelId,
          model,
          provider,
          httpStatus,
          elapsedMs: Date.now() - started,
        },
      });
    trace("unavailable", { category });
    return { status: "unavailable" };
  };
  const interrupted = new AbortController();
  const unobserve = observeStopRequest(context.channel.id, () => interrupted.abort());
  const turnSignal = getChannelTurnAbortSignal(context.channel.id);
  const timeout = AbortSignal.timeout(REVIEW_TIMEOUT_MS);
  const signal = AbortSignal.any([interrupted.signal, timeout, ...(turnSignal ? [turnSignal] : [])]);
  const cancelled = () => interrupted.signal.aborted || responseReviewCancelled(context);
  const wait = async <T>(work: Promise<T>): Promise<T | null> =>
    new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        resolve(null);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      work
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort))
        .catch(() => undefined);
    });
  try {
    const resolved = await runUnderWatchdog(context.channel.id, () =>
      wait(
        resolveReviewer(context, author, config, {
          errorType: "ResponseReviewError",
          metadata: { correlation, operation: kind, category: "credentials", reviewerId: state.reviewerId },
        }),
      ),
    );
    if (cancelled()) {
      trace("cancelled");
      return { status: "cancelled" };
    }
    if (timeout.aborted) return unavailable("timeout", true);
    if (!resolved) return unavailable("registration_or_capability", true);
    if ("errorLogged" in resolved) return unavailable("credentials");
    modelId = resolved.state.llm.llm_id;
    model = resolved.state.llm.llm_codename;
    provider = resolved.state.llm.llm_provider;
    thinkingLevel = resolved.state.config.thinking_level;
    const target = provider.startsWith("custom:")
      ? await runUnderWatchdog(context.channel.id, () => wait(resolveCustomTextEndpointTarget(resolved.state)))
      : null;
    if (cancelled()) {
      trace("cancelled");
      return { status: "cancelled" };
    }
    if (timeout.aborted) return unavailable("timeout", true);
    const limits = await runUnderWatchdog(context.channel.id, () => wait(resolveModelLimits(resolved.state)));
    if (cancelled()) {
      trace("cancelled");
      return { status: "cancelled" };
    }
    if (timeout.aborted || !limits) return unavailable("timeout", true);
    const window = limits.contextWindow;
    // The chat reply budget, not a verdict-sized one: a reasoning model spends its thinking from the
    // same allowance before it writes the JSON, so a small cap ends in empty content.
    const outputTokens = resolveChatMaxOutputTokens({
      provider: normalizeProviderName(provider),
      configured: resolved.state.config.llm_max_output_tokens,
      modelMaxOutputTokens: limits.maxOutputTokens,
      contextWindow: window,
    });
    const toolTask = proposedCall
      ? "Evaluate this exact normalized tool name, full arguments and target, including user-visible argument prose and pending narration. Compare available definitions/alternatives and completed actions. Identify a wrong target, invented argument, redundant completed action or distracting choice with a concrete correction grounded in the admitted task and persona. Revise rejects execution; never provide replacement arguments for automatic execution."
      : "";
    const cutTask =
      !proposedCall && state.pending.some((part) => part.truncation)
        ? "A pending_cut_at_length_limit candidate stopped at the delivery length limit and will be delivered as cut. Judge the kept text; an abrupt ending alone never requires revision."
        : "";
    // Admins read the panel's reviewer prompt as the reviewer's whole instruction, so no hidden
    // protocol wraps it. Only situational addenda the panel cannot express are appended.
    const systemPrompt = [state.prompt, toolTask, cutTask].filter(Boolean).join("\n\n");
    // An unknown window is trusted the way the author's own request trusts it; the provider rejects
    // an oversized prompt as an ordinary transport failure.
    const inputTokens = window
      ? window - outputTokens - charsToTokensText(systemPrompt.length) - PROMPT_FRAMING_TOKENS
      : Number.POSITIVE_INFINITY;
    const candidate = state.pending.map((part) => part.text).join("\n");
    const tools = proposedCall
      ? await runUnderWatchdog(context.channel.id, () =>
          wait(author.getTools(context.tomoriState, context.streamingContext)),
        )
      : state.reviewItems.includes("tools")
        ? config.tools
        : [];
    if (cancelled()) return { status: "cancelled" };
    if (timeout.aborted) return unavailable("timeout", true);
    const packet = buildReviewerPacket(context, candidate, inputTokens, tools ?? [], proposedCall);
    if (typeof packet === "string") return unavailable(packet);
    if (proposedCall && state.toolReviews >= MAX_TOOL_REVIEWS) return unavailable("tool_review_budget");
    if (!proposedCall && state.responseReviews >= MAX_RESPONSE_REVIEWS) {
      trace("exhausted");
      return { status: "pass" };
    }
    const rules = proposedCall
      ? { status: "disabled" as const }
      : await runUnderWatchdog(context.channel.id, () =>
          wait(
            checkResponseRules(
              context.currentPersona.server_id,
              context.currentPersona.config.response_rule_checker_ref,
              candidate,
              state.rules,
              signal,
            ),
          ),
        );
    if (cancelled() || rules?.status === "cancelled") return { status: "cancelled" };
    if (timeout.aborted || !rules) return unavailable("timeout", true);
    const forceReview = rules.status === "report" || rules.status === "failed";
    const routing = forceReview
      ? "review"
      : await runUnderWatchdog(context.channel.id, () =>
          wait(
            routeResponseDecision(
              context.currentPersona.server_id,
              state,
              packet,
              signal,
              state.decisionModelId === null ? undefined : getDecisionCalibration(state.decisionModelId, kind),
            ),
          ),
        );
    if (cancelled() || routing === "cancelled") return { status: "cancelled" };
    if (timeout.aborted || !routing) return unavailable("timeout", true);
    trace("routing", {
      reason: forceReview ? `rule_${rules.status}` : "decision_policy",
      route: routing,
      ruleStatus: rules.status,
    });
    if (routing === "skip") {
      trace("skipped");
      return { status: "pass" };
    }
    const ruleEvidence = "evidence" in rules ? rules.evidence : undefined;
    const userPrompt = renderReviewerPrompt(
      packet,
      ruleEvidence === undefined ? undefined : sanitizeLogPayload(ruleEvidence, 0, false),
    );
    if (charsToTokensText(userPrompt.length) > inputTokens) return unavailable("rule_evidence_budget");
    const identity = createHash("sha256")
      .update(JSON.stringify([modelId, provider, model, userPrompt, systemPrompt]))
      .digest("hex");
    if (state.verdict?.identity === identity) return state.verdict.result;
    if (proposedCall) state.toolReviews++;
    else state.responseReviews++;
    trace("start", {
      estimatedInputTokens: charsToTokensText(userPrompt.length),
      outputTokens,
      coverage: packet.coverage,
    });
    // Info is hidden at the production default level, the same exposure as the author's request dump.
    log.info(
      `Response review prompt ${correlation}\n${section("system", systemPrompt)}\n${section("user", userPrompt)}`,
    );
    const resultSchema = state.reviewItems.includes("tools") ? draftReviewResultSchema : replyOnlyReviewResultSchema;
    const jsonSchema = z.toJSONSchema(resultSchema, { target: "openapi-3.0" });
    let usage: TokenUsage | undefined;
    const ask = (prompt: string, thinking: string | undefined) =>
      runUnderWatchdog(context.channel.id, () =>
        wait(
          resolved.capability.callStructuredJSON(
            {
              apiKey: resolved.apiKey,
              model: resolved.state.llm.llm_codename,
              endpointUrl: target?.endpointUrl ?? undefined,
              systemPrompt,
              userPrompt: prompt,
              temperature: resolved.state.config.llm_temperature,
              maxOutputTokens: outputTokens,
              thinkingLevel: thinking,
              schemaName: proposedCall ? "tool_review" : "response_review",
              privateOutput: true,
              abortSignal: signal,
              onUsage: (reported) => {
                usage = reported;
                recordResponseReviewUsage(state, { kind: "reviewer", model: model ?? "", usage: reported });
              },
            },
            jsonSchema,
            acceptReviewResult(resultSchema),
          ),
        ),
      );
    let result = await ask(userPrompt, thinkingLevel);
    touchChannelLock(context.channel.id);
    if (cancelled()) {
      trace("cancelled", { usage });
      return { status: "cancelled" };
    }
    if (!result || timeout.aborted) return unavailable("timeout", true);
    // One retry with reasoning off, because an exhausted reasoning budget is the usual cause of an
    // empty reply. It reuses this review's count and deadline, so a bad format cannot add a review.
    if (!result.success && result.failure === "malformed" && result.malformed) {
      trace("format_retry", { reason: result.malformed.reason, usage });
      result = await ask(
        `${userPrompt}

${section("format_retry", formatRetryNote(result.malformed))}`,
        "none",
      );
      touchChannelLock(context.channel.id);
      if (cancelled()) {
        trace("cancelled", { usage });
        return { status: "cancelled" };
      }
      if (!result || timeout.aborted) return unavailable("timeout", true);
    }
    if (!result.success)
      return unavailable(
        result.failure ?? "transport",
        result.failure !== "refusal" && result.failure !== "cancelled",
        result.httpStatus,
      );
    log.info(`Response review reply ${correlation}\n${JSON.stringify(result.data, null, 2)}`);
    const validated = resultSchema.safeParse(result.data);
    if (!validated.success) return unavailable("malformed", true);
    state.verdict = { identity, result: validated.data };
    trace(validated.data.status, { usage });
    if (validated.data.status === "unavailable") state.unavailable = true;
    return validated.data;
  } catch {
    if (cancelled()) {
      trace("cancelled");
      return { status: "cancelled" };
    }
    return unavailable("operation", true);
  } finally {
    unobserve();
  }
}

export function reviewResponseCandidate(context: ChatTurnContext, author: LLMProvider, config: ProviderConfig) {
  return reviewCandidate(context, author, config);
}

/** Object key order and provider call IDs cannot make an identical action new. */
export function toolRequestIdentity(request: ProposedToolRequest): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify([request.name, canonical(request.args)]))
    .digest("hex");
}

export async function reviewToolCandidate(
  context: ChatTurnContext,
  author: LLMProvider,
  config: ProviderConfig,
  request: ProposedToolRequest,
) {
  const state = context.responseReview;
  if (!state) return { status: "unavailable" } as const;
  if (responseReviewCancelled(context)) return { status: "cancelled" } as const;
  const identity = toolRequestIdentity(request);
  const previous = state.toolRejections.get(identity);
  if (previous) return previous;
  // A rejected normalized name owns one correction chain. A passed correction closes it;
  // a second rejection blocks further changed arguments for this name during the turn.
  const chain = state.rejectedChains.get(request.name);
  if (chain) {
    if (
      chain.retried ||
      state.toolCorrections >= MAX_TOOL_CORRECTIONS ||
      state.unavailable ||
      state.toolReviews >= MAX_TOOL_REVIEWS
    ) {
      state.toolRejections.set(identity, chain.verdict);
      log.info(
        `Tool correction exhausted ${JSON.stringify({ toolReviews: state.toolReviews, toolCorrections: state.toolCorrections })}`,
      );
      return chain.verdict;
    }
    chain.retried = true;
    state.toolCorrections++;
  }
  const verdict = await reviewCandidate(context, author, config, request);
  if (verdict.status === "revise") {
    state.toolRejections.set(identity, verdict);
    state.rejectedChains.set(request.name, { retried: chain?.retried ?? false, verdict });
  } else if (chain && verdict.status === "unavailable") {
    // Unavailable cannot approve a correction to a rejected action.
    state.toolRejections.set(identity, chain.verdict);
    return chain.verdict;
  } else if (verdict.status === "pass") state.rejectedChains.delete(request.name);
  return verdict;
}

export function responseRevisionInstruction(state: ResponseReviewState): StructuredContextItem | undefined {
  if (!state.feedback || !state.revisionDraft) return undefined;
  return {
    role: "user",
    parts: [
      {
        type: "text",
        text: `[System: Your editor left notes on your draft post. Nothing in it has been sent yet. Rewrite the whole post as this character and apply every note. Keep the character's voice and every completed tool result. Do not repeat actions that already succeeded. Reply with the complete rewritten post only.\nDraft post: ${JSON.stringify(state.revisionDraft)}\nEditor notes: ${JSON.stringify(state.feedback.findings)}]`,
      },
    ],
  };
}
