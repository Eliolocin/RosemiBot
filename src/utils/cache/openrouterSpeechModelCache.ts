import { z } from "zod";
import { createOpenRouterCatalog, normalizeOpenRouterCodename } from "@/utils/cache/openrouterCatalog";
import { readBoundedResponse } from "@/utils/security/boundedResponse";

const admittedModels = new Set(["fish-audio/s2.1-pro", "fish-audio/s2.1-pro-free:free"]);
const modelListSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });
const endpointsSchema = z.object({
  data: z.object({ endpoints: z.array(z.object({ supports_voice_cloning: z.boolean().optional() })) }),
});

export function parseOpenRouterSpeechModelList(payload: unknown): { id: string }[] {
  return modelListSchema
    .parse(payload)
    .data.map(({ id }) => ({ id: normalizeOpenRouterCodename(id) }))
    .filter(({ id }) => admittedModels.has(id));
}

let catalogRevision = 0;
const speechCatalog = createOpenRouterCatalog({
  label: "speech",
  url: "https://openrouter.ai/api/v1/models?output_modalities=speech",
  parse: (payload) => {
    const models = parseOpenRouterSpeechModelList(payload);
    if (models.length === 0) throw new Error("OpenRouter speech catalogue contains no admitted models");
    catalogRevision += 1;
    return models;
  },
  keyOf: (entry) => entry.id,
});

export async function validateOpenRouterSpeechModel(codename: string): Promise<boolean> {
  const normalized = normalizeOpenRouterCodename(codename);
  if (!admittedModels.has(normalized)) return false;
  try {
    const revision = catalogRevision;
    const model = await speechCatalog.getOrFetch(normalized, { fresh: true });
    if (!model || revision === catalogRevision) return false;
    const response = await fetch(`https://openrouter.ai/api/v1/models/${normalized}/endpoints`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return false;
    }
    const parsed = endpointsSchema.safeParse(
      JSON.parse((await readBoundedResponse(response, 1024 * 1024)).toString("utf8")),
    );
    return parsed.success && parsed.data.data.endpoints.some((endpoint) => endpoint.supports_voice_cloning === true);
  } catch {
    return false;
  }
}
