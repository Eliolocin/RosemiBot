import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import { Type, type CallableTool } from "@google/genai";
import type { GuildMcpServerRow } from "@/types/db/schema";
import { checkResponseRules, parseRuleReport, type RuleCheckState } from "@/utils/chat/responseRuleCheck";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { mcpRepository } from "@/utils/db/repositories";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { log } from "@/utils/misc/logger";

const prose = "🦊 A quiet character waits by the door while the rain falls outside.";
const analysis = () => ({
  score: 80,
  band: "light",
  word_count: 14,
  violations: [
    {
      type: "Violation",
      rule: "slop_phrase",
      match: "PRIVATE_SNIPPET",
      context: "PRIVATE_CONTEXT",
      penalty: 3,
      start: 2,
      end: 7,
    },
  ],
  counts: { slop_phrases: 1 },
  total_penalty: 3,
  weighted_sum: 3,
  density: 0.2,
  advice: ["PRIVATE_ADVICE"],
});
const checker: CallableTool = {
  tool: async () => ({
    functionDeclarations: [
      {
        name: "lint_reply",
        parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING } }, required: ["text"] },
      },
    ],
  }),
  callTool: async () => {
    throw new Error("Author route must not run");
  },
};
const row: GuildMcpServerRow = {
  server_id: 42,
  guild_mcp_id: 7,
  name: "fixture-checker",
  url: "https://example.com/mcp",
  key_version: 1,
  is_enabled: true,
  server_type: "prose_linter",
  last_discovered_tool_names: ["lint_reply"],
};
const reference = { scope: "workspace", registrationId: 7, toolName: "lint_reply" } as const;

describe("optional response rule evidence", () => {
  const guild = getGuildMcpManager();
  const realDiscovery = guild.getRegisteredTool.bind(guild);
  const registration = spyOn(mcpRepository, "loadGuildMcpConfigsResult").mockResolvedValue({
    status: "fresh",
    configs: [row],
  });
  const discovery = spyOn(guild, "getRegisteredTool").mockResolvedValue(checker);
  const invoke = spyOn(guild, "callInternalRuleChecker").mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(analysis()) }],
  });
  const errors = spyOn(log, "error").mockImplementation(async () => {});
  const info = spyOn(log, "info").mockImplementation(() => {});
  afterEach(() => {
    registration.mockResolvedValue({ status: "fresh", configs: [row] });
    discovery.mockResolvedValue(checker);
    invoke.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify(analysis()) }] });
    for (const spy of [registration, discovery, invoke, errors, info]) spy.mockClear();
  });
  afterAll(() => {
    for (const spy of [registration, discovery, invoke, errors, info]) spy.mockRestore();
  });

  it("accepts structured, JSON text or plain text reports and rejects tool errors, media and oversize output", () => {
    expect(parseRuleReport({ content: [], structuredContent: analysis() })).toEqual(analysis());
    expect(parseRuleReport({ content: [{ type: "text", text: JSON.stringify(analysis()) }] })).toEqual(analysis());
    expect(parseRuleReport({ content: [{ type: "text", text: "Line 1: hedge word" }] })).toBe("Line 1: hedge word");
    expect(parseRuleReport({ content: [{ type: "text", text: "  " }] })).toBeNull();
    for (const raw of [
      { isError: true, content: [{ type: "text", text: "PRIVATE_FAILURE" }] },
      { content: [{ type: "image", data: "", mimeType: "image/png" }] },
      { content: [{ type: "text", text: "x".repeat(40000) }] },
      { content: Array.from({ length: 9 }, () => ({ type: "text", text: "x" })) },
    ])
      expect(() => parseRuleReport(raw)).toThrow();
  });

  it("reuses exact text on the same connection and bounds changed candidates to two calls", async () => {
    const state: RuleCheckState = { calls: 0 };
    const signal = new AbortController().signal;
    expect((await checkResponseRules(42, null, prose, state, signal)).status).toBe("disabled");
    expect((await checkResponseRules(42, reference, prose, state, signal)).status).toBe("report");
    expect((await checkResponseRules(42, reference, prose, state, signal)).status).toBe("report");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.slice(1, 3)).toEqual(["lint_reply", prose]);
    await checkResponseRules(42, reference, `${prose} Again.`, state, signal);
    expect((await checkResponseRules(42, reference, `${prose} Finally.`, state, signal)).status).toBe("exhausted");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_");
    expect(errors).not.toHaveBeenCalled();
  });

  it("treats a foreign, disabled, removed or retyped registration as no checker, even for cached text", async () => {
    const state: RuleCheckState = { calls: 0 };
    const signal = new AbortController().signal;
    await checkResponseRules(42, reference, prose, state, signal);
    for (const configs of [
      [],
      [{ ...row, server_id: 99 }],
      [{ ...row, is_enabled: false }],
      [{ ...row, guild_mcp_id: 8 }],
      [{ ...row, server_type: null }],
    ]) {
      registration.mockResolvedValue({ status: "fresh", configs });
      expect((await checkResponseRules(42, reference, prose, state, signal)).status).toBe("disabled");
    }
    expect(discovery).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });

  it("detects removal during discovery and invalidates reuse after connection replacement", async () => {
    const signal = new AbortController().signal;
    const state: RuleCheckState = { calls: 0 };
    await checkResponseRules(42, reference, prose, state, signal);
    discovery.mockResolvedValue({ ...checker });
    await checkResponseRules(42, reference, prose, state, signal);
    expect(invoke).toHaveBeenCalledTimes(2);
    registration
      .mockResolvedValueOnce({ status: "fresh", configs: [row] })
      .mockResolvedValueOnce({ status: "fresh", configs: [] });
    expect((await checkResponseRules(42, reference, prose, { calls: 0 }, signal)).status).toBe("failed");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("reports transport and malformed checker errors once without private payloads", async () => {
    for (const raw of [
      { isError: true, content: [{ type: "text", text: "PRIVATE_FAILURE" }] },
      { content: [{ type: "image", data: "PRIVATE_MEDIA", mimeType: "image/png" }] },
    ]) {
      invoke.mockResolvedValue(raw);
      expect((await checkResponseRules(42, reference, prose, { calls: 0 }, new AbortController().signal)).status).toBe(
        "failed",
      );
    }
    invoke.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    await checkResponseRules(42, reference, prose, { calls: 0 }, new AbortController().signal);
    expect(errors).toHaveBeenCalledTimes(3);
    expect(JSON.stringify([errors.mock.calls, info.mock.calls])).not.toContain("PRIVATE_");
  });

  it("preserves an already reported repository failure and normalizes private connection failures at one owner", async () => {
    registration.mockResolvedValue({ status: "unavailable", configs: [] });
    expect((await checkResponseRules(42, reference, prose, { calls: 0 }, new AbortController().signal)).status).toBe(
      "failed",
    );
    expect(errors).not.toHaveBeenCalled();
    registration.mockResolvedValue({ status: "fresh", configs: [row] });
    discovery.mockImplementation(realDiscovery);
    const decrypt = spyOn(toolRepository, "decryptMcpAuthToken").mockRejectedValue(
      new Error("PRIVATE_CREDENTIAL_FAILURE"),
    );
    const failureStreak = spyOn(toolRepository, "recordMcpConnectFailure").mockResolvedValue({
      status: "failing",
      failingSince: new Date(),
    });
    try {
      expect((await checkResponseRules(42, reference, prose, { calls: 0 }, new AbortController().signal)).status).toBe(
        "failed",
      );
      expect(errors).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([errors.mock.calls, info.mock.calls])).not.toContain("PRIVATE_");
    } finally {
      decrypt.mockRestore();
      failureStreak.mockRestore();
    }
  });

  it("cancels hung discovery or execution, discards late results and logs no operational error", async () => {
    for (const stage of ["discovery", "execution"]) {
      const controller = new AbortController();
      if (stage === "discovery")
        discovery.mockImplementation(async () => {
          controller.abort();
          return new Promise(() => {});
        });
      else {
        discovery.mockResolvedValue(checker);
        invoke.mockImplementation(async (_row, _tool, _text, signal) => {
          controller.abort();
          expect(signal.aborted).toBe(true);
          return new Promise(() => {});
        });
      }
      expect((await checkResponseRules(42, reference, prose, { calls: 0 }, controller.signal)).status).toBe(
        "cancelled",
      );
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("reports a saved bot-wide checker as failed without calling any service", async () => {
    expect(
      (
        await checkResponseRules(
          42,
          { scope: "global", serviceName: "fixture", toolName: "check_slop" },
          prose,
          { calls: 0 },
          new AbortController().signal,
        )
      ).status,
    ).toBe("failed");
    expect(discovery).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("bounds a stalled checker deadline separately from turn cancellation", async () => {
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    discovery.mockImplementation(async () => new Promise(() => {}));
    try {
      expect((await checkResponseRules(42, reference, prose, { calls: 0 }, new AbortController().signal)).status).toBe(
        "failed",
      );
      expect(invoke).not.toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
});
