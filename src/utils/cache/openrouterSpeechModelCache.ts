import { z } from "zod";
import { findOpenRouterSpeechModel } from "@/providers/openrouter/openrouterSpeechModels";
import { createOpenRouterCatalog, normalizeOpenRouterCodename } from "@/utils/cache/openrouterCatalog";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import type { VoiceSourceMode } from "@/utils/speech/voiceSourceCapabilities";

const modelListSchema = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });
const endpointsSchema = z.object({
  data: z.object({ endpoints: z.array(z.object({ supports_voice_cloning: z.boolean().optional() })) }),
});

export function parseOpenRouterSpeechModelList(payload: unknown): { id: string }[] {
  return modelListSchema
    .parse(payload)
    .data.map(({ id }) => ({ id: normalizeOpenRouterCodename(id) }))
    .filter(({ id }) => findOpenRouterSpeechModel(id) !== null);
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

/**
 * Rechecks an admitted model against the live catalogue before a selection is written.
 *
 * @param mode - The slot being filled; omitted, the model's own shape decides what is checked.
 */
export async function validateOpenRouterSpeechModel(codename: string, mode?: VoiceSourceMode): Promise<boolean> {
  const normalized = normalizeOpenRouterCodename(codename);
  const spec = findOpenRouterSpeechModel(normalized);
  if (!spec || (mode && spec.shape !== mode)) return false;
  try {
    const revision = catalogRevision;
    const model = await speechCatalog.getOrFetch(normalized, { fresh: true });
    if (!model || revision === catalogRevision) return false;
    // No endpoint flag describes text-prompted design, so catalogue presence is all that can be checked.
    if (spec.shape === "design") return true;
    const response = await fetch(`https://openrouter.ai/api/v1/models/${normalized}/endpoints`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json", ...buildOpenRouterAttributionHeaders() },
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
