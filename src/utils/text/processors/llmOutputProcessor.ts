import { log } from "@/utils/misc/logger";
import { applyUncensorOutputTransforms } from "@/utils/text/uncensor";
import { REASONING_TAG_GLOBAL_RE } from "@/providers/utils/reasoningTags";
import { escapeRegExp } from "./regexUtils";
import { replaceMentionHandles } from "./mentionProcessor";

const PRESERVE_UNRESOLVED_EMOJI_SHORTCODES_ENV = "EMOJI_PRESERVE_UNRESOLVED_SHORTCODES";

// Must agree with RENDER_MODIFIER_LIMIT in renderModifierParser.ts: a modifier the parser accepts
// but this strip rejects would ship the label verbatim, which is the leak this net exists to catch.
const RENDER_MODIFIER_LABEL_LIMIT = 64;

function findMatchingBacktickRun(text: string, startIndex: number, delimiter: string): number {
  return text.indexOf(delimiter, startIndex);
}

function parseBooleanEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return defaultValue;
}

function shouldPreserveUnresolvedEmojiShortcodes(): boolean {
  return parseBooleanEnvFlag(process.env[PRESERVE_UNRESOLVED_EMOJI_SHORTCODES_ENV], false);
}

/**
 * Returns all code-span and code-block ranges in `text` as [{start, end}] pairs.
 * Used to skip over code regions when scanning for speaker-stop labels.
 * @param text - Text to scan for markdown code ranges
 */
export function findMarkdownCodeRanges(text: string): Array<{ start: number; end: number }> {
  if (!text.includes("`")) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "`") {
      index++;
      continue;
    }

    let delimiterLength = 1;
    while (index + delimiterLength < text.length && text[index + delimiterLength] === "`") {
      delimiterLength++;
    }

    const delimiter = "`".repeat(delimiterLength);
    const closingIndex = findMatchingBacktickRun(text, index + delimiterLength, delimiter);
    const end = closingIndex === -1 ? text.length : closingIndex + delimiterLength;

    ranges.push({ start: index, end });
    index = end;
  }

  return ranges;
}

function isIndexInsideRanges(index: number, ranges: ReadonlyArray<{ start: number; end: number }>): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

/**
 * Returns true if `rawLabel` looks like a generic speaker turn label (e.g. "User:", "Assistant:").
 * Used by `truncateBeforeGenericSpeakerLine` to detect roleplay-style script turns.
 * @param rawLabel - The candidate label text (without the trailing colon)
 */
export function isGenericSpeakerStopLabel(rawLabel: string): boolean {
  const label = rawLabel.trim();
  if (!label) return false;
  if (label.length > 64) return false;
  if (label.startsWith("[") || label.startsWith("<")) return false;
  return /[\p{L}\p{N}_]/u.test(label);
}

/**
 * Truncates text at the first generic speaker-turn line (e.g. "User:\n..."), optionally
 * including the very first line if it matches.
 * @param options.includeStart - Also check the very first line for a speaker label
 * @returns Object with `text` (possibly truncated), `stopTriggered`, and `matchedSpeaker`
 */
export function truncateBeforeGenericSpeakerLine(
  text: string,
  options: { includeStart?: boolean; isAllowedSpeakerLabel?: (label: string) => boolean } = {},
): {
  text: string;
  stopTriggered: boolean;
  matchedSpeaker?: string;
} {
  if (!text) return { text, stopTriggered: false };

  const markdownCodeRanges = findMarkdownCodeRanges(text);
  const speakerLinePattern = options.includeStart ? /(^|\n+)\s*([^\n:]{1,64}):\s*/g : /(\n+)\s*([^\n:]{1,64}):\s*/g;
  let match: RegExpExecArray | null = null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = speakerLinePattern.exec(text)) !== null) {
    const rawLabel = match[2];
    if (!rawLabel) continue;

    const labelIndex = match.index + match[0].indexOf(rawLabel);
    if (isIndexInsideRanges(labelIndex, markdownCodeRanges)) continue;

    const trimmedLabel = rawLabel.trim();
    if (!isGenericSpeakerStopLabel(trimmedLabel)) continue;
    if (options.isAllowedSpeakerLabel?.(trimmedLabel)) continue;

    return { text: text.slice(0, match.index), stopTriggered: true, matchedSpeaker: trimmedLabel };
  }

  return { text, stopTriggered: false };
}

/**
 * Builds a regex alternation that matches a `Name:` turn label in its plain, "**Name:**", or
 * "**Name**:" bold forms, for any of the supplied names. Names are escaped, de-duplicated, and
 * ordered longest-first so a longer name ("Shy Tomori") is preferred over a shorter one it
 * contains ("Tomori"). Blank names are dropped.
 */
function buildNameLabelAlternation(names: string[]): string | null {
  const escapedForms: string[] = [];
  const seen = new Set<string>();
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const escaped = escapeRegExp(trimmed);
    escapedForms.push(`\\*\\*${escaped}:\\*\\*`, `\\*\\*${escaped}\\*\\*:`, `${escaped}:`);
  }
  return escapedForms.length > 0 ? `(?:${escapedForms.join("|")})` : null;
}

function buildDecoratedNameLabelAlternation(names: string[]): string | null {
  const escapedForms: string[] = [];
  const seen = new Set<string>();
  const modifier = `\\([^()\\n\\r:：]{1,${RENDER_MODIFIER_LABEL_LIMIT}}\\)`;

  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    const decorated = `${escapeRegExp(trimmed)}[ \\t]*${modifier}`;
    escapedForms.push(
      `\\*\\*${decorated}[ \\t]*[:：]\\*\\*`,
      `\\*\\*${decorated}\\*\\*[ \\t]*[:：]`,
      `${decorated}[ \\t]*[:：]`,
    );
  }

  return escapedForms.length > 0 ? `(?:${escapedForms.join("|")})` : null;
}

/** Matches a bare identity macro in its single- or double-brace form (`{bot}`, `{{char}}`, `{user}`). */
const IDENTITY_MACRO_SOURCE = "(?:\\{\\{\\s*(?:bot|char|user)\\s*\\}\\}|\\{\\s*(?:bot|char|user)\\s*\\})";

/**
 * Identity-macro turn labels ("{bot}:", "{{char}}:", "**{user}:**") in the same plain/bold forms
 * as {@link buildNameLabelAlternation}.
 *
 * Only ever applied at the START of a response. A macro there means the model mistook its raw
 * Discord turn for a transcript line and labelled itself with the template syntax, so the label is
 * a leak like any other self-label. Mid-text macros are deliberately left alone, so they are
 * legitimate content whenever a user asks the persona to draft a preset or system prompt, which is
 * exactly the text that is *supposed* to contain "{{char}}: ..." sample dialogue. Fenced drafts are
 * safe either way: a response opening with a code fence never matches the leading pattern.
 */
const IDENTITY_MACRO_LABEL_ALTERNATION = `(?:\\*\\*${IDENTITY_MACRO_SOURCE}:\\*\\*|\\*\\*${IDENTITY_MACRO_SOURCE}\\*\\*:|${IDENTITY_MACRO_SOURCE}:)`;

/**
 * Removes leaked uses of the bot's *own* name as a turn label (e.g. "Tomori:"). Conversation
 * history is fed to the model in "Name: text" form, so the model both opens its turn with its own
 * label and sometimes re-emits it. The handling branches on whether the output *opened* with the
 * persona label: the signal for "this is a real turn" vs "a thought leaked before the turn":
 *
 *   A. Opened with the label ("Tomori: ..."): a real turn. The starter label is removed and any
 *      *further* self-labels are cleaned by stripBoundaryOwnNameLabels, which preserves the
 *      preceding text (collapsing to a newline). So "Tomori: a.Tomori: b" → "a.\nb".
 *   B. Did NOT open with the label: content before the first own-label is treated as a leaked
 *      "thought"/scratchpad and dropped by stripLeakedPreamble. So "the answer is 30Tomori: 30!"
 *      → "30!". A trailing-only label ("...chew toy!Tomori:") is the exception: the preceding text
 *      is the response, so only the bare label is dropped (by stripBoundaryOwnNameLabels).
 *
 * `aliasNames` covers personas that answer to more than one name: e.g. a bundled persona whose
 * webhook nickname is "Lilya" but whose lore/default name is "Tomori". The model then opens with a
 * *chain* of labels ("Tomori: Lilya: <reply>"); the leading-chain loop consumes every self/alias
 * label so none leaks. Plain aliases only widen the *opening-chain* match, so the leaked-preamble
 * and later-boundary passes stay scoped to the active name to avoid over-stripping mid-text prose.
 * Decorated alias labels also match at turn boundaries because their parenthetical grammar is
 * unambiguous enough to remove without treating preceding text as leaked thought.
 *
 * Legitimate "Name: value" list items and inline prose are preserved throughout: see
 * stripBoundaryOwnNameLabels for the turn-boundary rules and list-marker guards.
 *
 * This function owns the leading-label strip, so it must run on text where that label is
 * still present, since callers that pre-strip it make the branch-A/B decision wrong.
 *
 * @param aliasNames - Additional names the active persona answers to (e.g. lore/default name)
 */
export function stripLeakedOwnNameLabels(text: string, botName: string, aliasNames: string[] = []): string {
  if (!text || !botName.trim()) return text;

  const escapedName = escapeRegExp(botName);
  // Own-name label in plain, "**Name:**", or "**Name**:" bold forms (reused across the helpers).
  // Scoped to the *active* name only, so the preamble/boundary passes never strip an alias from prose.
  const labelAlternation = `(?:\\*\\*${escapedName}:\\*\\*|\\*\\*${escapedName}\\*\\*:|${escapedName}:)`;
  // Decorated render-modifier label ("Tomori (silly):"), the sprite/copied-identity grammar. Only a
  // label opening a segment is consumed by parseLeadingRenderModifier, so a second one stranded
  // mid-body (a buffer boundary shifted, so the segment never split) would otherwise ship verbatim.
  // Deliberately kept OUT of the leaked-preamble alternation: that pass drops everything before the
  // label it matches, which here would delete the real reply preceding the stray one.
  const decoratedLabelAlternation =
    buildDecoratedNameLabelAlternation([botName, ...aliasNames]) ??
    `(?:${escapedName}[ \\t]*\\([^()\\n\\r:：]{1,${RENDER_MODIFIER_LABEL_LIMIT}}\\)[ \\t]*[:：])`;
  const boundaryLabelAlternation = `(?:${decoratedLabelAlternation}|${labelAlternation})`;
  // Opening-chain label covers the active name plus any aliases (lore/default name, trigger names),
  // plus the identity-macro label forms: the model sometimes labels its turn "{bot}:"/"{{char}}:"
  // instead of using the resolved name. Macros widen the *opening-chain* match only, so mid-text
  // macros in a drafted preset survive untouched.
  const nameAlternation = buildNameLabelAlternation([botName, ...aliasNames]) ?? labelAlternation;
  // The decorated form joins the opening chain too: matching here sets openedWithLabel, which keeps
  // a response that opens decorated on branch A instead of branch B's destructive preamble strip.
  const leadingAlternation = `(?:${decoratedLabelAlternation}|${nameAlternation}|${IDENTITY_MACRO_LABEL_ALTERNATION})`;

  // Consume a leading chain of self/alias labels. Each iteration peels one label, so a multi-name
  //    leak ("Tomori: Lilya: hi") collapses fully. If at least one peels, the model opened its turn
  //    with a (self/alias) label, so a real turn (branch A); otherwise fall through to branch B.
  const leadingChainPattern = new RegExp(`^\\s*${leadingAlternation}[ \\t]*`, "i");
  let working = text;
  let openedWithLabel = false;
  while (leadingChainPattern.test(working)) {
    working = working.replace(leadingChainPattern, "");
    openedWithLabel = true;
  }

  const deleaked = openedWithLabel
    ? working // Real turn: leading self/alias chain dropped.
    : stripLeakedPreamble(text, labelAlternation); // Leaked preamble: drop everything before the turn.

  return stripBoundaryOwnNameLabels(deleaked, boundaryLabelAlternation);
}

/**
 * Matches a fully-resolved Discord custom emoji tag (`<:name:id>` / `<a:name:id>`). The shortcode→tag
 * conversion in `cleanLLMOutput` wraps emojis in surrounding spaces, so a leaked self-label that the
 * model glued onto an emoji ("…<:Emoji:id>Tomori:") arrives here as "<:Emoji:id> Tomori:". The space
 * would otherwise disguise it as legitimate prose, so an emoji tag is treated as a leak-preceding
 * context (the tag itself is kept; the trailing label is dropped).
 */
const CUSTOM_EMOJI_TAG_SOURCE = "<a?:[^\\s:>]+:\\d+>";

/**
 * Drops a leaked "thought"/scratchpad preamble emitted before the real response, used when the
 * output did NOT open with the persona label. Everything up to and including the first own-name
 * label is removed, keeping only the real response that follows
 * ("the answer is 30Tomori: 30!" → "30!"; "reasoning...\nTomori: hi" → "hi").
 *
 * Exception: a trailing label with no real content after it ("...chew toy!Tomori:") is left
 * untouched here, the preceding text is the response, and the bare label is dropped later by
 * stripBoundaryOwnNameLabels. Labels inside markdown code spans/blocks are ignored.
 *
 * @param text - LLM text that does not open with the persona label
 */
function stripLeakedPreamble(text: string, labelAlternation: string): string {
  const codeRanges = findMarkdownCodeRanges(text);
  // A "leak-shaped" re-introduction label is glued directly onto the preamble, follows a custom
  // emoji tag (where the shortcode-to-tag conversion inserts a space that would otherwise
  // disguise the leak), or sits at a turn boundary. Colon is excluded from the glued char so an
  // emoji named exactly like the persona ("<:Tomori:id>") is not a false match. The rest of the
  // rule, including which preceding characters count as a boundary and why list items survive,
  // is documented on stripBoundaryOwnNameLabels above.
  const leakLabelPattern = new RegExp(
    `(?:[^\\s.!?。！？:]${labelAlternation}` +
      `|${CUSTOM_EMOJI_TAG_SOURCE}[ \\t]*${labelAlternation}` +
      `|(?:\\n|(?<!(?:^|\\n)[ \\t]*\\d{1,9})[.!?。！？])[ \\t]*${labelAlternation})[ \\t]*`,
    "gi",
  );
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = leakLabelPattern.exec(text)) !== null) {
    if (isIndexInsideRanges(match.index, codeRanges)) continue;
    // Cut the preamble + this label only when a real response follows; a trailing-only label
    //    keeps its preceding text (it is the response) and is dropped downstream instead.
    const rest = text.slice(match.index + match[0].length);
    return rest.trim() ? rest : text;
  }
  return text;
}

/**
 * Collapses or removes the bot's own name used as a turn label at a leaked position: the start of
 * text, a newline, sentence-ending punctuation (`. ! ? 。 ！ ？`), immediately after a custom emoji
 * tag, or glued onto a non-whitespace char. This distinguishes a leaked turn from legitimate uses,
 * which are preserved:
 *   - List items: "- Tomori: 100" / "1. Tomori: 100" (name follows a marker, not a boundary)
 *   - Inline prose: ", Tomori: never quit" (comma is not a turn boundary)
 * The numbered-list guard rejects a punctuation boundary only when the preceding digits run back
 * to line start. Matches inside markdown code spans/blocks are skipped.
 *
 * Mid-text labels collapse to a newline (so the following clause splits onto its own line);
 * a leading/trailing label is removed (any inserted newline is trimmed by the caller).
 *
 */
function stripBoundaryOwnNameLabels(text: string, labelAlternation: string): string {
  const codeRanges = findMarkdownCodeRanges(text);
  // Each group keeps its preceding char or tag, drops only the label, and inserts a newline so
  // the next clause splits onto its own line. Group 1's lookbehind rejects a punctuation boundary
  // preceded by line-start digits so numbered lists survive, and the glued group excludes colon so
  // an emoji named exactly like the persona is not matched. A space before the label means a list
  // item or inline prose, so those labels stay.
  const labelPattern = new RegExp(
    `(?:(^|\\n|(?<!(?:^|\\n)[ \\t]*\\d{1,9})[.!?。！？])([ \\t]*)` +
      `|(${CUSTOM_EMOJI_TAG_SOURCE})[ \\t]*` +
      `|([^\\s.!?。！？:]))${labelAlternation}[ \\t]*`,
    "gi",
  );

  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = labelPattern.exec(text)) !== null) {
    const kept = match[1] ?? match[3] ?? match[4] ?? "";
    // Leave labels inside code spans/blocks untouched (do NOT advance lastIndex). match.index
    //    is the start of the kept prefix, within a couple chars of the label, so close enough.
    if (isIndexInsideRanges(match.index, codeRanges)) continue;

    // Emit text up to the match, keep the boundary/emoji/glued prefix, drop the label. A newline
    //    (or start) needs no extra separator; any other kept prefix gains a trailing newline.
    result += text.slice(lastIndex, match.index);
    result += kept === "" || kept === "\n" ? "\n" : `${kept}\n`;
    lastIndex = labelPattern.lastIndex;
  }

  if (lastIndex === 0) return text;
  result += text.slice(lastIndex);
  return result;
}

/**
 * Cleans raw LLM output for Discord display: removes leaked system blocks, normalises
 * whitespace, resolves known Discord emoji shortcodes, strips bot-name prefixes, and resolves
 * @mention handles.
 * @param text - Raw text from LLM
 * @param botName - Optional bot name to remove from response prefix
 * @param emojiStrings - Array of valid Discord emoji strings for the server
 * @param emojiUsageEnabled - When false, strips all emoji from the output
 * @param mentionIdSet - Set of known user IDs for disambiguation
 * @param uncensorOptions - Optional uncensor cleanup flags (output side)
 * @param botNameAliases - Additional names the active persona answers to (e.g. lore/default name),
 *   used to strip a leaked multi-name opening label chain ("Tomori: Lilya: ...")
 * @param personaMentionMap - Map of known persona handles to canonical trigger words
 */
export function cleanLLMOutput(
  text: string,
  botName?: string,
  emojiStrings?: string[],
  emojiUsageEnabled = true,
  mentionMap?: Map<string, string[]>,
  mentionIdSet?: Set<string>,
  uncensorOptions?: {
    unicodeSpacesEnabled?: boolean;
    sanitizeEnabled?: boolean;
  },
  botNameAliases: string[] = [],
  personaMentionMap?: ReadonlyMap<string, string>,
): string {
  const preserveUnresolvedEmojiShortcodes = shouldPreserveUnresolvedEmojiShortcodes();
  let cleanedText = applyUncensorOutputTransforms(text, uncensorOptions)
    .replace(/\[system:[\s\S]*?\]/gi, "")
    .replace(/\[system:[\s\S]*$/gi, "");

  if (cleanedText.startsWith("```") || cleanedText.endsWith("```")) return cleanedText;

  cleanedText = cleanedText
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^|\n)-#[ \t]*\n+/g, "$1-# ")
    .replace(/<\|im_end\|>(\s*)$/, "")
    .replace(/<\|file_separator\|>(\s*)$/, "")
    .replace(REASONING_TAG_GLOBAL_RE, "")
    .replace(/\*\*<(.*?)>\*\*/g, "<$1>")
    .replace(/\*<(.*?)>\*/g, "<$1>")
    .replace(/<([a-zA-Z0-9_]+)>[\s\S]*?<\/\1>/g, "")
    .trim();

  if (emojiUsageEnabled === false) {
    cleanedText = cleanedText.replace(/<(a?):[^:]+:[^>]+>/g, "");
    cleanedText = cleanedText.replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|️|‍/gu, "");
    cleanedText = cleanedText.replace(/:(?=[^:]*[a-zA-Z_])[\w-]+:/g, "");
  } else if (emojiStrings && emojiStrings.length > 0) {
    log.info(`[cleanLLMOutput] Processing text with ${emojiStrings.length} emojis (${text.length} characters)`);
    const validEmojiSet = new Set(emojiStrings);

    cleanedText = cleanedText.replace(/<[^:>\s]*:([A-Za-z0-9_~]+):(\d+)>/g, "<:$1:$2>");

    const emojiNameMap = new Map<string, string>();
    for (const emoji of emojiStrings) {
      const m = emoji.match(/<(a?):([^:]+):([^>]+)>/);
      if (m) emojiNameMap.set(m[2].toLowerCase(), emoji);
    }

    for (const [name] of emojiNameMap.entries()) {
      const malformedPattern = new RegExp(`(:${escapeRegExp(name)})(?!:)(?=\\s|$|[^a-zA-Z0-9_~])`, "gi");
      cleanedText = cleanedText.replace(malformedPattern, "$1:");
    }

    const preserved = new Map<string, string>();
    let placeholderCount = 0;
    for (const emoji of validEmojiSet) {
      const key = `__EMOJI_PLACEHOLDER_${placeholderCount++}__`;
      cleanedText = cleanedText.replace(new RegExp(escapeRegExp(emoji), "g"), key);
      preserved.set(key, emoji);
    }

    for (const [name, full] of emojiNameMap.entries()) {
      const pattern = new RegExp(`(?<!<[^>]*)\\s*:${escapeRegExp(name)}:\\s*`, "gi");
      cleanedText = cleanedText.replace(pattern, ` ${full} `);
    }

    cleanedText = cleanedText.replace(
      /<(a?):([^:>]+):?>/g,
      (match, _animated, name) =>
        emojiNameMap.get(name.toLowerCase()) ?? (preserveUnresolvedEmojiShortcodes ? match : ""),
    );

    cleanedText = cleanedText.replace(/<(a?):([^:>]+):([^>]+)>/g, (match, animated, name, id) => {
      const full = `<${animated}:${name}:${id}>`;
      if (validEmojiSet.has(full)) return full;
      const canonical = emojiNameMap.get(name.toLowerCase());
      if (canonical) return canonical;
      return preserveUnresolvedEmojiShortcodes ? match : "";
    });

    for (const [key, emoji] of preserved.entries()) {
      cleanedText = cleanedText.replace(new RegExp(escapeRegExp(key), "g"), emoji);
    }
  } else {
    // No emoji list available (RP channel, empty server, cache failure). Default to strict
    // cleanup unless the deployment explicitly opts into preserving unresolved shortcodes.
    if (!preserveUnresolvedEmojiShortcodes) {
      cleanedText = cleanedText.replace(/:(?=[^:]*[a-zA-Z_])[\w-]+:/g, "");
    }
    log.info(
      `[cleanLLMOutput] Emoji conversion skipped. emojiUsageEnabled: ${emojiUsageEnabled}, emojiStrings length: ${emojiStrings?.length || 0}`,
    );
  }

  if (botName) {
    // Owns the full own-name leak handling: drop the starter "Name:" label on a real turn, drop a
    // leaked "thought" preamble when the turn did not open with the label, and collapse any later
    // self-labels. Must run with the leading label intact, so no prefix strip precedes it.
    cleanedText = stripLeakedOwnNameLabels(cleanedText, botName, botNameAliases);
  }

  if (!preserveUnresolvedEmojiShortcodes) {
    // Strip any leftover unresolved shortcodes (unknown emoji names that had no match in the
    // server list). The pattern covers mid-sentence positions as well as start/end of string.
    cleanedText = cleanedText.replace(/(?:^|\s):[a-zA-Z0-9_~]+:(?=\s|$)/gm, " ").trim();
  } else {
    cleanedText = cleanedText.trim();
  }

  cleanedText = replaceMentionHandles(cleanedText, mentionMap, mentionIdSet, personaMentionMap);

  return cleanedText.replace(/\n([^:]+):$/, "");
}
