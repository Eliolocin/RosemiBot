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
const RULE_TIMEOUT_MS = 30000;
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const integer = z.number().int().safe().nonnegative();
const analysisSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    band: z.enum(["clean", "light", "moderate", "heavy", "saturated"]),
    word_count: integer,
    violations: z
      .array(
        z
          .object({
            type: z.literal("Violation"),
            rule: identifier,
            match: z.string().max(1000),
            context: z.string().max(2000),
            penalty: z.number().int().safe(),
            start: integer,
            end: integer,
          })
          .strict(),
      )
      .max(64),
    counts: z.record(identifier, integer).refine((counts) => Object.keys(counts).length <= 64),
    total_penalty: z.number().int().safe(),
    weighted_sum: z.number().finite().nonnegative(),
    density: z.number().finite().nonnegative(),
    advice: z.array(z.string().max(1000)).max(64),
  })
  .strict();

export type RuleEvidence = z.infer<typeof analysisSchema> & {
  coverage: "short_text" | "unknown_profile_and_language";
  offsetConvention: "unicode_code_points";
  engineVersion: null;
  profileVersion: null;
};
export interface RuleCheckState {
  calls: number;
  cache?: { identity: string; connection: object; evidence: RuleEvidence };
}
export type RuleCheckOutcome =
  | { status: "disabled" | "exhausted" | "failed" | "cancelled" }
  | { status: "hits" | "clean" | "short_text"; evidence: RuleEvidence };

/** Slopguard's Python spans index Unicode code points, including best-effort structural spans. */
export function validateRuleAnalysis(payload: unknown, text: string): RuleEvidence {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_RULE_OUTPUT_BYTES) throw new Error("Rule output size");
  const parsed = analysisSchema.parse(payload);
  const length = Array.from(text).length;
  if (parsed.word_count > length || parsed.violations.some((hit) => hit.start > hit.end || hit.end > length))
    throw new Error("Rule output coverage or offsets");
  if (parsed.word_count < 10 && parsed.violations.length) throw new Error("Rule short-text coverage");
  return {
    ...parsed,
    coverage: parsed.word_count < 10 ? "short_text" : "unknown_profile_and_language",
    offsetConvention: "unicode_code_points",
    engineVersion: null,
    profileVersion: null,
  };
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
  const trace = (status: string, count = 0, reused = false, coverage = "unknown_profile_and_language") =>
    log.info(
      `Response rule check ${JSON.stringify({
        status,
        correlation,
        count,
        reused,
        calls: state.calls,
        elapsedMs: Date.now() - started,
        coverage,
        engineVersion: null,
        profileVersion: null,
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
            (row) => row.server_id === serverId && row.guild_mcp_id === reference.registrationId && row.is_enabled,
          )
        : undefined;
    const tool = config ? await bounded(guild.getRegisteredTool(config, true)) : null;
    signal.throwIfAborted();
    if (!tool || !(await bounded(tool.tool())).functionDeclarations?.some(isCompatibleRuleChecker))
      throw new Error("Rule binding unavailable");
    signal.throwIfAborted();
    const identity = createHash("sha256")
      .update(JSON.stringify([reference, config?.url, text]))
      .digest("hex");
    // The standard server loads its profile at startup. A replacement connection invalidates reuse.
    let evidence =
      state.cache?.identity === identity && state.cache.connection === tool ? state.cache.evidence : undefined;
    const reused = Boolean(evidence);
    if (!evidence) {
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
              row.name === config?.name &&
              row.url === config.url,
          )
        )
          throw new Error("Rule registration changed");
      }
      signal.throwIfAborted();
      const raw = config ? await bounded(guild.callInternalRuleChecker(config, text, signal)) : null;
      signal.throwIfAborted();
      stage = "validation";
      const envelope = z
        .object({
          isError: z.boolean().optional(),
          structuredContent: z.unknown().optional(),
          content: z
            .array(z.object({ type: z.literal("text"), text: z.string().max(MAX_RULE_OUTPUT_BYTES) }).strict())
            .max(1),
        })
        .passthrough()
        .parse(raw);
      if (envelope.isError) throw new Error("Rule tool failure");
      if (Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_RULE_OUTPUT_BYTES) throw new Error("Rule envelope size");
      const payload = envelope.structuredContent ?? JSON.parse(envelope.content[0]?.text ?? "");
      evidence = validateRuleAnalysis(payload, text);
      state.cache = { identity, connection: tool, evidence };
    }
    const status = evidence.coverage === "short_text" ? "short_text" : evidence.violations.length ? "hits" : "clean";
    trace(status, evidence.violations.length, reused, evidence.coverage);
    return { status, evidence };
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
