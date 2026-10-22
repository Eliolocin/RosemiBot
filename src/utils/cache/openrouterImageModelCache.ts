/**
 * OpenRouter image generation model catalog.
 *
 * `/api/v1/models` lists a handful of chat models that can emit images, but the image
 * *generation* surface is a separate and much larger catalog, so registration validates
 * against this endpoint rather than filtering output modalities off the text list.
 */

import {
  createOpenRouterCatalog,
  type OpenRouterCatalogModelEntry,
  parseOpenRouterCatalogModelList,
  type OpenRouterCatalog,
  normalizeOpenRouterCodename,
  openRouterPriceSchema,
} from "@/utils/cache/openrouterCatalog";
import { z } from "zod";

const OPENROUTER_IMAGE_MODELS_URL = "https://openrouter.ai/api/v1/images/models";

function parseOpenRouterImageModelList(payload: unknown): OpenRouterCatalogModelEntry[] {
  return parseOpenRouterCatalogModelList("image", payload);
}

const imageCatalog = createOpenRouterCatalog<OpenRouterCatalogModelEntry>({
  label: "image",
  url: OPENROUTER_IMAGE_MODELS_URL,
  parse: parseOpenRouterImageModelList,
  keyOf: (entry) => entry.id,
});

const imageEndpointSchema = z.object({
  id: z.string().min(1),
  endpoints: z
    .array(
      z.object({
        pricing: z.array(z.object({ billable: z.string(), unit: z.string(), cost_usd: openRouterPriceSchema })).min(1),
      }),
    )
    .min(1),
});
const endpointCatalogs = new Map<string, OpenRouterCatalog<z.infer<typeof imageEndpointSchema>>>();

export async function getOrFetchOpenRouterImageEndpoints(modelCodename: string, options?: { fresh?: boolean }) {
  const codename = normalizeOpenRouterCodename(modelCodename);
  let catalog = endpointCatalogs.get(codename);
  if (!catalog) {
    catalog = createOpenRouterCatalog({
      label: "image pricing",
      url: `${OPENROUTER_IMAGE_MODELS_URL}/${encodeURI(codename)}/endpoints`,
      parse: (payload) => [imageEndpointSchema.extend({ id: z.literal(codename) }).parse(payload)],
      keyOf: (entry) => entry.id,
    });
    endpointCatalogs.set(codename, catalog);
  }
  if (!options?.fresh) await catalog.refreshIfStale();
  return (await catalog.getOrFetch(codename, options))?.endpoints;
}

export async function initializeOpenRouterImageModelCache(): Promise<void> {
  await imageCatalog.initialize();
}

export function getOrFetchOpenRouterImageModel(
  modelCodename: string,
  options?: { fresh?: boolean },
): Promise<OpenRouterCatalogModelEntry | undefined> {
  return imageCatalog.getOrFetch(modelCodename, options);
}

export function refreshOpenRouterImageModelCacheIfStale(): Promise<boolean> {
  return imageCatalog.refreshIfStale();
}

export function getOpenRouterImageModelCacheSize(): number {
  return imageCatalog.size();
}
