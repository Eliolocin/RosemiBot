import { z } from "zod";
import { log } from "@/utils/misc/logger";
import type { CallableTool } from "@google/genai";
import { createHash } from "node:crypto";
import type { FunctionDeclaration } from "@google/genai";
import {
  responseRuleCheckerRefSchema,
  responseReviewerPromptSchema,
  type ResponseRuleCheckerRef,
  type ServerChatConfigRow,
  type TomoriState,
} from "@/types/db/schema";
import { configRepository, llmModelRepo, mcpRepository } from "@/utils/db/repositories";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import {
  loadConfigModelProviders,
  loadConfigModelChoices,
  type ConfigModelChoice,
} from "@/utils/discord/interactions/configModelOperations";
import type { DraftModelSlot } from "@/utils/discord/configPanelCatalog";
import { getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { localizer, resolveDescription } from "@/utils/text/localizer";

export interface DraftCheckerChoice {
  reference: ResponseRuleCheckerRef;
  label: string;
}
export interface DraftModelGroup {
  provider: string;
  models: ConfigModelChoice[];
}
export interface ResponseDraftingView {
  reviewers: DraftModelGroup[];
  decisions: DraftModelGroup[];
  checkers: DraftCheckerChoice[];
  inheritedReviewerAvailable: boolean;
}

const checkerInputSchema = z.object({
  type: z.string(),
  properties: z.object({ text: z.object({ type: z.string() }) }),
  required: z.array(z.string()),
});

export function isCompatibleRuleChecker(declaration: FunctionDeclaration): boolean {
  if (declaration.name !== "check_slop") return false;
  const parsed = checkerInputSchema.safeParse(declaration.parametersJsonSchema ?? declaration.parameters);
  return (
    parsed.success &&
    parsed.data.type.toLowerCase() === "object" &&
    parsed.data.properties.text.type.toLowerCase() === "string" &&
    parsed.data.required.includes("text") &&
    parsed.data.required.every((name) => name === "text")
  );
}

async function hasCompatibleChecker(tool: CallableTool | null, serverId: number): Promise<boolean> {
  if (!tool) return false;
  try {
    return (await tool.tool()).functionDeclarations?.some(isCompatibleRuleChecker) ?? false;
  } catch {
    await log.error("Failed to read rule checker schema", new Error("MCP schema read failed"), {
      errorType: "MCPError",
      metadata: { serverId },
    });
    return false;
  }
}

export function checkerFingerprint(choices: readonly DraftCheckerChoice[]): string {
  return createHash("sha256")
    .update(JSON.stringify(choices.map((choice) => choice.reference)))
    .digest("base64url")
    .slice(0, 8);
}

export async function loadDraftingModelGroups(
  serverId: number,
  slot: DraftModelSlot,
  locale: string,
): Promise<DraftModelGroup[]> {
  if (slot === "decision") {
    const options = await llmModelRepo.loadDecisionModelOptions({ kind: "server", ownerId: serverId });
    const groups = new Map<string, ConfigModelChoice[]>();
    for (const { model } of options) {
      const models = groups.get(model.provider) ?? [];
      models.push({
        id: model.decision_model_id,
        name: model.codename,
        description: resolveDescription(model.descriptions, locale),
      });
      groups.set(model.provider, models);
    }
    return [...groups].map(([provider, models]) => ({ provider, models }));
  }
  const providers = await loadConfigModelProviders(serverId, "text");
  const groups = await Promise.all(
    providers.map(async ({ provider }) => {
      if (!isCustomProvider(provider) && !getStaticProviderInfo(provider)?.featureSupport.structuredOutput)
        return { provider, models: [] };
      const models = await loadConfigModelChoices(
        serverId,
        "text",
        provider,
        locale,
        (model) => model.supports_structoutput,
      );
      return { provider, models };
    }),
  );
  return groups.filter((group) => group.models.length > 0);
}

export async function loadDraftCheckerChoices(serverId: number): Promise<DraftCheckerChoice[]> {
  const choices: DraftCheckerChoice[] = [];
  const read = await mcpRepository.loadGuildMcpConfigsResult(serverId);
  if (read.status !== "fresh") return choices;
  const guildManager = getGuildMcpManager();
  for (const config of read.configs) {
    if (!config.is_enabled || !config.guild_mcp_id || !config.last_discovered_tool_names?.includes("check_slop"))
      continue;
    const tool = await guildManager.getRegisteredTool(config);
    if (await hasCompatibleChecker(tool, serverId)) {
      choices.push({
        reference: { scope: "workspace", registrationId: config.guild_mcp_id, toolName: "check_slop" },
        label: config.name,
      });
    }
  }
  return choices;
}

export async function loadResponseDraftingView(state: TomoriState, locale: string): Promise<ResponseDraftingView> {
  const [reviewers, decisions, checkers] = await Promise.all([
    loadDraftingModelGroups(state.server_id, "reviewer", locale),
    loadDraftingModelGroups(state.server_id, "decision", locale),
    loadDraftCheckerChoices(state.server_id),
  ]);
  return {
    reviewers,
    decisions,
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
  setModel(
    state: TomoriState,
    workspaceId: string,
    slot: DraftModelSlot,
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
  async setModel(state, workspaceId, slot, provider, modelId) {
    if (modelId !== null) {
      const groups = await loadDraftingModelGroups(state.server_id, slot, "en-US");
      if (!groups.some((group) => group.provider === provider && group.models.some((model) => model.id === modelId)))
        return "stale";
    }
    return writeChat(
      state,
      workspaceId,
      slot === "reviewer" ? { response_reviewer_llm_id: modelId } : { response_decision_model_id: modelId },
    );
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
    const reviewers = await loadDraftingModelGroups(serverId, "reviewer", "en-US");
    if (!reviewers.some((group) => group.models.some((model) => model.id === patch.response_reviewer_llm_id)))
      return false;
  }
  if (patch.response_decision_model_id != null) {
    const decisions = await loadDraftingModelGroups(serverId, "decision", "en-US");
    if (!decisions.some((group) => group.models.some((model) => model.id === patch.response_decision_model_id)))
      return false;
  }
  if (patch.response_rule_checker_ref != null) {
    const choices = await loadDraftCheckerChoices(serverId);
    if (!choices.some((choice) => JSON.stringify(choice.reference) === JSON.stringify(patch.response_rule_checker_ref)))
      return false;
  }
  return true;
}
