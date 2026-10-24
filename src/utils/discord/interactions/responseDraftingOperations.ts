import type { ResponseReviewItem } from "@/constants/responseReview";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import type { CallableTool } from "@google/genai";
import { createHash } from "node:crypto";
import type { FunctionDeclaration } from "@google/genai";
import {
  responseReviewItemsSchema,
  responseRuleCheckerRefSchema,
  responseReviewerPromptSchema,
  type ResponseRuleCheckerRef,
  type ServerChatConfigRow,
  type TomoriState,
} from "@/types/db/schema";
import { configRepository, mcpRepository } from "@/utils/db/repositories";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import {
  loadStructuredOutputModelGroups,
  type StructuredOutputModelGroup,
} from "@/utils/discord/interactions/configModelOperations";
import { claimProviderModelSelection, clearProviderModelSelection } from "@/utils/provider/providerOptionRegistry";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { localizer } from "@/utils/text/localizer";

export interface DraftCheckerChoice {
  reference: ResponseRuleCheckerRef;
  label: string;
}
export interface ResponseDraftingView {
  reviewers: StructuredOutputModelGroup[];
  checkers: DraftCheckerChoice[];
  inheritedReviewerAvailable: boolean;
}

const checkerInputSchema = z.object({
  type: z.string(),
  properties: z.object({ text: z.object({ type: z.string() }) }),
  required: z.array(z.string()),
});

/** The checker is called with the draft alone, so `text` must be its only required input. */
export function isCompatibleRuleChecker(declaration: FunctionDeclaration): boolean {
  if (!declaration.name) return false;
  const parsed = checkerInputSchema.safeParse(declaration.parametersJsonSchema ?? declaration.parameters);
  return (
    parsed.success &&
    parsed.data.type.toLowerCase() === "object" &&
    parsed.data.properties.text.type.toLowerCase() === "string" &&
    parsed.data.required.includes("text") &&
    parsed.data.required.every((name) => name === "text")
  );
}

async function compatibleCheckerNames(tool: CallableTool | null, serverId: number): Promise<string[]> {
  if (!tool) return [];
  try {
    return ((await tool.tool()).functionDeclarations ?? [])
      .filter(isCompatibleRuleChecker)
      .map((declaration) => declaration.name as string);
  } catch {
    await log.error("Failed to read rule checker schema", new Error("MCP schema read failed"), {
      errorType: "MCPError",
      metadata: { serverId },
    });
    return [];
  }
}

export function checkerFingerprint(choices: readonly DraftCheckerChoice[]): string {
  return createHash("sha256")
    .update(JSON.stringify(choices.map((choice) => choice.reference)))
    .digest("base64url")
    .slice(0, 8);
}

export async function loadDraftCheckerChoices(serverId: number): Promise<DraftCheckerChoice[]> {
  const choices: DraftCheckerChoice[] = [];
  const read = await mcpRepository.loadGuildMcpConfigsResult(serverId);
  if (read.status !== "fresh") return choices;
  const guildManager = getGuildMcpManager();
  for (const config of read.configs) {
    if (!config.is_enabled || !config.guild_mcp_id || config.server_type !== "prose_linter") continue;
    const registrationId = config.guild_mcp_id;
    const tool = await guildManager.getRegisteredTool(config);
    for (const toolName of await compatibleCheckerNames(tool, serverId))
      choices.push({
        reference: { scope: "workspace", registrationId, toolName },
        label: `${config.name} / ${toolName}`,
      });
  }
  return choices;
}

export async function loadResponseDraftingView(state: TomoriState, locale: string): Promise<ResponseDraftingView> {
  const [reviewers, checkers] = await Promise.all([
    loadStructuredOutputModelGroups(state.server_id, locale),
    loadDraftCheckerChoices(state.server_id),
  ]);
  return {
    reviewers,
    checkers,
    inheritedReviewerAvailable: reviewers.some((group) => group.models.some((model) => model.id === state.llm.llm_id)),
  };
}

export function effectiveReviewerPrompt(state: TomoriState, locale: string): string {
  return state.config.response_reviewer_prompt ?? localizer(locale, "commands.config.drafting.default_prompt");
}

export type DraftWriteResult = "success" | "stale" | "invalid" | "write-failed";
export interface ResponseDraftingOperations {
  setEnabled(state: TomoriState, workspaceId: string, enabled: boolean): Promise<DraftWriteResult>;
  setReviewItems(state: TomoriState, workspaceId: string, items: ResponseReviewItem[]): Promise<DraftWriteResult>;
  setModel(
    state: TomoriState,
    workspaceId: string,
    provider: string,
    modelId: number | null,
  ): Promise<DraftWriteResult>;
  setPrompt(state: TomoriState, workspaceId: string, prompt: string | null): Promise<DraftWriteResult>;
  setChecker(
    state: TomoriState,
    workspaceId: string,
    reference: ResponseRuleCheckerRef | null,
  ): Promise<DraftWriteResult>;
}

async function writeChat(
  state: TomoriState,
  workspaceId: string,
  patch: Partial<ServerChatConfigRow>,
): Promise<DraftWriteResult> {
  if (!(await configRepository.updateChatConfig(state.server_id, patch))) return "write-failed";
  invalidateTomoriStateCache(workspaceId);
  return "success";
}

export const responseDraftingOperations: ResponseDraftingOperations = {
  async setEnabled(state, workspaceId, enabled) {
    if (!(await configRepository.updateCapabilitiesConfig(state.server_id, { response_drafting_enabled: enabled })))
      return "write-failed";
    invalidateTomoriStateCache(workspaceId);
    return "success";
  },
  setReviewItems(state, workspaceId, items) {
    const parsed = responseReviewItemsSchema.safeParse(items);
    if (!parsed.success) return Promise.resolve("invalid");
    return writeChat(state, workspaceId, { response_review_items: parsed.data });
  },
  async setModel(state, workspaceId, provider, modelId) {
    if (modelId !== null) {
      const groups = await loadStructuredOutputModelGroups(state.server_id, "en-US");
      if (!groups.some((group) => group.provider === provider && group.models.some((model) => model.id === modelId)))
        return "stale";
    }
    const written = await writeChat(state, workspaceId, { response_reviewer_llm_id: modelId });
    if (written !== "success") return written;
    const scope = { kind: "server" as const, ownerId: state.server_id, state };
    if (modelId === null) {
      const cleared = await clearProviderModelSelection({ scope, capability: "reviewer" });
      return cleared ? "success" : "write-failed";
    }
    const claimed = await claimProviderModelSelection({ scope, provider, capability: "reviewer" });
    return claimed ? "success" : "write-failed";
  },
  async setPrompt(state, workspaceId, prompt) {
    if (prompt !== null && !responseReviewerPromptSchema.safeParse(prompt).success) return "invalid";
    return writeChat(state, workspaceId, { response_reviewer_prompt: prompt });
  },
  async setChecker(state, workspaceId, reference) {
    if (reference !== null) {
      const parsed = responseRuleCheckerRefSchema.safeParse(reference);
      if (!parsed.success) return "invalid";
      const choices = await loadDraftCheckerChoices(state.server_id);
      if (!choices.some((choice) => JSON.stringify(choice.reference) === JSON.stringify(parsed.data))) return "stale";
      reference = parsed.data;
    }
    return writeChat(state, workspaceId, { response_rule_checker_ref: reference });
  },
};

export async function validateDraftingImportReferences(
  serverId: number,
  patch: Partial<ServerChatConfigRow>,
): Promise<boolean> {
  if (patch.response_reviewer_llm_id != null) {
    const reviewers = await loadStructuredOutputModelGroups(serverId, "en-US");
    if (!reviewers.some((group) => group.models.some((model) => model.id === patch.response_reviewer_llm_id)))
      return false;
  }
  if (patch.response_rule_checker_ref != null) {
    const choices = await loadDraftCheckerChoices(serverId);
    if (!choices.some((choice) => JSON.stringify(choice.reference) === JSON.stringify(patch.response_rule_checker_ref)))
      return false;
  }
  return true;
}
