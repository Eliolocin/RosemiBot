import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { HumanizerDegree, type AssembledServerConfig, type TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { appendDialogueHistoryContext, DOCUMENT_HINT_TEMPLATE } from "@/utils/text/context/dialogueHistory";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { shouldInjectVerbatimToolCallingNudge } from "@/utils/tools/verbatimToolCalling";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

function makeMessage(index: number): SimplifiedMessageForContext {
  return {
    id: `message-${index}`,
    authorId: `user-${index}`,
    authorName: `User ${index}`,
    authorType: "user",
    content: `message ${index}`,
    imageAttachments: [],
    videoAttachments: [],
  };
}

function makeConfig(): AssembledServerConfig {
  return {
    message_fetch_limit: 80,
    context_note: null,
    context_note_depth: 0,
    humanizer_degree: HumanizerDegree.NONE,
    personal_memories_enabled: true,
    uncensor_unicode_space_enabled: false,
    uncensor_sanitize_enabled: false,
  } as AssembledServerConfig;
}

function makeTomoriState(options: {
  verbatimToolCalling: boolean;
  hasTools: boolean;
  llmProvider?: string;
}): TomoriState {
  return createPersona({
    context_note: null,
    context_note_depth: 0,
    // The nudge is only parsed by the custom adapter, so the provider default stays "custom"
    // rather than the shared factory's "google".
    llm: createLlmRow({
      verbatim_tool_calling: options.verbatimToolCalling,
      has_tools: options.hasTools,
      llm_provider: options.llmProvider ?? "custom",
    }),
  });
}

async function buildItems(options: {
  verbatimToolCalling: boolean;
  hasTools: boolean;
  llmProvider?: string;
  messageCount?: number;
}) {
  const contextItems: StructuredContextItem[] = [];
  await appendDialogueHistoryContext({
    contextItems,
    client: {} as Client,
    guildId: "guild-1",
    simplifiedMessageHistory: Array.from({ length: options.messageCount ?? 5 }, (_, index) => makeMessage(index)),
    botName: "Tomori",
    tomoriConfig: makeConfig(),
    tomoriState: makeTomoriState(options),
    documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
    includeTimestamps: false,
    isUserImpersonation: false,
    triggererFormattedName: `User ${(options.messageCount ?? 5) - 1}`,
    uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
    convertMentions: async (text) => text,
  });
  return contextItems;
}

function itemText(item: { parts: Array<{ type: string; text?: string }> }): string {
  return item.parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

const NUDGE_PROBE = "write the tool call as exactly one Markdown inline code span or fenced code block";

function hasNudge(items: Awaited<ReturnType<typeof buildItems>>): boolean {
  return items.some((item) => itemText(item).includes(NUDGE_PROBE));
}

describe("appendDialogueHistoryContext — verbatim tool-calling nudge", () => {
  it("injects the nudge at depth 3 when the model opted in and tools are available", async () => {
    const items = await buildItems({ verbatimToolCalling: true, hasTools: true });
    const nudgeIndex = items.findIndex((item) => itemText(item).includes(NUDGE_PROBE));
    const messageTwoIndex = items.findIndex((item) => item.messageId === "message-2");

    expect(nudgeIndex).toBeGreaterThan(-1);
    expect(nudgeIndex).toBe(messageTwoIndex - 1);
  });

  it("does not inject the nudge when the model flag is off", async () => {
    expect(hasNudge(await buildItems({ verbatimToolCalling: false, hasTools: true }))).toBe(false);
  });

  it("does not inject the nudge when effective tools are disabled", async () => {
    expect(hasNudge(await buildItems({ verbatimToolCalling: true, hasTools: false }))).toBe(false);
  });

  it("does not inject the nudge for a non-custom provider that has native tool calling", async () => {
    expect(hasNudge(await buildItems({ verbatimToolCalling: true, hasTools: true, llmProvider: "openrouter" }))).toBe(
      false,
    );
  });
});

describe("shouldInjectVerbatimToolCallingNudge — per-attempt gating", () => {
  // This predicate gates base-context injection and the per-attempt adaptation in generationTurn, so
  // the fallback chain only carries verbatim scaffolding on the attempts that parse it.
  it("is true for a custom provider whose model opted in and has tools", () => {
    expect(shouldInjectVerbatimToolCallingNudge(makeTomoriState({ verbatimToolCalling: true, hasTools: true }))).toBe(
      true,
    );
  });

  it("matches a registered custom endpoint named custom:<connection_id>", () => {
    expect(
      shouldInjectVerbatimToolCallingNudge(
        makeTomoriState({ verbatimToolCalling: true, hasTools: true, llmProvider: "custom:7" }),
      ),
    ).toBe(true);
  });

  it("is false for a native tool-calling provider even with the flag on", () => {
    for (const llmProvider of ["google", "openrouter"]) {
      expect(
        shouldInjectVerbatimToolCallingNudge(
          makeTomoriState({ verbatimToolCalling: true, hasTools: true, llmProvider }),
        ),
      ).toBe(false);
    }
  });

  it("is false for a custom provider without tools, or with the flag off", () => {
    expect(shouldInjectVerbatimToolCallingNudge(makeTomoriState({ verbatimToolCalling: true, hasTools: false }))).toBe(
      false,
    );
    expect(shouldInjectVerbatimToolCallingNudge(makeTomoriState({ verbatimToolCalling: false, hasTools: true }))).toBe(
      false,
    );
  });

  it("is false when no state is available", () => {
    expect(shouldInjectVerbatimToolCallingNudge(null)).toBe(false);
    expect(shouldInjectVerbatimToolCallingNudge(undefined)).toBe(false);
  });
});
