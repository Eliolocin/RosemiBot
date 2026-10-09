import type { TomoriState } from "@/types/db/schema";
import { normalizeUserTargetInput } from "@/utils/discord/targetResolver";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

const WEBHOOK_USERNAME_LIMIT = 80;
const RENDER_MODIFIER_LIMIT = 64;
const TRUNCATION_SUFFIX = "...";

/**
 * Modifier in the decorated "Persona (neutral)" webhook name an alter uses when it reverts from a
 * sprite to its base appearance and would otherwise share the sprite's clean username, which makes
 * Discord group the reverted message under the sprite's avatar.
 */
export const NEUTRAL_APPEARANCE_MODIFIER = "neutral";

export type RenderModifierName = {
  sourceName: string;
  modifier: string;
};

export type LeadingRenderModifierMatch = RenderModifierName & {
  body: string;
  matchedPrefix: string;
};

export type LeadingGenericSpeakerLabelMatch = {
  sourceName: string;
  /** Present for the decorated "Name (modifier):" shape; absent for a plain "Name:" label. */
  modifier?: string;
  body: string;
  matchedPrefix: string;
};

export function normalizeRenderModifierName(value: string): string {
  return normalizeUserTargetInput(value);
}

export function parseRenderModifierWebhookName(value?: string | null): RenderModifierName | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = /^(.+?)\s+\(([^()\n\r]{1,64})\)$/u.exec(trimmed);
  const sourceName = match?.[1]?.trim();
  const modifier = match?.[2]?.trim();
  if (!sourceName || !modifier) return null;

  return { sourceName, modifier };
}

export function formatRenderModifierWebhookName(sourceName: string, modifier: string): string {
  const cleanSourceName = sourceName.trim();
  const cleanModifier = modifier.trim();
  if (!cleanSourceName || !cleanModifier) return cleanSourceName || cleanModifier || "Persona";

  const suffix = ` (${cleanModifier})`;
  const availableSourceLength = WEBHOOK_USERNAME_LIMIT - suffix.length;
  if (availableSourceLength >= cleanSourceName.length) {
    return `${cleanSourceName}${suffix}`;
  }

  if (availableSourceLength >= TRUNCATION_SUFFIX.length + 1) {
    return `${cleanSourceName.slice(0, availableSourceLength - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}${suffix}`;
  }

  const availableModifierLength = WEBHOOK_USERNAME_LIMIT - cleanSourceName.length - 3;
  if (availableModifierLength >= TRUNCATION_SUFFIX.length + 1) {
    const truncatedModifier = `${cleanModifier.slice(0, availableModifierLength - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
    return `${cleanSourceName} (${truncatedModifier})`;
  }

  return `${cleanSourceName.slice(0, WEBHOOK_USERNAME_LIMIT - TRUNCATION_SUFFIX.length).trimEnd()}${TRUNCATION_SUFFIX}`;
}

export function collectRenderModifierSourceNames(activeName: string, aliases: readonly string[] = []): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const candidate of [activeName, ...aliases]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const normalized = normalizeRenderModifierName(trimmed);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(trimmed);
  }

  return names.sort((left, right) => right.length - left.length);
}

export function parseLeadingRenderModifier(
  text: string,
  sourceNames: readonly string[],
  chainSourceNames: readonly string[] = sourceNames,
): LeadingRenderModifierMatch | null {
  if (!text.trim() || text.trimStart().startsWith("```")) return null;

  // Models sometimes copy the prompt's code-span example or emphasize the label. Consume only a
  // balanced wrapper around the label, so ordinary Markdown at the start stays in the message.
  const opening = /^(\s*)(`|\*\*|\*|__|_)/u.exec(text);
  const wrapper = opening?.[2] ?? "";
  const prefixLength = wrapper ? (opening?.[0].length ?? 0) : 0;
  const labelText = text.slice(prefixLength);

  const collectedSourceNames = collectRenderModifierSourceNames("", sourceNames);
  const collectedChainSourceNames = collectRenderModifierSourceNames("", chainSourceNames);
  const labelChainAlternation = buildSourceLabelAlternation(collectedChainSourceNames);
  const labelChainPrefix = labelChainAlternation ? `(?:(?:${labelChainAlternation})\\s*[:：][ \\t]*)*` : "";

  for (const sourceName of collectedSourceNames) {
    const pattern = new RegExp(
      `^\\s*${labelChainPrefix}(${escapeRegExp(sourceName)})\\s*[（(]([^()（）\\n\\r:：]{1,${RENDER_MODIFIER_LIMIT}})[）)]\\s*[:：]`,
      "iu",
    );
    const match = pattern.exec(labelText);
    const matchedSourceName = match?.[1]?.trim();
    const modifier = match?.[2]?.trim();
    if (!match || !matchedSourceName || !modifier) continue;

    const remainder = labelText.slice(match[0].length);
    const closing = wrapper
      ? new RegExp(`^[ \\t]*${escapeRegExp(wrapper)}[ \\t]*`, "u").exec(remainder)?.[0]
      : /^[ \t]*/u.exec(remainder)?.[0];
    if (closing === undefined) continue;
    const consumed = prefixLength + match[0].length + closing.length;
    return {
      sourceName: matchedSourceName,
      modifier,
      body: text.slice(consumed),
      matchedPrefix: text.slice(0, consumed),
    };
  }

  return null;
}

/**
 * Reports whether `text` opens with a plain, undecorated label naming one of `sourceNames`, in the
 * same forms stripLeakedOwnNameLabels removes ("Locke:", "**Locke:**", "**Locke**:"). The stream
 * treats it as the model returning to its base appearance after a sprite.
 *
 * Accepts only the ASCII colon: a label this reports must also be one the output cleaner strips,
 * or the reset would ship with its label still visible.
 */
export function hasLeadingPlainOwnNameLabel(text: string, sourceNames: readonly string[]): boolean {
  if (!text.trim() || text.trimStart().startsWith("```")) return false;

  const labelForms = collectRenderModifierSourceNames("", sourceNames).flatMap((sourceName) => {
    const escaped = escapeRegExp(sourceName);
    return [`\\*\\*${escaped}:\\*\\*`, `\\*\\*${escaped}\\*\\*:`, `${escaped}:`];
  });
  if (labelForms.length === 0) return false;

  return new RegExp(`^\\s*(?:${labelForms.join("|")})`, "iu").test(text);
}

/**
 * Parses a leading sprite modifier for `/impersonate persona`, where the persona is already
 * fixed by the command's autocomplete option: unlike {@link parseLeadingRenderModifier}, the source
 * name is optional. Accepts both "PersonaName (modifier): body" (delegated to the named parser)
 * and the bare "(modifier): body" shape, since repeating the already-selected persona's name is
 * redundant in this context. Callers still gate on an actual sprite match before treating the
 * text as decorated; text that fails that lookup falls through to plain, unmodified content.
 */
export function parseLeadingImpersonationSpriteModifier(
  text: string,
  personaName: string,
): LeadingRenderModifierMatch | null {
  const named = parseLeadingRenderModifier(text, [personaName]);
  if (named) return named;

  if (!text.trim() || text.trimStart().startsWith("```")) return null;

  const bare = new RegExp(`^\\s*\\(([^()\\n\\r:：]{1,${RENDER_MODIFIER_LIMIT}})\\)\\s*[:：][ \\t]*`, "u").exec(text);
  const modifier = bare?.[1]?.trim();
  if (!bare || !modifier) return null;

  return {
    sourceName: personaName,
    modifier,
    body: text.slice(bare[0].length),
    matchedPrefix: bare[0],
  };
}

// Rejects label candidates that are really markdown structure: list items ("- Name", "1. Name"),
// blockquotes ("> Name"), and headings ("# Name"). Mirrors parseLeadingRenderModifier, which never
// matches these because its pattern is anchored directly after leading whitespace.
const MARKDOWN_MARKER_NAME_RE = /^(?:[-*+>#]\s|\d{1,9}[.)]\s)/;

/**
 * Parses a leading speaker label of ANY name at the start of `text`, in either the decorated
 * "Name (modifier): body" or plain "Name: body" shape. Unlike {@link parseLeadingRenderModifier},
 * the name is not restricted to the active persona, so callers use this to detect *leaked* labels
 * (e.g. "Chris (smug): ...") that the allowlisted parser intentionally refuses to match.
 *
 * Shapes that are really prose or markdown are rejected: code-fence openings, list items,
 * blockquotes/headings, names without a word character, and names opening with "[" or "<"
 * (links, mentions, timestamps: mirrors isGenericSpeakerStopLabel).
 *
 * @param text - Segment text to inspect (leading whitespace tolerated)
 * @returns The parsed label and remaining body, or null when no label shape is present
 */
export function parseLeadingGenericSpeakerLabel(text: string): LeadingGenericSpeakerLabelMatch | null {
  if (!text.trim() || text.trimStart().startsWith("```")) return null;

  // Decorated shape first ("Name (modifier):"), since the plain pattern cannot cross a "(".
  const decorated = new RegExp(
    `^\\s*([^\\n\\r():：]{1,${WEBHOOK_USERNAME_LIMIT}}?)\\s*\\(([^()\\n\\r:：]{1,${RENDER_MODIFIER_LIMIT}})\\)\\s*[:：][ \\t]*`,
    "u",
  ).exec(text);
  if (decorated) {
    const sourceName = decorated[1]?.trim();
    const modifier = decorated[2]?.trim();
    if (sourceName && modifier && isPlausibleSpeakerLabelName(sourceName)) {
      return { sourceName, modifier, body: text.slice(decorated[0].length), matchedPrefix: decorated[0] };
    }
    return null;
  }

  // Plain shape ("Name:").
  const plain = new RegExp(`^\\s*([^\\n\\r():：]{1,${WEBHOOK_USERNAME_LIMIT}}?)\\s*[:：][ \\t]*`, "u").exec(text);
  const plainName = plain?.[1]?.trim();
  if (plain && plainName && isPlausibleSpeakerLabelName(plainName)) {
    return { sourceName: plainName, body: text.slice(plain[0].length), matchedPrefix: plain[0] };
  }

  return null;
}

function isPlausibleSpeakerLabelName(name: string): boolean {
  if (!/[\p{L}\p{N}_]/u.test(name)) return false;
  if (name.startsWith("[") || name.startsWith("<")) return false;
  return !MARKDOWN_MARKER_NAME_RE.test(name);
}

/**
 * Returns true when `name` matches any of `names` after render-modifier normalization
 * (the same comparison used by isAllowedRenderModifierSpeakerLabel).
 * @param names - Names to compare against (not yet normalized)
 */
export function matchesRenderModifierName(name: string, names: readonly string[]): boolean {
  const normalized = normalizeRenderModifierName(name);
  if (!normalized) return false;
  return names.some((candidate) => normalizeRenderModifierName(candidate) === normalized);
}

function buildSourceLabelAlternation(sourceNames: readonly string[]): string | null {
  const escapedNames = sourceNames.map((sourceName) => escapeRegExp(sourceName.trim())).filter(Boolean);
  return escapedNames.length > 0 ? `(?:${escapedNames.join("|")})` : null;
}

export function isAllowedRenderModifierSpeakerLabel(label: string, sourceNames: readonly string[]): boolean {
  const parsed = parseRenderModifierWebhookName(label);
  if (!parsed) return false;
  const normalizedSource = normalizeRenderModifierName(parsed.sourceName);
  return collectRenderModifierSourceNames("", sourceNames).some(
    (sourceName) => normalizeRenderModifierName(sourceName) === normalizedSource,
  );
}

/**
 * Resolves the source persona behind a decorated webhook name, accepting both
 * name orientations, and rebuilds the model-facing "SourcePersona (modifier)"
 * label:
 *
 * - Flipped copied-identity format (current): "impersonated (SourcePersona)":
 *    Discord shows the impersonated name first so the disguise reads naturally,
 *    while the model-facing label keeps the source persona first.
 * - Legacy format: "SourcePersona (modifier)": pre-flip copied identities and
 *    pre-clean-name sprite messages still in fetched history windows.
 *
 * When BOTH parts match personas (persona impersonating another persona) the
 * flipped interpretation wins, since all newly sent messages use it; legacy
 * persona-on-persona messages in the transition window are misattributed until
 * they age out of the history fetch window.
 *
 * A legacy-shaped "Persona (neutral)" name resolves to the plain persona name with
 * `isNeutralAppearance` set: it is usually an alter's group-break revert to its base
 * appearance, but a real sprite named "neutral" produces the same name, so callers
 * check the sprite message mapping before settling on the plain name.
 */
export function resolveRenderModifierSourcePersona(
  webhookName: string,
  personaByNickname: Map<string, TomoriState>,
): { persona: TomoriState; displayName: string; isNeutralAppearance?: boolean } | null {
  const parsed = parseRenderModifierWebhookName(webhookName);
  if (!parsed) return null;

  const flippedPersona = personaByNickname.get(normalizeRenderModifierName(parsed.modifier));
  if (flippedPersona) {
    return {
      persona: flippedPersona,
      displayName: formatRenderModifierWebhookName(flippedPersona.persona_nickname, parsed.sourceName),
    };
  }

  const legacyPersona = personaByNickname.get(normalizeRenderModifierName(parsed.sourceName));
  if (!legacyPersona) return null;

  if (normalizeRenderModifierName(parsed.modifier) === normalizeRenderModifierName(NEUTRAL_APPEARANCE_MODIFIER)) {
    return { persona: legacyPersona, displayName: legacyPersona.persona_nickname, isNeutralAppearance: true };
  }

  return {
    persona: legacyPersona,
    displayName: formatRenderModifierWebhookName(legacyPersona.persona_nickname, parsed.modifier),
  };
}
