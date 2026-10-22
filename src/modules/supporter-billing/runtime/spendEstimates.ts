import { z } from "zod";
import {
  getOrFetchOpenRouterCapabilities,
  getOpenRouterPricing,
  getOpenRouterTokenLimits,
} from "@/utils/cache/openrouterCapabilityCache";
import { getOrFetchOpenRouterEmbeddingModel } from "@/utils/cache/openrouterEmbeddingModelCache";
import { getOrFetchOpenRouterDecisionModel } from "@/utils/cache/openrouterDecisionModelCache";
import { getOrFetchOpenRouterSpeechModel } from "@/utils/cache/openrouterSpeechModelCache";
import { getOrFetchOpenRouterVideoModelCapabilities } from "@/utils/cache/openrouterVideoModelCache";
import { getOrFetchOpenRouterImageEndpoints } from "@/utils/cache/openrouterImageModelCache";
import { openRouterPriceSchema as priceSchema } from "@/utils/cache/openrouterCatalog";
import { findOpenRouterSpeechModel } from "@/providers/openrouter/openrouterSpeechModels";

const ratesSchema = z.record(z.string(), priceSchema);
// Gemini 3.1 Flash Image uses at most 2,520 image tokens through 4K; revisit this ceiling when its output sizes change.
const GEMINI_FLASH_IMAGE_TOKENS = 2_520;
// Nano Banana 2.1 bills 1,120 image tokens at 1K; revise this bound before enabling larger output sizes.
const NANO_BANANA_1K_IMAGE_TOKENS = 1_120;
// Exa auto includes 10 results for $0.007 plus $0.001 per extra result: https://openrouter.ai/docs/guides/features/plugins/web-search.
const EXA_SEARCH_REQUEST_COST = 0.007;
const EXA_SEARCH_EXTRA_RESULT_COST = 0.001;

export async function estimateSupporterRequestCost(path: string, body: Record<string, unknown>): Promise<number> {
  const model = z.string().min(1).parse(body.model);
  if (path.endsWith("/audio/speech")) {
    const entry = await getOrFetchOpenRouterSpeechModel(model);
    const rates = ratesSchema.parse(entry?.pricing);
    const spec = findOpenRouterSpeechModel(model);
    if (!spec) throw new Error("Unsupported speech price");
    const inputCost = priceSchema.parse(rates.prompt) * Buffer.byteLength(z.string().parse(body.input));
    if (spec.shape === "design")
      return inputCost + priceSchema.parse(rates.completion) * spec.maxDurationSeconds + (rates.request ?? 0);
    if ((rates.completion ?? 0) > 0) throw new Error("Unsupported clone output price");
    return inputCost + (rates.request ?? 0);
  }
  if (path.endsWith("/videos")) {
    const entry = await getOrFetchOpenRouterVideoModelCapabilities(model);
    const rates = ratesSchema.parse(entry?.pricing);
    if (rates.video_tokens !== undefined) {
      if (!model.startsWith("bytedance/seedance-")) throw new Error("Unsupported video token pricing");
      const height = Number(
        z
          .string()
          .regex(/^\d+p$/)
          .parse(body.resolution)
          .slice(0, -1),
      );
      const [widthRatio, heightRatio] = z
        .string()
        .regex(/^\d+:\d+$/)
        .parse(body.aspect_ratio)
        .split(":")
        .map(Number);
      const shortSide = height;
      const longSide = Math.ceil((height * Math.max(widthRatio, heightRatio)) / Math.min(widthRatio, heightRatio));
      // Seedance can expand square output to the tier's 16:9 pixel budget and add one terminal frame.
      const pixels = Math.max(shortSide * longSide, height * Math.ceil((height * 16) / 9));
      const frames = Math.ceil(z.number().positive().parse(body.duration) * 24) + 1;
      const rate =
        body.generate_audio === false ? (rates.video_tokens_without_audio ?? rates.video_tokens) : rates.video_tokens;
      return ((pixels * frames) / 1024) * rate;
    }
    const resolution = z.string().parse(body.resolution).toLowerCase();
    let seconds: number | undefined;
    let resolutionSeconds: number | undefined;
    let images = 0;
    let minimum = 0;
    for (const [sku, value] of Object.entries(rates)) {
      const rate = sku.startsWith("cents_") || sku === "minimum_cents_per_generation" ? value / 100 : value;
      if (
        sku.includes("duration_seconds") ||
        sku.startsWith("per-video-second") ||
        /cents_per_(video_output_second|second_output|second_video_continuation)/.test(sku)
      ) {
        const suffix = sku.match(/_(\d+p|\d+k)$/i)?.[1]?.toLowerCase();
        if (!suffix) seconds = Math.max(seconds ?? 0, rate);
        else if (suffix === resolution) resolutionSeconds = Math.max(resolutionSeconds ?? 0, rate);
      } else if (["cents_per_image_input", "reference_images", "reference_input_images"].includes(sku)) images += rate;
      else if (sku === "minimum_cents_per_generation") minimum = Math.max(minimum, rate);
      else if (rate > 0) throw new Error("Unsupported video price");
    }
    const secondRate = resolutionSeconds ?? seconds;
    if (secondRate === undefined) throw new Error("Missing video price");
    return (
      Math.max(minimum, secondRate * z.number().positive().parse(body.duration)) +
      images * (Array.isArray(body.frame_images) ? body.frame_images.length : 0)
    );
  }
  if (path.endsWith("/images") || (Array.isArray(body.modalities) && body.modalities.includes("image"))) {
    if (model === "google/gemini-nano-banana-2.1") {
      await getOrFetchOpenRouterCapabilities(model);
      const pricing = getOpenRouterPricing(model);
      if (!pricing) throw new Error("Image input and text-output pricing unavailable");
      z.object({ image_size: z.literal("1K") }).parse(body.image_config);
      const references = countImages(body.messages);
      // Until reference-image token counts are available, reserve the model's full context for image inputs.
      const inputTokens =
        references > 0
          ? z.number().positive().parse(getOpenRouterTokenLimits(model)?.contextLength)
          : Buffer.byteLength(JSON.stringify(body.messages));
      const textOutputTokens = z
        .number()
        .int()
        .positive()
        .parse(
          body.max_tokens ??
            body.max_completion_tokens ??
            getOpenRouterTokenLimits(model)?.maxCompletionTokens ??
            getOpenRouterTokenLimits(model)?.contextLength,
        );
      const endpoints = await getOrFetchOpenRouterImageEndpoints(model);
      if (!endpoints) throw new Error("Image pricing unavailable");
      const imageCost = Math.max(
        ...endpoints.map((endpoint) =>
          endpoint.pricing.reduce((sum, price) => {
            if (price.cost_usd === 0) return sum;
            if (price.unit !== "token" || price.billable !== "output_image") throw new Error("Unsupported image price");
            return sum + price.cost_usd * NANO_BANANA_1K_IMAGE_TOKENS;
          }, 0),
        ),
      );
      return (
        imageCost +
        (inputTokens * pricing.promptPricePerMillion + textOutputTokens * pricing.completionPricePerMillion) / 1_000_000
      );
    }
    const endpoints = await getOrFetchOpenRouterImageEndpoints(model);
    if (!endpoints) throw new Error("Image pricing unavailable");
    const references = Array.isArray(body.input_references) ? body.input_references.length : countImages(body.messages);
    return Math.max(
      ...endpoints.map((endpoint) =>
        endpoint.pricing.reduce((sum, price) => {
          if (price.cost_usd === 0) return sum;
          const count =
            price.billable === "output_image"
              ? 1
              : price.billable === "input_text"
                ? Buffer.byteLength(JSON.stringify(body.messages ?? body.prompt))
                : references;
          if (price.unit === "request") return sum + price.cost_usd;
          if (price.unit === "image") return sum + price.cost_usd * count;
          if (price.unit === "token" && price.billable === "input_text") return sum + price.cost_usd * count;
          if (price.unit === "token" && price.billable === "output_image" && model === "google/gemini-3.1-flash-image")
            return sum + price.cost_usd * GEMINI_FLASH_IMAGE_TOKENS;
          throw new Error("Unsupported image price");
        }, 0),
      ),
    );
  }
  if (path.endsWith("/embeddings")) {
    const entry = await getOrFetchOpenRouterEmbeddingModel(model);
    const rates = ratesSchema.parse(entry?.pricing);
    return priceSchema.parse(rates.prompt) * Buffer.byteLength(JSON.stringify(body.input)) + (rates.request ?? 0);
  }
  if (path.endsWith("/decisions")) {
    const entry = await getOrFetchOpenRouterDecisionModel(model);
    if (!entry) throw new Error("Decision pricing unavailable");
    return entry.pricing.prompt * Buffer.byteLength(JSON.stringify(body));
  }
  await getOrFetchOpenRouterCapabilities(model);
  const pricing = getOpenRouterPricing(model);
  if (!pricing) throw new Error("Text pricing unavailable");
  const webPlugin = Array.isArray(body.plugins) ? body.plugins.find((plugin) => plugin?.id === "web") : undefined;
  let searchCost = 0;
  let searchPromptTokens = 0;
  if (webPlugin) {
    const plugin = z
      .object({
        engine: z.literal("exa"),
        mode: z.literal("auto").optional(),
        max_results: z.number().int().min(1).max(20),
      })
      .parse(webPlugin);
    searchCost = EXA_SEARCH_REQUEST_COST + Math.max(0, plugin.max_results - 10) * EXA_SEARCH_EXTRA_RESULT_COST;
    // The plugin injects unseen prompt tokens, so reserve the model's context ceiling until it offers a bounded excerpt budget.
    searchPromptTokens = z.number().finite().positive().parse(getOpenRouterTokenLimits(model)?.contextLength);
  }
  const output =
    body.max_tokens ??
    body.max_completion_tokens ??
    getOpenRouterTokenLimits(model)?.maxCompletionTokens ??
    getOpenRouterTokenLimits(model)?.contextLength;
  return (
    searchCost +
    (searchPromptTokens * pricing.promptPricePerMillion +
      Buffer.byteLength(
        JSON.stringify({ messages: body.messages, tools: body.tools, response_format: body.response_format }),
      ) *
        pricing.promptPricePerMillion +
      z.number().finite().positive().parse(output) * pricing.completionPricePerMillion) /
      1_000_000
  );
}

function countImages(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countImages(item), 0);
  if (!value || typeof value !== "object") return 0;
  if ("type" in value && value.type === "image_url") return 1;
  return Object.values(value).reduce<number>((sum, item) => sum + countImages(item), 0);
}
