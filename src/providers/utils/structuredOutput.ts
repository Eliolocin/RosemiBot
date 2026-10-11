/**
 * Shared structured-output schemas and builders.
 * Provider-specific structured-output HTTP/runtime helpers belong in the
 * corresponding provider folders.
 */

import { z } from "zod";
import { getAllEmotionKeys } from "@/types/misc/emotions";

/**
 * Zod schema for a single expression (emoji or sticker) classification result
 */
const ExpressionClassificationSchema = z.object({
  name: z.string().describe("The emoji or sticker name (case-insensitive match)"),
  emotion_key: z
    .enum(getAllEmotionKeys() as [string, ...string[]])
    .describe("One of the 28 emotion categories that best matches the visual expression"),
  description: z
    .string()
    .min(10)
    .max(200)
    .describe("One concise sentence describing the visual appearance (10-200 characters)"),
});

/**
 * Zod schema for the complete LLM response containing multiple expression classifications
 */
export const ExpressionBatchResultSchema = z.object({
  expressions: z.array(ExpressionClassificationSchema),
});
/**
 * Type for the complete batch result
 */
export type ExpressionBatchResult = z.infer<typeof ExpressionBatchResultSchema>;

/**
 * Build JSON schema object for structured output (shared across providers)
 */
export function buildExpressionResponseSchema() {
  return {
    type: "object" as const,
    properties: {
      expressions: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            name: {
              type: "string" as const,
              description: "The emoji or sticker name (case-insensitive match)",
            },
            emotion_key: {
              type: "string" as const,
              enum: getAllEmotionKeys(),
              description: "One of the 28 emotion categories that best matches the visual expression",
            },
            description: {
              type: "string" as const,
              description: "One concise sentence describing the visual appearance",
            },
          },
          required: ["name", "emotion_key", "description"],
        },
      },
    },
    required: ["expressions"],
  };
}

/**
 * Builds a minimal placeholder value for a JSON schema, used as the example in
 * schema-steered prompts for providers without native structured output.
 */
export function buildExampleJsonFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") {
    return {};
  }

  const record = schema as Record<string, unknown>;

  if ("const" in record) {
    return record.const;
  }

  if (Array.isArray(record.enum) && record.enum.length > 0) {
    return record.enum[0];
  }

  // Zod emits discriminated unions as `oneOf`; without this branch the example collapses to `{}`.
  const variants = record.anyOf ?? record.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    return buildExampleJsonFromSchema(variants[0]);
  }

  const schemaType = record.type;
  if (schemaType === "object") {
    const properties =
      record.properties && typeof record.properties === "object" ? (record.properties as Record<string, unknown>) : {};
    const example: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      example[key] = buildExampleJsonFromSchema(value);
    }
    return example;
  }

  if (schemaType === "array") {
    return [buildExampleJsonFromSchema(record.items)];
  }

  if (schemaType === "integer" || schemaType === "number") {
    const minimum = typeof record.minimum === "number" && Number.isFinite(record.minimum) ? record.minimum : 0;
    return minimum;
  }

  if (schemaType === "boolean") {
    return false;
  }

  if (schemaType === "string") {
    return "<string>";
  }

  return {};
}
