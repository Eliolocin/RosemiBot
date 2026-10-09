import { describe, expect, it } from "bun:test";
import { buildOpenAICompatibleMessages } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import { applyAssistantPrefixCompletion } from "@/providers/utils/strictChatCompat";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  applyAssistantPrefill,
  foldPrefillIntoToolHistory,
  resolvePrefillBlocker,
  resolvePrefillMode,
  selectTurnPrefillText,
} from "@/utils/chat/assistantPrefill";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const userTurn: StructuredContextItem = {
  role: "user",
  parts: [{ type: "text", text: "Juno: list some fruit" }],
  metadataTag: ContextItemTag.DIALOGUE_HISTORY,
};

const plainIncoming = { isUserImpersonation: false };

describe("selectTurnPrefillText", () => {
  it("lets a /respond prefill replace the server prefill instead of joining it", () => {
    expect(selectTurnPrefillText({ ...plainIncoming, manualPrefill: "  Manual  " }, "Server")).toEqual({
      text: "Manual",
      source: "manual",
    });
    expect(selectTurnPrefillText(plainIncoming, "Server")).toEqual({ text: "Server", source: "server" });
    expect(selectTurnPrefillText(plainIncoming, "   ")).toBeNull();
  });

  it("keeps the server prefill out of turns that are not the persona answering the chat", () => {
    const skipped = [
      { isUserImpersonation: true },
      { isUserImpersonation: false, reasoningQuery: "why?" },
      { isUserImpersonation: false, reminderRecipientID: "42" },
      { isUserImpersonation: false, isStopResponse: true },
    ];
    for (const incoming of skipped) {
      expect(selectTurnPrefillText(incoming, "Server")).toBeNull();
    }
    expect(
      selectTurnPrefillText({ isUserImpersonation: false, reasoningQuery: "why?", manualPrefill: "M" }, "S"),
    ).toEqual({ text: "M", source: "manual" });
  });
});

describe("resolvePrefillBlocker", () => {
  it("degrades a model that cannot continue a prefill per source", () => {
    const sonnet = createLlmRow({ llm_provider: "anthropic", llm_codename: "claude-sonnet-4-6" });
    const blocker = resolvePrefillBlocker({ llm: sonnet, config: { thinking_level: "auto", tool_use_enabled: true } });
    expect(blocker).toBe("model");
    expect(resolvePrefillMode("manual", blocker)).toBe("instruction");
    expect(resolvePrefillMode("server", blocker)).toBe("skip");
  });

  it("treats NovelAI and prefix-completion providers as native without the column", () => {
    for (const provider of ["novelai", "deepseek", "zai"]) {
      const llm = createLlmRow({ llm_provider: provider, llm_codename: "m", has_tools: false });
      expect(resolvePrefillBlocker({ llm, config: { thinking_level: "auto", tool_use_enabled: true } })).toBeNull();
    }
    const prefixEndpoint = createLlmRow({ llm_provider: "custom", supports_prefix_completion: true });
    expect(
      resolvePrefillBlocker({ llm: prefixEndpoint, config: { thinking_level: "auto", tool_use_enabled: true } }),
    ).toBeNull();
  });

  it("only lets Gemini continue a prefill with thinking off or minimal", () => {
    const flashLite = createLlmRow({
      llm_provider: "google",
      llm_codename: "gemini-3.1-flash-lite",
      supports_assistant_prefill: true,
    });
    expect(
      resolvePrefillBlocker({ llm: flashLite, config: { thinking_level: "minimal", tool_use_enabled: true } }),
    ).toBeNull();
    expect(resolvePrefillBlocker({ llm: flashLite, config: { thinking_level: "low", tool_use_enabled: true } })).toBe(
      "thinking",
    );
    expect(resolvePrefillBlocker({ llm: flashLite, config: { thinking_level: "auto", tool_use_enabled: true } })).toBe(
      "thinking",
    );

    const flash25 = createLlmRow({
      llm_provider: "google",
      llm_codename: "gemini-2.5-flash",
      supports_assistant_prefill: true,
    });
    expect(
      resolvePrefillBlocker({ llm: flash25, config: { thinking_level: "none", tool_use_enabled: true } }),
    ).toBeNull();
    expect(resolvePrefillBlocker({ llm: flash25, config: { thinking_level: "auto", tool_use_enabled: true } })).toBe(
      "thinking",
    );
    // Reasoning mode lifts "none" to a real budget, which would leak thoughts as visible text.
    expect(
      resolvePrefillBlocker({ llm: flash25, config: { thinking_level: "none", tool_use_enabled: true } }, true),
    ).toBe("thinking");
  });

  // Regression: DeepSeek 400s "Function call should not be used with prefix" when a prefill turn
  // and tools share one request.
  it("blocks a DeepSeek prefill only while tools would ride along", () => {
    const llm = createLlmRow({ llm_provider: "deepseek", llm_codename: "deepseek-flash", has_tools: true });
    const blocker = resolvePrefillBlocker({ llm, config: { thinking_level: "auto", tool_use_enabled: true } });
    expect(blocker).toBe("tools");
    expect(resolvePrefillMode("server", blocker)).toBe("skip");
    expect(resolvePrefillMode("manual", blocker)).toBe("instruction");
    expect(resolvePrefillBlocker({ llm, config: { thinking_level: "auto", tool_use_enabled: false } })).toBeNull();
  });
});

describe("applyAssistantPrefill", () => {
  it("appends a trailing assistant turn for a model that continues it", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({
        llm_provider: "anthropic",
        llm_codename: "claude-haiku-4-5",
        supports_assistant_prefill: true,
      }),
    });
    const result = await applyAssistantPrefill({
      contextItems: [userTurn],
      prefill: { text: "Sure, here", source: "server" },
      tomoriState,
    });

    expect(result.outputPrefill).toBe("Mirri: Sure, here");
    expect(result.contextItems.at(-1)).toMatchObject({
      role: "model",
      parts: [{ type: "text", text: "Mirri: Sure, here" }],
    });
  });

  it("normalizes a prefill that already names the speaker instead of prefixing it twice", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({
        llm_provider: "anthropic",
        llm_codename: "claude-haiku-4-5",
        supports_assistant_prefill: true,
      }),
    });
    const prefillFor = async (text: string) =>
      (await applyAssistantPrefill({ contextItems: [userTurn], prefill: { text, source: "server" }, tomoriState }))
        .outputPrefill;

    expect(await prefillFor("Mirri: *sighs*")).toBe("Mirri: *sighs*");
    expect(await prefillFor("{bot}: *sighs*")).toBe("Mirri: *sighs*");
    expect(await prefillFor("Mirri (mad)： *sighs*")).toBe("Mirri (mad): *sighs*");
  });

  it("sends a manual prefill as an instruction, with no assistant turn, to a model that rejects one", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({ llm_provider: "anthropic", llm_codename: "claude-sonnet-4-6" }),
    });
    const result = await applyAssistantPrefill({
      contextItems: [userTurn],
      prefill: { text: "Sure, here", source: "manual" },
      tomoriState,
    });

    expect(result.outputPrefill).toBe("Mirri: Sure, here");
    expect(result.contextItems.some((item) => item.role === "model")).toBe(false);
    expect(result.contextItems.at(-1)?.role).toBe("user");
    expect(JSON.stringify(result.contextItems.at(-1)?.parts)).toContain("Mirri: Sure, here");
  });

  it("drops a server prefill for a model that rejects one and leaves nothing to strip", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({ llm_provider: "anthropic", llm_codename: "claude-sonnet-4-6" }),
    });
    const result = await applyAssistantPrefill({
      contextItems: [userTurn],
      prefill: { text: "Sure, here", source: "server" },
      tomoriState,
    });

    expect(result.contextItems).toEqual([userTurn]);
    expect(result.outputPrefill).toBeUndefined();
  });

  // Regression: the producer of `outputPrefill` was deleted while its readers stayed, so DeepSeek
  // received a bare trailing assistant turn without `prefix: true`.
  it("hands a prefix-completion provider an outputPrefill that stamps prefix on the built body", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({ llm_provider: "deepseek", llm_codename: "deepseek-chat", has_tools: false }),
    });
    const result = await applyAssistantPrefill({
      contextItems: [userTurn],
      prefill: { text: "Sure, here", source: "manual" },
      tomoriState,
    });
    expect(result.outputPrefill).toBeDefined();

    const requestBody: Record<string, unknown> = {
      messages: await buildOpenAICompatibleMessages({
        adapterName: "test",
        contextItems: result.contextItems,
        currentTurnModelParts: [],
      }),
    };
    applyAssistantPrefixCompletion(requestBody, result.outputPrefill, true);

    expect((requestBody.messages as Array<Record<string, unknown>>).at(-1)).toMatchObject({
      role: "assistant",
      content: "Mirri: Sure, here",
      prefix: true,
    });
  });
});

describe("foldPrefillIntoToolHistory", () => {
  // Regression: the prefill stayed as a trailing assistant turn into the tool continuation, so the
  // tool-call turn followed it as a second consecutive assistant turn and Gemini rejected the request.
  it("sends the prefill inside the tool-call turn so assistant turns never repeat", async () => {
    const tomoriState = createPersona({
      llm: createLlmRow({
        llm_provider: "anthropic",
        llm_codename: "claude-haiku-4-5",
        supports_assistant_prefill: true,
      }),
    });
    const prefilled = await applyAssistantPrefill({
      contextItems: [userTurn],
      prefill: { text: "Sure, here", source: "server" },
      tomoriState,
    });
    const history = [
      {
        functionCall: { name: "web_search", args: { query: "fruit" } },
        functionResponse: { status: "completed" },
        preToolCallTextParts: [{ type: "text", text: " are some fruit" }],
      },
    ];

    const request = foldPrefillIntoToolHistory(prefilled.contextItems, prefilled.outputPrefill, history);
    const messages = await buildOpenAICompatibleMessages({
      adapterName: "test",
      contextItems: request.contextItems,
      currentTurnModelParts: [],
      functionInteractionHistory: request.functionHistory,
    });

    const roles = messages.map((message) => message.role);
    expect(roles.some((role, index) => role === "assistant" && roles[index - 1] === "assistant")).toBe(false);
    expect(messages.find((message) => message.role === "assistant")?.content).toBe("Mirri: Sure, here are some fruit");
    // The key-rotation retry reruns the loop on the same context, which must still carry the prefill.
    expect(prefilled.contextItems.at(-1)?.role).toBe("model");
  });

  it("leaves the first request and instruction-mode prefills untouched", () => {
    const prefillTurn: StructuredContextItem = {
      role: "model",
      parts: [{ type: "text", text: "Mirri: Sure" }],
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    };
    const unchanged = foldPrefillIntoToolHistory([userTurn, prefillTurn], "Mirri: Sure", []);
    expect(unchanged.contextItems.at(-1)).toBe(prefillTurn);

    const history = [{ functionCall: { name: "web_search", args: {} }, functionResponse: {} }];
    const instruction = foldPrefillIntoToolHistory([userTurn], "Mirri: Sure", history);
    expect(instruction.functionHistory).toBe(history);
  });
});
