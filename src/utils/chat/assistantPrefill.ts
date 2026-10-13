import { ThinkingLevel } from "@google/genai";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { ChatIncoming, ToolHistoryEntry } from "@/utils/chat/types";
import { log } from "@/utils/misc/logger";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { buildBotSpeakerLabelPattern } from "@/utils/text/processors/regexUtils";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";
import {
  providerPrefixCompletionExcludesTools,
  providerRequiresPrefixCompletion,
} from "@/providers/utils/strictChatCompat";
import { resolveToolsEnabled } from "@/utils/tools/toolUseGate";

/** Shared by the `/respond` prefill field and the server prefill modal. */
export const ASSISTANT_PREFILL_MAX_LENGTH = 2000;

export type PrefillSource = "manual" | "server";
export type PrefillMode = "native" | "instruction" | "skip";

/**
 * Why an attempt's model cannot continue a trailing assistant turn: `model` when the backend
 * rejects or ignores one outright, `thinking` when it continues only with thinking off, `tools`
 * when the backend rejects a prefill in a request that also offers tools.
 */
export type PrefillBlocker = "model" | "thinking" | "tools";

/** Tool macros stay unexpanded here: they resolve per provider, and each attempt may differ. */
export interface TurnPrefill {
  text: string;
  source: PrefillSource;
}

interface PrefillCapabilityState {
  llm: Pick<
    LlmRow,
    "llm_provider" | "llm_codename" | "has_tools" | "supports_prefix_completion" | "supports_assistant_prefill"
  >;
  config: Pick<TomoriState["config"], "thinking_level" | "tool_use_enabled">;
}

/**
 * Picks the prefill steering this turn. A `/respond` prefill replaces the server one rather than
 * concatenating, and the server prefill sits out turns whose reply is not the persona answering
 * the conversation (the system prompt is skipped for user impersonation for the same reason).
 */
export function selectTurnPrefillText(
  incoming: Pick<
    ChatIncoming,
    | "manualPrefill"
    | "isUserImpersonation"
    | "reasoningQuery"
    | "reminderRecipientID"
    | "reminderData"
    | "sceneTurn"
    | "isStopResponse"
  >,
  serverPrefill: string | null | undefined,
): { text: string; source: PrefillSource } | null {
  const manual = incoming.manualPrefill?.trim();
  if (manual) return { text: manual, source: "manual" };

  const server = serverPrefill?.trim();
  if (!server) return null;
  if (
    incoming.isUserImpersonation ||
    incoming.reasoningQuery ||
    incoming.reminderRecipientID ||
    incoming.reminderData ||
    incoming.sceneTurn ||
    incoming.isStopResponse
  ) {
    return null;
  }
  return { text: server, source: "server" };
}

/**
 * Decides before the request whether the model continues a prefill, so an unlisted model never
 * receives one: there is no rejection to catch. NovelAI is text completion and prefix-completion
 * backends need the trailing turn by contract, so both continue by construction.
 *
 * Gemini emits no thought parts while a prefill is present, so any thinking budget above off or
 * minimal surfaces as visible text after the continuation. The gate reuses the provider's own
 * thinking builder so it cannot drift from what the request actually sends. The tools gate reuses
 * the providers' own tool gate for the same reason.
 */
export function resolvePrefillBlocker(state: PrefillCapabilityState, forceReason?: boolean): PrefillBlocker | null {
  const { llm } = state;
  if (llm.llm_provider === "novelai") return null;
  if (providerPrefixCompletionExcludesTools(llm.llm_provider) && resolveToolsEnabled(state, llm.has_tools)) {
    return "tools";
  }
  if (providerRequiresPrefixCompletion(llm.llm_provider) || llm.supports_prefix_completion) return null;
  if (!llm.supports_assistant_prefill) return "model";

  if (providerUsesApiFamily(llm.llm_provider, "google-genai")) {
    const thinking = buildGoogleThinkingConfig(llm.llm_codename, state.config.thinking_level, forceReason);
    const thinkingOff = thinking?.thinkingBudget === 0 || thinking?.thinkingLevel === ThinkingLevel.MINIMAL;
    if (!thinkingOff) return "thinking";
  }
  return null;
}

/** A blocked `/respond` prefill degrades to a written instruction; a blocked server prefill is dropped. */
export function resolvePrefillMode(source: PrefillSource, blocker: PrefillBlocker | null): PrefillMode {
  if (!blocker) return "native";
  return source === "manual" ? "instruction" : "skip";
}

/**
 * Applies the turn prefill to one attempt's context. Runs per attempt because a fallback model can
 * differ from the primary: a prefill baked into the shared base would 400 when a model that
 * continues one falls back to a model that rejects one.
 *
 * `outputPrefill` is the exact `{bot}: {text}` string the trailing turn carries. The segment
 * processor strips an echo of it, and the prefix-completion adapters only stamp `prefix: true`
 * when the trailing assistant content equals it.
 */
export async function applyAssistantPrefill(args: {
  contextItems: StructuredContextItem[];
  prefill: TurnPrefill | null;
  tomoriState: TomoriState;
  forceReason?: boolean;
}): Promise<{ contextItems: StructuredContextItem[]; outputPrefill: string | undefined }> {
  if (!args.prefill) return { contextItems: args.contextItems, outputPrefill: undefined };

  const llm = args.tomoriState.llm;
  const blocker = resolvePrefillBlocker(args.tomoriState, args.forceReason);
  const mode = resolvePrefillMode(args.prefill.source, blocker);
  if (mode === "skip") {
    log.warn(
      `Server response prefill skipped: ${llm.llm_provider}:${llm.llm_codename} cannot continue a prefill (${blocker}).`,
    );
    return { contextItems: args.contextItems, outputPrefill: undefined };
  }

  // Lazy so the config panel can import the capability checks above without the tool registry and
  // context builder graphs, which the command loader must not pull in at module evaluation.
  const [{ createToolPromptMacroResolverForState }, { buildTailDirectiveMessage }] = await Promise.all([
    import("@/utils/tools/toolPromptMacros"),
    import("@/utils/chat/contextAnnotations"),
  ]);
  const text = (await createToolPromptMacroResolverForState(args.tomoriState).expand(args.prefill.text)).trim();
  if (!text) return { contextItems: args.contextItems, outputPrefill: undefined };

  const botName = args.tomoriState.persona_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
  // A prefill that already names the speaker keeps its sprite label but takes the real name,
  // because nothing expands `{bot}` on this path.
  const label = text.match(buildBotSpeakerLabelPattern(botName));
  const outputPrefill = label
    ? `${botName}${label[1]}: ${text.slice(label[0].length)}`.trimEnd()
    : `${botName}: ${text}`;

  if (mode === "native") {
    return {
      contextItems: [
        ...args.contextItems,
        { role: "model", parts: [{ type: "text", text: outputPrefill }], metadataTag: ContextItemTag.DIALOGUE_HISTORY },
      ],
      outputPrefill,
    };
  }

  const directive = buildTailDirectiveMessage(
    `Begin your next reply with: "${outputPrefill}". Continue directly after it without repeating the prefix.`,
  );
  return { contextItems: directive ? [...args.contextItems, directive] : args.contextItems, outputPrefill };
}

/**
 * Moves a native prefill out of the trailing assistant turn and into the first tool call's
 * assistant turn once a tool continuation begins. Left trailing, the prefill would precede the
 * tool-call turn as a second consecutive assistant turn, which Gemini and other strict-alternation
 * backends reject. Every adapter joins `preToolCallTextParts` with no separator, so the folded turn
 * reads exactly as the model continued it. Returns new arrays because the key-rotation retry reruns
 * the tool loop on the same context, which must still end with the prefill.
 */
export function foldPrefillIntoToolHistory(
  contextItems: StructuredContextItem[],
  outputPrefill: string | undefined,
  functionHistory: ToolHistoryEntry[],
): { contextItems: StructuredContextItem[]; functionHistory: ToolHistoryEntry[] } {
  const [first, ...rest] = functionHistory;
  const trailing = contextItems.at(-1);
  const trailingText =
    trailing?.parts.length === 1 && trailing.parts[0].type === "text" ? trailing.parts[0].text : null;
  if (!first || !outputPrefill || trailing?.role !== "model" || trailingText !== outputPrefill) {
    return { contextItems, functionHistory };
  }

  return {
    contextItems: contextItems.slice(0, -1),
    functionHistory: [
      {
        ...first,
        preToolCallTextParts: [{ type: "text", text: outputPrefill }, ...(first.preToolCallTextParts ?? [])],
      },
      ...rest,
    ],
  };
}
