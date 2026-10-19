import { normalizeOpenRouterCodename } from "@/utils/cache/openrouterCatalog";

/**
 * Request shape and limits for one admitted OpenRouter speech model.
 *
 * OpenRouter publishes no field for direction, markup, or prompt length, so this table is kept by
 * hand from each provider's documentation.
 */
export type OpenRouterSpeechModelSpec =
  | { shape: "clone" }
  | { shape: "design"; promptCharacters: number; scriptCharacters: number };

const OPENROUTER_SPEECH_MODELS: ReadonlyMap<string, OpenRouterSpeechModelSpec> = new Map<
  string,
  OpenRouterSpeechModelSpec
>([
  ["fish-audio/s2.1-pro", { shape: "clone" }],
  ["fish-audio/s2.1-pro-free:free", { shape: "clone" }],
  // OpenRouter's guide allows 3,000 input characters, but Seed's own guide caps the prompt at 2,048;
  // a measured 1,000-character script ran 103 seconds against the 120-second cap, so scripts stop at 1,100.
  ["bytedance-seed/seed-audio-1-0", { shape: "design", promptCharacters: 2_048, scriptCharacters: 1_100 }],
]);

export function findOpenRouterSpeechModel(codename: string): OpenRouterSpeechModelSpec | null {
  return OPENROUTER_SPEECH_MODELS.get(normalizeOpenRouterCodename(codename)) ?? null;
}
