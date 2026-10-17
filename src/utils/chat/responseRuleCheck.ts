import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ResponseRuleCheckerRef } from "@/types/db/schema";
import { mcpRepository } from "@/utils/db/repositories";
import { isCompatibleRuleChecker } from "@/utils/discord/interactions/responseDraftingOperations";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { log } from "@/utils/misc/logger";

const MAX_RULE_CALLS = 2;
const MAX_RULE_INPUT_BYTES = 96000;
const MAX_RULE_OUTPUT_BYTES = 32768;
const MAX_RULE_TEXT_PARTS = 8;
const RULE_TIMEOUT_MS = 30000;

/** Any linter's own output, passed to the reviewer as untrusted advisory evidence. */
export type RuleReport = unknown;
export interface RuleCheckState {
  calls: number;
  cache?: { identity: string; connection: object; report: RuleReport | null };
}
export type RuleCheckOutcome =
  | { status: "disabled" | "exhausted" | "failed" | "cancelled" | "clean" }
  | { status: "report"; evidence: RuleReport };

/** Linters differ in output shape, so a report is structured content, JSON text, or plain text. */
export function parseRuleReport(raw: unknown): RuleReport | null {
  const envelope = z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      content: z
        .array(z.object({ type: z.literal("text"), text: z.string().max(MAX_RULE_OUTPUT_BYTES) }).passthrough())
        .max(MAX_RULE_TEXT_PARTS),
    })
    .passthrough()
    .parse(raw);
  if (envelope.isError) throw new Error("Rule tool failure");
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_RULE_OUTPUT_BYTES) throw new Error("Rule envelope size");
  if (envelope.structuredContent !== undefined) return envelope.structuredContent;
  const text = envelope.content
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function checkResponseRules(
  serverId: number,
  reference: ResponseRuleCheckerRef | null,
  text: string,
  state: RuleCheckState,
  turnSignal: AbortSignal,
): Promise<RuleCheckOutcome> {
  const started = Date.now();
  const correlation = randomUUID();
  const trace = (status: string, reused = false) =>
    log.info(
      `Response rule check ${JSON.stringify({
        status,
        correlation,
        reused,
        calls: state.calls,
        elapsedMs: Date.now() - started,
      })}`,
    );
  if (!reference) {
    trace("disabled");
    return { status: "disabled" };
  }
  const timeout = AbortSignal.timeout(RULE_TIMEOUT_MS);
  const signal = AbortSignal.any([turnSignal, timeout]);
  const bounded = async <T>(work: Promise<T>): Promise<T> => {
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error("Rule operation aborted"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  };
  let stage = "binding";
  let errorLogged = false;
  try {
    signal.throwIfAborted();
    if (Buffer.byteLength(text, "utf8") > MAX_RULE_INPUT_BYTES) throw new Error("Rule input size");
    const guild = getGuildMcpManager();
    const registration =
      reference.scope === "workspace" ? await bounded(mcpRepository.loadGuildMcpConfigsResult(serverId)) : null;
    errorLogged = registration?.status === "unavailable";
    const config =
      reference.scope === "workspace" && registration?.status === "fresh"
        ? registration.configs.find(
            (row) =>
              row.server_id === serverId &&
              row.guild_mcp_id === reference.registrationId &&
              row.is_enabled &&
              row.server_type === "prose_linter",
          )
        : undefined;
    // Report "disabled" rather than "failed" because a disabled or removed linter is an operator choice, and "failed" would force review and log an error every turn.
    if (registration?.status === "fresh" && !config) {
      trace("unbound");
      return { status: "disabled" };
    }
    const tool = config ? await bounded(guild.getRegisteredTool(config, true)) : null;
    signal.throwIfAborted();
    if (
      !tool ||
      !(await bounded(tool.tool())).functionDeclarations?.some(
        (declaration) => declaration.name === reference.toolName && isCompatibleRuleChecker(declaration),
      )
    )
      throw new Error("Rule binding unavailable");
    signal.throwIfAborted();
    const identity = createHash("sha256")
      .update(JSON.stringify([reference, config?.url, text]))
      .digest("hex");
    // A replacement connection may serve a different rule configuration, so it invalidates reuse.
    const cached = state.cache?.identity === identity && state.cache.connection === tool ? state.cache : undefined;
    let report = cached?.report;
    if (!cached) {
      if (state.calls >= MAX_RULE_CALLS) {
        trace("exhausted");
        return { status: "exhausted" };
      }
      state.calls++;
      stage = "execution";
      if (reference.scope === "workspace") {
        const fresh = await bounded(mcpRepository.loadGuildMcpConfigsResult(serverId));
        errorLogged = fresh.status === "unavailable";
        if (
          fresh.status !== "fresh" ||
          !fresh.configs.some(
            (row) =>
              row.server_id === serverId &&
              row.guild_mcp_id === reference.registrationId &&
              row.is_enabled &&
              row.server_type === "prose_linter" &&
              row.name === config?.name &&
              row.url === config.url,
          )
        )
          throw new Error("Rule registration changed");
      }
      signal.throwIfAborted();
      const raw = config
        ? await bounded(guild.callInternalRuleChecker(config, reference.toolName, text, signal))
        : null;
      signal.throwIfAborted();
      stage = "validation";
      report = parseRuleReport(raw);
      state.cache = { identity, connection: tool, report };
    }
    if (report === null || report === undefined) {
      trace("clean", Boolean(cached));
      return { status: "clean" };
    }
    trace("report", Boolean(cached));
    return { status: "report", evidence: report };
  } catch {
    if (turnSignal.aborted) {
      trace("cancelled");
      return { status: "cancelled" };
    }
    if (!errorLogged)
      await log.error("Response rule check failed", new Error("Configured rule checker operation failed"), {
        errorType: "ResponseRuleCheckError",
        metadata: {
          operation: "response-rule-check",
          correlation,
          stage,
          category: timeout.aborted ? "timeout" : "operation",
          scope: reference.scope,
          elapsedMs: Date.now() - started,
        },
      });
    trace("failed");
    return { status: "failed" };
  }
}
