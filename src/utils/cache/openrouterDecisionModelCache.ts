import { z } from "zod";
import { createOpenRouterCatalog } from "@/utils/cache/openrouterCatalog";

const catalogEntrySchema = z.object({
  id: z.string().min(1).max(200),
  context_length: z.number().int().min(512).max(10_000_000),
  architecture: z.object({
    input_modalities: z.array(z.string()).refine((values) => values.includes("text")),
    output_modalities: z.array(z.string()).refine((values) => values.includes("decisions")),
  }),
  pricing: z.object({
    prompt: z.string().min(1).transform(Number).pipe(z.number().finite().nonnegative()),
    completion: z.string().min(1).transform(Number).pipe(z.number().finite().nonnegative()),
  }),
});

export function parseOpenRouterDecisionModelList(payload: unknown) {
  const envelope = z.object({ data: z.array(z.unknown()) }).parse(payload);
  return envelope.data.flatMap((entry) => {
    const result = catalogEntrySchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
}

const decisionCatalog = createOpenRouterCatalog({
  label: "decision",
  url: "https://openrouter.ai/api/v1/models?output_modalities=decisions",
  parse: parseOpenRouterDecisionModelList,
  keyOf: (entry) => entry.id,
});

export const getOrFetchOpenRouterDecisionModel = decisionCatalog.getOrFetch;
