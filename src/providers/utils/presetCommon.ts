/**
 * Shared schemas, prompts, and utilities for AI-powered preset generation.
 *
 * All providers that support preset generation (OpenRouter, Custom, DeepSeek,
 * NVIDIA, ZAI, Zaicoding) use the same response schema, prompt builder, and
 * response extraction logic. This module provides a single source of truth so
 * each provider's presetGenerator.ts only handles the provider-specific HTTP wiring,
 * tool adapter integration, and response format negotiation.
 */
import type { ToolResult } from "@/types/tool/interfaces";
import type { GeneratePresetParams, PresetGenerationErrorType } from "@/types/provider/featureInterfaces";
import { PRESET_MAX_STRING_LENGTH } from "@/types/preset/presetExport";
import { tryRepairIncompleteJson } from "@/utils/text/jsonRepair";
import {
  NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX,
  NATURAL_NUDGE_INTEREST_LABEL_MAX,
  NATURAL_NUDGE_INTEREST_LIMIT,
  naturalNudgeInterestSchema,
  type NaturalNudgeInterest,
} from "@/modules/natural-nudges/db/types";

/** A text or image_url content part in an OpenAI-compatible message. */
export type PresetContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/**
 * Shape the preset generation prompt asks the model to return.
 *
 * Every field is optional because this describes untrusted model output: the prompt
 * states the counts, and {@link validatePresetGenerationFields} is what holds the model
 * to them. Lists are mutable because the accepted result is handed straight into
 * `PresetExportData`.
 */
interface PresetGenerationFields {
  attribute_list?: string[];
  sample_dialogues_in?: string[];
  sample_dialogues_out?: string[];
  interests?: unknown;
}

/** Validated generation output, keyed the way `PresetExportData` stores it. */
interface GeneratedPresetFields {
  attribute_list: string[];
  sample_dialogues_in: string[];
  sample_dialogues_out: string[];
  natural_nudge_interests: NaturalNudgeInterest[];
}

/** Attributes every generated preset must carry, matching the order the prompt specifies. */
export const PRESET_ATTRIBUTE_COUNT = 6;
/** Dialogue pairs every generated preset must carry, matching the 3 guided + 2 free structure. */
export const PRESET_DIALOGUE_PAIR_COUNT = 5;
/** Upper end of the interest count the prompt asks for, below the stored cap so edits leave room. */
const GENERATED_PRESET_INTEREST_TARGET = 5;

/**
 * Why a generated payload cannot become a preset.
 *
 * `UNPARSABLE` and `PARSE_FAILED` mean no usable object came back; `INCOMPLETE` and the
 * per-field codes mean the object arrived but the model did not follow the schema. Callers
 * need the distinction because it decides `errorType` (`INVALID_JSON` or
 * `VALIDATION_ERROR`) and whether the raw provider error is worth showing.
 */
export type PresetFieldFailureCode =
  | "UNPARSABLE"
  | "PARSE_FAILED"
  | "INCOMPLETE"
  | "ATTRIBUTE_LIST"
  | "DIALOGUES_IN"
  | "DIALOGUES_OUT";

/**
 * The failures where the payload arrived intact but broke the contract, as opposed to a
 * response nothing could read. Exported as data so a provider can branch on the class
 * without re-listing the per-field codes.
 */
export const PRESET_SCHEMA_MISS_CODES: readonly PresetFieldFailureCode[] = [
  "ATTRIBUTE_LIST",
  "DIALOGUES_IN",
  "DIALOGUES_OUT",
];

export interface PresetFieldFailure {
  code: PresetFieldFailureCode;
  /** Count the offending list actually held, when the list arrived but was the wrong length. */
  received?: number;
}

export type PresetFieldsResult =
  | { ok: true; preset: GeneratedPresetFields }
  | { ok: false; failure: PresetFieldFailure };

/**
 * Sanitize sample dialogue by removing speaker prefixes
 * Removes patterns like "User:", "Character:", "{{char}}:", etc.
 *
 */
export function sanitizeSampleDialogueText(dialogue: string): string {
  if (!dialogue) return "";

  const cleaned = dialogue
    .replace(/^{{char}}:\s*/i, "") // Remove {{char}}: prefix
    .replace(/^{{character}}:\s*/i, "") // Remove {{character}}: prefix
    .replace(/^{user}:\s*/i, "") // Remove {user}: prefix
    .replace(/^User:\s*/i, "") // Remove User: prefix
    .replace(/^Character:\s*/i, "") // Remove Character: prefix
    .replace(/^[^:]+:\s*/, ""); // Remove any "Name:" style prefix

  return cleaned.trim();
}

/**
 * Check a candidate payload against the preset contract, sanitizing the dialogues it accepts.
 *
 * This is the one place the 6-attribute and 5-pair counts are enforced for generated
 * presets: the schema in {@link buildPresetResponseSchema} and the prompt in
 * {@link buildPresetPrompt} state them, and a provider that ignored them has to be caught
 * here before the preset reaches the export schema.
 *
 * A repaired payload is expected to be missing fields: a response the token ceiling cut
 * short loses whatever followed the cut, so only an intact leading section can pass.
 */
export function validatePresetGenerationFields(candidate: unknown): PresetFieldsResult {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, failure: { code: "UNPARSABLE" } };
  }

  const fields = candidate as PresetGenerationFields;
  if (!fields.attribute_list || !fields.sample_dialogues_in || !fields.sample_dialogues_out) {
    return { ok: false, failure: { code: "INCOMPLETE" } };
  }

  if (!Array.isArray(fields.attribute_list) || fields.attribute_list.length !== PRESET_ATTRIBUTE_COUNT) {
    return { ok: false, failure: { code: "ATTRIBUTE_LIST", received: fields.attribute_list.length } };
  }

  if (!Array.isArray(fields.sample_dialogues_in) || fields.sample_dialogues_in.length !== PRESET_DIALOGUE_PAIR_COUNT) {
    return { ok: false, failure: { code: "DIALOGUES_IN", received: fields.sample_dialogues_in.length } };
  }

  if (
    !Array.isArray(fields.sample_dialogues_out) ||
    fields.sample_dialogues_out.length !== PRESET_DIALOGUE_PAIR_COUNT
  ) {
    return { ok: false, failure: { code: "DIALOGUES_OUT", received: fields.sample_dialogues_out.length } };
  }

  return {
    ok: true,
    preset: {
      attribute_list: fields.attribute_list,
      sample_dialogues_in: fields.sample_dialogues_in.map(sanitizeSampleDialogueText),
      sample_dialogues_out: fields.sample_dialogues_out.map(sanitizeSampleDialogueText),
      natural_nudge_interests: acceptGeneratedInterests(fields.interests),
    },
  };
}

/**
 * Interests are optional garnish on a generated preset, so a malformed entry is dropped rather than
 * failing the whole generation.
 */
export function acceptGeneratedInterests(candidate: unknown): NaturalNudgeInterest[] {
  if (!Array.isArray(candidate)) return [];
  return candidate
    .flatMap((entry) => {
      const parsed = naturalNudgeInterestSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, NATURAL_NUDGE_INTEREST_LIMIT);
}

/** Interests property shared by every preset generation schema. */
export function buildPresetInterestsSchemaProperty() {
  return {
    type: "array" as const,
    description: `Between 2 and ${GENERATED_PRESET_INTEREST_TARGET} topics the character would bring up unprompted. Each item has a short "label" (1-${NATURAL_NUDGE_INTEREST_LABEL_MAX} characters, lowercase noun phrase such as "mecha anime") and a one-line "description" (1-${NATURAL_NUDGE_INTEREST_DESCRIPTION_MAX} characters) naming concrete examples so a conversation can be matched to it.`,
    items: {
      type: "object" as const,
      properties: {
        label: { type: "string" as const },
        description: { type: "string" as const },
      },
      required: ["label", "description"],
    },
  };
}

/**
 * Turn a raw preset generation response into validated preset fields.
 *
 * A response no parser could read is retried with {@link tryRepairIncompleteJson}, because
 * an output-token ceiling can cut the payload off mid-object: the fields that did finish are
 * still usable, and whether enough of them survived is what
 * {@link validatePresetGenerationFields} decides.
 *
 * @param parse - Parser for this provider's response format, applied to the response text.
 * @param logFailure - Receives the parser's own message when it threw. The failure code
 *                     cannot carry the reason a provider rejected the payload, and that
 *                     reason is what separates a vendor quirk from a truncation.
 */
export function extractPresetGenerationFields(
  raw: string,
  parse: (raw: string) => unknown,
  logFailure: (detail: string) => void,
): PresetFieldsResult {
  let candidate: unknown;
  try {
    candidate = parse(raw);
  } catch (parseError) {
    logFailure(parseError instanceof Error ? parseError.message : String(parseError));
    candidate = tryRepairIncompleteJson(raw);
  }

  if (candidate === null || candidate === undefined) {
    return { ok: false, failure: { code: "PARSE_FAILED" } };
  }

  return validatePresetGenerationFields(candidate);
}

/**
 * The rephrase-only message a failed payload produces, for providers whose error text the
 * user sees verbatim.
 *
 * The mixed causes are deliberate: an unreadable response, a payload the token ceiling cut
 * short, and a schema the model ignored all reach the user as one instruction to retry,
 * because nothing the user can change would separate them.
 */
export function presetGenerationFailureMessage(failure: PresetFieldFailure): string {
  switch (failure.code) {
    case "ATTRIBUTE_LIST":
      return `Generated attribute list must contain exactly ${PRESET_ATTRIBUTE_COUNT} items. Please try again.`;
    case "DIALOGUES_IN":
      return "Generated sample dialogues must contain exactly 5 user inputs.";
    case "DIALOGUES_OUT":
      return "Generated sample dialogues must contain exactly 5 character responses.";
    default:
      return "Generated character data is incomplete. Please try again.";
  }
}

/**
 * Whether a failure is a validation miss (`VALIDATION_ERROR`) or a payload nothing could
 * read (`INVALID_JSON`), which is the `errorType` every provider reports.
 */
export function presetGenerationFailureErrorType(failure: PresetFieldFailure): PresetGenerationErrorType {
  switch (failure.code) {
    case "ATTRIBUTE_LIST":
    case "DIALOGUES_IN":
    case "DIALOGUES_OUT":
      return "VALIDATION_ERROR";
    default:
      return "INVALID_JSON";
  }
}

/** Message shape used inside the preset generation tool-calling loop. */
export type PresetMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | PresetContentPart[] }
  | {
      role: "assistant";
      content?: string | null;
      tool_calls?: PresetToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** Shape of a single tool call from the model response. */
export interface PresetToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * JSON Schema for the preset generation structured output.
 *
 * Used by providers that support `response_format: { type: "json_schema", json_schema: { ... } }`
 * (OpenRouter, NVIDIA). For providers that only support `json_object` mode, this schema
 * is injected into the system prompt alongside `buildPresetPrompt()`.
 */
export function buildPresetResponseSchema() {
  const maxStringLength = PRESET_MAX_STRING_LENGTH;

  return {
    type: "object" as const,
    properties: {
      attribute_list: {
        type: "array" as const,
        description: `Array containing exactly 6 items describing different facets of the character, in this exact order: 1) {bot}'s Description (core identity and essence), 2) {bot}'s Appearance (physical traits and style), 3) {bot}'s Personality (personality traits, comma-separated), 4) {bot}'s Likes (interests and preferences), 5) {bot}'s Dislikes (aversions and pet peeves), 6) {bot}'s Behavioral Quirks (unique mannerisms and patterns). Each item maximum ${maxStringLength} characters, in this specific format per array item: "{bot}'s Description: "`,
        items: {
          type: "string" as const,
        },
      },
      sample_dialogues_in: {
        type: "array" as const,
        description: `Array of exactly 5 example user messages. MUST include these 3 guided scenarios in order: 1) Self-introduction request, 2) Emotional/personal scenario, 3) Practical/functional scenario. Then add 2 free dialogue scenarios that showcase unique character traits. Do NOT prepend with speaker names. Each message maximum ${maxStringLength} characters.`,
        items: {
          type: "string" as const,
        },
      },
      sample_dialogues_out: {
        type: "array" as const,
        description: `Array of exactly 5 character responses paired with sample_dialogues_in. Should reflect the character's speaking style, personality, and demonstrate their full range across the 3 guided scenarios and 2 free scenarios. Do NOT prepend with speaker names. Each response maximum ${maxStringLength} characters.`,
        items: {
          type: "string" as const,
        },
      },
      interests: buildPresetInterestsSchemaProperty(),
    },
    required: ["attribute_list", "sample_dialogues_in", "sample_dialogues_out", "interests"],
  };
}

/**
 * Build the full preset generation prompt from user-supplied parameters.
 *
 * This is the canonical prompt used by all providers. It includes detailed guidance
 * for the 3 guided + 2 free dialogue structure, character limit reminders, and
 * optional sections for an upload-derived appearance description, web search, existing
 * preset context, and additional instructions.
 *
 * Takes `GeneratePresetParams` itself rather than a hand-copied subset, so a new input
 * cannot silently fail to reach the prompt.
 */
export function buildPresetPrompt(
  params: GeneratePresetParams,
  options?: {
    /**
     * True when the caller has already run search and appends the results itself, so the
     * prompt must not also tell the model to call web search tools it was not given.
     */
    webSearchResultsProvided?: boolean;
  },
): string {
  const maxStringLength = PRESET_MAX_STRING_LENGTH;
  let prompt = `You are an expert character creator for a Discord chatbot. Create a detailed character profile based on the following information.

Character Name: ${params.characterName}

Character Description:
${params.characterDescription}

How the Character Speaks:
${params.speechExamples}

Instructions:
- Create a rich, detailed character profile in the structured JSON format
- The character should be interesting and engaging for conversation
- Do NOT prepend the sample dialogues with character names or "User:"/"Character:" prefixes - the chat application will handle that
- Use "{user}" ONLY where you would write the conversation partner's name (NOT for the pronoun "you"). Keep "you" as "you"
- Use "{bot}" ONLY where you would write the character's own name (NOT for the pronouns "I"/"me"). Keep "I" as "I" and "I'm" as "I'm"
- Default dialogue voice is FIRST PERSON. Use normal first-person pronouns (I, me, my) in the character's speech. Only use {bot} where the character would literally say their own name, such as a self-introduction. The only exception is characters who canonically refer to themselves in third person (e.g., young children, certain anime archetypes)
- Ensure exactly 5 sample dialogue pairs (sample_dialogues_in paired with sample_dialogues_out)

The attribute_list MUST contain exactly 6 items in this exact order:

1. {bot}'s Description: A comprehensive 2-4 sentence description capturing the character's core identity, essence, and overall vibe. What makes them unique? What's their deal?

2. {bot}'s Appearance: Physical description including hair, eyes, clothing, accessories, and any distinctive features. Be specific and vivid.

3. {bot}'s Personality: A comma-separated list of personality traits that define how they think, act, and interact. Focus on specific, actionable traits (e.g., "selective passion, authentic advisor, music obsessive, practical pessimist").

4. {bot}'s Likes: Things, activities, topics, or concepts the character genuinely enjoys or gravitates toward. Can include brief explanations in parentheses.

5. {bot}'s Dislikes: Things, activities, topics, or concepts the character dislikes, avoids, or finds irritating. Can include brief explanations in parentheses or quotes.

6. {bot}'s Behavioral Quirks: Specific mannerisms, speech patterns, habits, or behaviors that make the character distinctive. How do they express themselves? What are their tells?

The sample_dialogues_in and sample_dialogues_out MUST follow this structure (exactly 5 dialogue pairs):

**3 GUIDED SCENARIOS (Required, in this exact order):**

1. **Self-Introduction Request**: User asks {bot} to introduce themselves (e.g., "Can you introduce yourself, {bot}?" or "Who are you?" or "Tell me about yourself")
   - Response should establish identity, tone, core personality, and set expectations
   - This is the character's "first impression" - make it memorable and authentic

2. **Emotional/Personal Scenario**: User shares feelings, asks for advice, or engages emotionally (e.g., "I'm feeling really down today..." or "I'm having relationship problems..." or "Thanks for helping me, {bot}!")
   - Response should demonstrate empathy, emotional intelligence, and how they handle vulnerability
   - Show their relational depth and caring capacity (or lack thereof, if fitting)

3. **Practical/Functional Scenario**: User asks for help, explanation, or practical advice (e.g., "Can you help me understand taxes?" or "How do I fix this problem?" or "What should I do about...")
   - Response should demonstrate competence, knowledge, and helpfulness
   - Show they can actually be useful beyond just personality

**2 FREE SCENARIOS (Your creative choice):**

4. **Free Dialogue #1**: Choose a scenario that showcases a unique character trait, interest, or quirk
   - Examples: Questions about their specific interests/hobbies, unexpected situations, character-specific topics
   - Make it distinctive and memorable - something that reveals depth

5. **Free Dialogue #2**: Choose another scenario that demonstrates different aspects of the character
   - Avoid repeating patterns from previous dialogues
   - Could be humor, vulnerability, expertise, philosophical musings, or anything that adds dimension

The interests list names 2-${GENERATED_PRESET_INTEREST_TARGET} topics the character would bring up on their own, drawn from their Likes. Each has a short lowercase "label" (e.g. "mecha anime") and a one-line "description" with concrete examples (e.g. "Fiction about giant piloted robots, such as Gundam, Code Geass, and Evangelion."). Keep topics distinct from each other.`;

  if (params.existingPresetContext?.trim()) {
    prompt += `\n\nExisting Character Data (from uploaded card/preset):
Use this as reference material to transform, refine, or expand upon according to the user's description and instructions. Preserve the core character identity while incorporating requested changes.

${params.existingPresetContext.trim()}`;
  }

  if (params.appearanceDescription?.trim()) {
    prompt += `\n\nAppearance Observed In The Uploaded Image:
A vision model described the character's avatar, which is the source of truth for their physical appearance. Write the Appearance attribute from this description, and do not contradict or embellish it with details it does not mention.

${params.appearanceDescription.trim()}`;
  }

  if (params.useWebSearch && !options?.webSearchResultsProvided) {
    prompt += `\n\nWeb Search Instructions:
- Use the available web search tools to gather accurate, up-to-date details when helpful
- If you cannot find reliable information, treat the character as original and rely on the user's description and image
- Do not include citations, URLs, or sources in the JSON output`;
  }

  if (params.additionalInstructions?.trim()) {
    prompt += `\n\nAdditional Instructions: ${params.additionalInstructions.trim()}`;
  }

  prompt += `\n\nIMPORTANT:
- Respond with COMPLETE valid JSON only
- Follow the exact schema provided with strict length limits
- Exactly 6 items in attribute_list in the exact order specified above (each MAX ${maxStringLength} characters)
- Exactly 5 dialogue pairs following the 3 GUIDED + 2 FREE structure in the exact order specified
- sample_dialogues_in: Keep user messages concise (1-3 sentences, MAX ${maxStringLength} characters each)
- sample_dialogues_out: Character responses can be longer and more detailed to showcase personality (MAX ${maxStringLength} characters each)
- No speaker name prefixes in any dialogue (no "User:", "Character:", "{user}:", "{bot}:", etc.)
- "{user}" and "{bot}" are NAME placeholders, never pronoun replacements: use "{user}" only in place of the conversation partner's name and "{bot}" only in place of the character's own name
- NEVER replace pronouns: write "you", "I", "me", "I'm" literally (e.g. write "I'm {bot}", never "{bot}'m {bot}")
- All string lengths must not exceed ${maxStringLength} characters per item`;

  return prompt;
}

/**
 * Recursively strip JSON Schema array constraints unsupported by Anthropic's
 * structured-output endpoint (`maxItems`, `minItems`).
 *
 * Use this before sending a schema to any Anthropic model (including via
 * OpenRouter) to avoid the "property 'maxItems' is not supported" error.
 */
export function stripAnthropicUnsupportedConstraints(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === "maxItems" || key === "minItems") continue;

    // Recurse into nested schema objects (properties, items, etc.) but not into
    // plain arrays like `enum` whose elements are primitive values
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = stripAnthropicUnsupportedConstraints(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract text from an OpenAI-compatible response `content` field.
 *
 * Handles three formats:
 * - Plain string content
 * - Array of content parts (filters for `type: "text"` parts)
 * - Null/undefined → empty string
 */
export function extractResponseText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          (part as { type?: string }).type === "text" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("");
  }

  return "";
}

/**
 * Build a standard ToolResult for tool-call errors.
 */
export function buildToolErrorResult(message: string): ToolResult {
  return {
    success: false,
    error: message,
    message,
  };
}
