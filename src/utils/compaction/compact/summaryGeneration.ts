import { generateConversationSummaryForProvider } from "@/providers/utils/providerFeatureExecutors";
import type { CompactSummaryMode } from "@/types/misc/compact";
import { log } from "@/utils/misc/logger";
import type { TokenUsage } from "@/utils/text/tokenEstimate";
import type { ConversationContext } from "./types";

function buildConversationPrompt(params: {
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  systemPrompt: string;
}): { systemPrompt: string; userPrompt: string } {
  return buildPrompt({ ...params, finalInstruction: "\nPlease keep the summary under 3500 characters." });
}

function buildRoleplayPrompt(params: {
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  systemPrompt: string;
}): { systemPrompt: string; userPrompt: string } {
  return buildPrompt({ ...params });
}

export async function generateCompactSummary(params: {
  summaryType: CompactSummaryMode;
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  context: ConversationContext;
  supplementaryContext: string;
  systemPrompt: string;
  analyzeImages: boolean;
  onUsage?: (usage: TokenUsage) => void;
}) {
  const promptBuilder = params.summaryType === "conversation" ? buildConversationPrompt : buildRoleplayPrompt;
  const prompt = promptBuilder({
    conversationText: params.context.conversationText,
    imageReferences: params.context.imageReferences,
    supplementaryContext: params.supplementaryContext,
    systemPrompt: params.systemPrompt,
  });
  log.info(`[Compact] ${params.summaryType} system prompt:\n${prompt.systemPrompt}`);
  log.info(`[Compact] ${params.summaryType} user prompt:\n${prompt.userPrompt}`);

  const images = params.analyzeImages
    ? params.context.imageReferences.map((img) => ({ url: img.url, mimeType: img.mimeType }))
    : undefined;

  return await generateConversationSummaryForProvider({
    providerName: params.providerName,
    apiKey: params.apiKey,
    model: params.model,
    endpointUrl: params.endpointUrl,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    images,
    onUsage: params.onUsage,
  });
}

function buildPrompt(params: {
  systemPrompt: string;
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  finalInstruction?: string;
}): { systemPrompt: string; userPrompt: string } {
  const sections = ["MAIN CONTEXT (chronological):", params.conversationText || "(no recent messages)"];
  if (params.imageReferences.length > 0) {
    sections.push("\nIMAGE REFERENCES:", params.imageReferences.map((img) => `${img.label}: ${img.source}`).join("\n"));
  }
  if (params.supplementaryContext) sections.push("\nSUPPLEMENTARY CONTEXT:", params.supplementaryContext);
  if (params.finalInstruction) sections.push(params.finalInstruction);
  return { systemPrompt: params.systemPrompt, userPrompt: sections.join("\n") };
}
