import { HumanizerDegree } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";

const DISCORD_CUSTOM_EMOJI_NAME_REGEX = /^<a?:([^:>]+):[^>]+>$/;
// Adjacent custom emojis merge into one message when their normalized names share this many
// leading characters (JoeCaught_1 + JoeCaught_2), so sticker-like sets land together.
const EMOJI_RUN_PREFIX_LENGTH = 3;
const HEAVY_HUMANIZER_ELLIPSIS_PLACEHOLDER = "__TOMORI_ELLIPSIS__";
const HEAVY_HUMANIZER_SPAN_PLACEHOLDER_PREFIX = "__TOMORI_SPAN_";

function getEmojiRunPrefix(emojiTag: string): string | null {
  const match = DISCORD_CUSTOM_EMOJI_NAME_REGEX.exec(emojiTag);
  if (!match?.[1]) return null;
  const normalizedName = match[1].toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalizedName.length < EMOJI_RUN_PREFIX_LENGTH) return null;
  return normalizedName.slice(0, EMOJI_RUN_PREFIX_LENGTH);
}

function shouldMergeEmojiRun(previousEmojiTag: string | null, nextEmojiTag: string): boolean {
  if (!previousEmojiTag) return true;
  const previousPrefix = getEmojiRunPrefix(previousEmojiTag);
  const nextPrefix = getEmojiRunPrefix(nextEmojiTag);
  if (!previousPrefix || !nextPrefix) return false;
  return previousPrefix === nextPrefix;
}

// List markers we treat as a "this line labels the emoji" prefix.
// Requires whitespace after the marker so things like "1.5" or "v2.0" don't match.
const LIST_MARKER_REGEX = /^\s*(?:\d+[.)]|[-*•])\s+/;
// Used to strip other custom-emoji tags out of the surrounding text when
// deciding whether the current emoji is actually flanked by *prose*.
const EMOJI_TAG_GLOBAL_REGEX = /<a?:[^:]+:[^>]+>/g;
// Sentence-terminating punctuation in EN + JA. If the text immediately before
// the emoji ends in one of these, the emoji isn't really "mid-sentence".
const TERMINAL_PUNCTUATION_REGEX = /[.!?。！？]$/;

/**
 * Decides whether a custom Discord emoji should be folded inline with surrounding
 * text rather than isolated into its own emoji-run message.
 *
 * Two carve-outs return true (= inline); everything else falls back to the default
 * isolation behavior in Pass 4:
 *   - List item: the emoji's line starts with a list marker (e.g. "1. ", "- "),
 *      so list numbering stays attached to the emoji it labels.
 *   - Mid-sentence: non-emoji text exists on both sides of the emoji on the same
 *      line, AND the text immediately before does not end in sentence-terminating
 *      punctuation. Prevents splitting natural prose like
 *      "I really like :Soup:, don't you?" into 3 messages.
 *
 * @returns true if the emoji should be merged into adjacent text, false to isolate
 */
function shouldEmojiStayInline(sourceText: string, emojiStart: number, emojiLength: number): boolean {
  const lineStart = sourceText.lastIndexOf("\n", emojiStart - 1) + 1;
  const nextNewline = sourceText.indexOf("\n", emojiStart);
  const lineEnd = nextNewline === -1 ? sourceText.length : nextNewline;
  const line = sourceText.substring(lineStart, lineEnd);

  if (LIST_MARKER_REGEX.test(line)) return true;

  const beforeOnLine = sourceText.substring(lineStart, emojiStart);
  const afterOnLine = sourceText.substring(emojiStart + emojiLength, lineEnd);

  const beforeStripped = beforeOnLine.replace(EMOJI_TAG_GLOBAL_REGEX, "").trimEnd();
  const afterStripped = afterOnLine.replace(EMOJI_TAG_GLOBAL_REGEX, "").trim();

  // Both sides must contain non-whitespace, non-emoji content
  if (beforeStripped.length === 0 || afterStripped.length === 0) return false;
  // The preceding fragment must not be a completed sentence ("Wow! :Smile:")
  if (TERMINAL_PUNCTUATION_REGEX.test(beforeStripped)) return false;

  return true;
}

function findBalancedParentheses(text: string, startIndex = 0): { start: number; end: number; content: string } | null {
  const openIndex = text.indexOf("(", startIndex);
  if (openIndex === -1) return null;

  let depth = 0;
  let closeIndex = -1;

  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        closeIndex = i;
        break;
      }
    }
  }

  if (closeIndex === -1) return null;
  return { start: openIndex, end: closeIndex + 1, content: text.substring(openIndex, closeIndex + 1) };
}

/**
 * Scanning variant of {@link findBalancedParentheses}: the base function only examines the first "("
 * at or after `startIndex`, so an unclosed "(" or an emoticon like ":(" would hide every balanced
 * aside after it, and a flush landing in one of those asides would sever it.
 */
export function findNextBalancedParentheses(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string } | null {
  let openIndex = text.indexOf("(", startIndex);
  while (openIndex !== -1) {
    const match = findBalancedParentheses(text, openIndex);
    if (match) return match;
    openIndex = text.indexOf("(", openIndex + 1);
  }
  return null;
}

export function findQuotedString(text: string, startIndex = 0): { start: number; end: number; content: string } | null {
  const openIndex = text.indexOf('"', startIndex);
  if (openIndex === -1) return null;

  let i = openIndex + 1;
  while (i < text.length) {
    if (text[i] === '"') {
      return { start: openIndex, end: i + 1, content: text.substring(openIndex, i + 1) };
    } else if (text[i] === "\\") {
      i += 2;
    } else {
      i++;
    }
  }
  return null;
}

/**
 * Distinct open/close quotation pairs whose contents must never be split. The straight `"` is
 * handled by {@link findQuotedString} because it opens and closes with one character. `'` and
 * `‘ ’` are excluded: they double as apostrophes ("don’t"), so treating them as openers would
 * protect arbitrary stretches of prose.
 */
export const PAIRED_QUOTE_MARKS: ReadonlyArray<readonly [string, string]> = [
  ["「", "」"],
  ["『", "』"],
  ["｢", "｣"],
  ["«", "»"],
  ["‹", "›"],
  ["“", "”"],
  ["〈", "〉"],
  ["《", "》"],
];

/** Finds the earliest closed span of any {@link PAIRED_QUOTE_MARKS} pair at or after `startIndex`. */
export function findPairedQuotedString(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string } | null {
  let earliest: { start: number; end: number; content: string } | null = null;
  for (const [open, close] of PAIRED_QUOTE_MARKS) {
    const openIndex = text.indexOf(open, startIndex);
    if (openIndex === -1 || (earliest && openIndex >= earliest.start)) continue;
    const closeIndex = text.indexOf(close, openIndex + open.length);
    if (closeIndex === -1) continue;
    const end = closeIndex + close.length;
    earliest = { start: openIndex, end, content: text.substring(openIndex, end) };
  }
  return earliest;
}

export function findMarkdownBold(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_bold" } | null {
  const doubleStar = text.indexOf("**", startIndex);
  if (doubleStar !== -1) {
    const closing = text.indexOf("**", doubleStar + 2);
    if (closing !== -1) {
      return {
        start: doubleStar,
        end: closing + 2,
        content: text.substring(doubleStar, closing + 2),
        type: "markdown_bold",
      };
    }
  }

  const doubleUnderscore = text.indexOf("__", startIndex);
  if (doubleUnderscore !== -1) {
    const closing = text.indexOf("__", doubleUnderscore + 2);
    if (closing !== -1) {
      return {
        start: doubleUnderscore,
        end: closing + 2,
        content: text.substring(doubleUnderscore, closing + 2),
        type: "markdown_bold",
      };
    }
  }

  return null;
}

export function findMarkdownItalic(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_italic" } | null {
  let singleStar = text.indexOf("*", startIndex);
  while (singleStar !== -1) {
    if (singleStar > 0 && text[singleStar - 1] === "*") {
      singleStar = text.indexOf("*", singleStar + 1);
      continue;
    }
    if (singleStar < text.length - 1 && text[singleStar + 1] === "*") {
      singleStar = text.indexOf("*", singleStar + 2);
      continue;
    }
    const closing = text.indexOf("*", singleStar + 1);
    if (closing !== -1 && text[closing + 1] !== "*") {
      return {
        start: singleStar,
        end: closing + 1,
        content: text.substring(singleStar, closing + 1),
        type: "markdown_italic",
      };
    }
    singleStar = text.indexOf("*", singleStar + 1);
  }

  let singleUnderscore = text.indexOf("_", startIndex);
  while (singleUnderscore !== -1) {
    if (singleUnderscore > 0 && text[singleUnderscore - 1] === "_") {
      singleUnderscore = text.indexOf("_", singleUnderscore + 1);
      continue;
    }
    if (singleUnderscore < text.length - 1 && text[singleUnderscore + 1] === "_") {
      singleUnderscore = text.indexOf("_", singleUnderscore + 2);
      continue;
    }
    const closing = text.indexOf("_", singleUnderscore + 1);
    if (closing !== -1 && text[closing + 1] !== "_") {
      return {
        start: singleUnderscore,
        end: closing + 1,
        content: text.substring(singleUnderscore, closing + 1),
        type: "markdown_italic",
      };
    }
    singleUnderscore = text.indexOf("_", singleUnderscore + 1);
  }

  return null;
}

export function findMarkdownStrikethrough(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_strikethrough" } | null {
  const opening = text.indexOf("~~", startIndex);
  if (opening === -1) return null;
  const closing = text.indexOf("~~", opening + 2);
  if (closing === -1) return null;
  return {
    start: opening,
    end: closing + 2,
    content: text.substring(opening, closing + 2),
    type: "markdown_strikethrough",
  };
}

function findMentionHandle(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "mention_handle" } | null {
  const pattern = /@\{[^}\n]+\}/g;
  pattern.lastIndex = startIndex;
  const match = pattern.exec(text);
  if (!match) return null;
  return {
    start: match.index,
    end: match.index + match[0].length,
    content: match[0],
    type: "mention_handle",
  };
}

export function findMarkdownSpoiler(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_spoiler" } | null {
  const opening = text.indexOf("||", startIndex);
  if (opening === -1) return null;
  const closing = text.indexOf("||", opening + 2);
  if (closing === -1) return null;
  return {
    start: opening,
    end: closing + 2,
    content: text.substring(opening, closing + 2),
    type: "markdown_spoiler",
  };
}

function findMarkdownInlineCode(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_inline_code" } | null {
  let opening = text.indexOf("`", startIndex);
  while (opening !== -1) {
    if (
      (opening > 1 && text.substring(opening - 2, opening) === "``") ||
      (opening < text.length - 2 && text.substring(opening + 1, opening + 3) === "``")
    ) {
      opening = text.indexOf("`", opening + 1);
      continue;
    }
    const closing = text.indexOf("`", opening + 1);
    if (closing !== -1) {
      if (
        (closing > 1 && text.substring(closing - 2, closing) === "``") ||
        (closing < text.length - 2 && text.substring(closing + 1, closing + 3) === "``")
      ) {
        opening = text.indexOf("`", opening + 1);
        continue;
      }
      return {
        start: opening,
        end: closing + 1,
        content: text.substring(opening, closing + 1),
        type: "markdown_inline_code",
      };
    }
    opening = text.indexOf("`", opening + 1);
  }
  return null;
}

export function findMarkdownLink(
  text: string,
  startIndex = 0,
): { start: number; end: number; content: string; type: "markdown_link" } | null {
  const openBracket = text.indexOf("[", startIndex);
  if (openBracket === -1) return null;

  const closeBracket = text.indexOf("]", openBracket + 1);
  if (closeBracket === -1) return null;

  if (text[closeBracket + 1] !== "(") return null;

  let depth = 1;
  let closeParen = -1;
  for (let i = closeBracket + 2; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }

  if (closeParen === -1) return null;
  return {
    start: openBracket,
    end: closeParen + 1,
    content: text.substring(openBracket, closeParen + 1),
    type: "markdown_link",
  };
}

export type EmphasisMarker = "*" | "_" | "~";

const EMPHASIS_WORD_CHAR_REGEX = /[\p{L}\p{N}_]/u;
const EMPHASIS_CONTENT_CHAR_REGEX = /[\p{L}\p{N}]/u;
const EMPHASIS_WHITESPACE_REGEX = /\s/u;
// Han, kana, and Hangul write without spaces between words, so the ja and zh-TW locales place
// emphasis markers directly against letters.
const SPACELESS_SCRIPT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Emoticons use bare parens as facial features, so a candidate whose opener is glued to one is not
// an aside: "ugh :( that sucks. anyway. glad you're back :)" would otherwise hold the whole stretch
// between the two faces in one message.
const EMOTICON_GLUE_REGEX = /[:;=8']/;
/** Pass 1 and {@link maskInlineCodeAndUrls} share one URL shape so the two cannot drift apart. */
const URL_PATTERN_SOURCE = String.raw`(?<!\]\()(https?|ftps?):\/\/[^\s<>[\](){}'"]+`;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;

function isEmphasisMarkerChar(char: string): char is EmphasisMarker {
  return char === "*" || char === "_" || char === "~";
}

/**
 * Whether `char` reads as part of a word when a marker run sits next to it.
 *
 * A spaceless script's letter does not: Japanese and Chinese put the marker straight against the
 * text ("ふん*顔をそむける*わけ"), and a renderer italicizes that, so counting those letters as word
 * characters would leave the ja and zh-TW locales with exactly the split this classifier exists to
 * prevent. Only `*` gets this exemption. An underscore glued to a word is an identifier ("user_id")
 * in every script, and an ASCII `~~` glued to kana is almost always a wave-dash elongation
 * ("やだ~~w", "おはよ~~！"); exempting it would hold the rest of the reply behind a strikethrough
 * that was never opened.
 */
function isWordCharForMarker(char: string, marker: EmphasisMarker): boolean {
  if (!EMPHASIS_WORD_CHAR_REGEX.test(char)) return false;
  return marker !== "*" || !SPACELESS_SCRIPT_REGEX.test(char);
}

/**
 * Flanking classification for one marker run, following the rules a markdown renderer applies.
 *
 * An opener needs non-whitespace after it and must not sit inside a word, so `2 * 3` and a `* ` list
 * bullet never open. A closer needs non-whitespace before it and must not sit inside a word either,
 * so a `Best*` footnote never closes. `_` additionally needs a letter or digit against its inner
 * side, which keeps kaomoji (`-_-`, `^_^`, `>_<`) and identifiers (`user_id`, `_id`) from reading as
 * emphasis. A single `~` is prose.
 *
 * The stream hold and the HEAVY span protection both classify runs here, so a run one layer treats
 * as an opener is an opener for the other as well. Deliberately stricter than a renderer in one
 * place: an intraword closer in a spaced script (`*a*b`) is rejected, because the hold shares this
 * rule and would otherwise stall on prose.
 */
export function classifyEmphasisMarkerRun(
  text: string,
  runStart: number,
  runEnd: number,
  marker: EmphasisMarker,
): { opens: boolean; closes: boolean } {
  if (marker === "~" && runEnd - runStart < 2) return { opens: false, closes: false };

  const previousChar = runStart > 0 ? text[runStart - 1] : "";
  const nextChar = runEnd < text.length ? text[runEnd] : "";

  const opens =
    nextChar !== "" &&
    !EMPHASIS_WHITESPACE_REGEX.test(nextChar) &&
    !isWordCharForMarker(previousChar, marker) &&
    (marker !== "_" || EMPHASIS_CONTENT_CHAR_REGEX.test(nextChar));
  const closes =
    previousChar !== "" &&
    !EMPHASIS_WHITESPACE_REGEX.test(previousChar) &&
    !isWordCharForMarker(nextChar, marker) &&
    (marker !== "_" || EMPHASIS_CONTENT_CHAR_REGEX.test(previousChar));

  return { opens, closes };
}

/**
 * Blanks out inline code and URLs, leaving length and line structure intact, so an emphasis scan
 * reads them as prose rather than as markers: `*args`, `**kwargs`, and a `/_next/` path segment are
 * not emphasis.
 */
export function maskInlineCodeAndUrls(text: string): string {
  return text
    .replace(INLINE_CODE_PATTERN, (match) => " ".repeat(match.length))
    .replace(new RegExp(URL_PATTERN_SOURCE, "g"), (match) => " ".repeat(match.length));
}

/**
 * True when a finder-reported span is an emphasis pair a renderer would honor.
 *
 * The finders pair any two markers, so "* first item\n* second item", "2 * 3 ... 4 * 5", and
 * "yay ^_^ ... snake_case" all come back as spans. Protecting those suppresses the paragraph and
 * sentence splits the degree exists to make, so both delimiter runs have to classify as a real
 * opener and closer, and neither may sit in inline code or a URL.
 */
function isRealEmphasisSpan(
  text: string,
  maskedText: string,
  span: { start: number; end: number; content: string },
): boolean {
  const marker = span.content.charAt(0);
  if (!isEmphasisMarkerChar(marker)) return false;

  let openerLength = 0;
  while (openerLength < span.content.length && span.content[openerLength] === marker) openerLength++;
  let closerLength = 0;
  while (
    closerLength < span.content.length - openerLength &&
    span.content[span.content.length - 1 - closerLength] === marker
  ) {
    closerLength++;
  }
  if (openerLength + closerLength >= span.content.length) return false;
  if (maskedText[span.start] !== marker) return false;
  if (maskedText[span.end - closerLength] !== marker) return false;

  const opener = classifyEmphasisMarkerRun(text, span.start, span.start + openerLength, marker);
  const closer = classifyEmphasisMarkerRun(text, span.end - closerLength, span.end, marker);
  return opener.opens && closer.closes;
}

/**
 * True when a paren candidate is an emoticon's face rather than a parenthetical aside.
 *
 * A face opens with a bare "(" glued to its eyes (`:(`, `;(`, `:'(`), so a pair of faces reads as a
 * balanced aside: "ugh :( that sucks. anyway. glad you're back :)" arrives as one span, and holding
 * it whole would swallow every sentence split between the two faces. Only the opener is checked: a
 * spurious opener is what creates the false pair, while `(see note:)` is a real aside whose closer
 * happens to follow a colon.
 */
function isEmoticonParenSpan(text: string, span: { start: number; content: string }): boolean {
  if (span.content.charAt(0) !== "(") return false;
  const charBeforeOpen = span.start > 0 ? text[span.start - 1] : "";
  return EMOTICON_GLUE_REGEX.test(charBeforeOpen);
}

/**
 * Replaces every protected span in `text` with a placeholder so the HEAVY sentence splitter cannot
 * cut inside one.
 *
 * The semantic-block merge below rewrites protected spans to plain "text" blocks so their
 * surrounding prose stays in one message, so the HEAVY branch then splits the merged block at every
 * newline and sentence period, including ones inside the span. A split span reaches Discord as two
 * messages, each holding one half of the pair as literal syntax
 * ("*...but if you're asking the answer's more than zero" / "don't make me say a number.*").
 * Placeholders survive both splits, and each span is restored into whichever chunk holds it.
 *
 * The candidate set mirrors the semantic-block pass, markdown links included, so the HEAVY path
 * needs no separate link protection. Emphasis candidates the finders paired wrongly are rejected,
 * and the scan resumes one character into them, so a real span that starts before the false pair's
 * closer is still found. Placeholders are literal tokens, so a reply that emits
 * `__TOMORI_SPAN_<n>__` verbatim could collide with one; the ellipsis placeholder shares that
 * exposure, and a collision costs a visible token rather than content.
 */
function protectSpansForHeavySplit(text: string): { protectedText: string; spans: string[] } {
  const spans: string[] = [];
  let protectedText = "";
  let searchIndex = 0;
  const maskedText = maskInlineCodeAndUrls(text);

  while (searchIndex < text.length) {
    const candidates = [
      findQuotedString(text, searchIndex),
      findNextBalancedParentheses(text, searchIndex),
      findPairedQuotedString(text, searchIndex),
      findMarkdownBold(text, searchIndex),
      findMarkdownItalic(text, searchIndex),
      findMarkdownStrikethrough(text, searchIndex),
      findMarkdownInlineCode(text, searchIndex),
      findMarkdownLink(text, searchIndex),
      findMentionHandle(text, searchIndex),
    ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

    if (candidates.length === 0) break;
    const earliest = candidates.reduce((a, b) => (a.start <= b.start ? a : b));

    if (isEmphasisMarkerChar(earliest.content.charAt(0)) && !isRealEmphasisSpan(text, maskedText, earliest)) {
      protectedText += text.slice(searchIndex, earliest.start + 1);
      searchIndex = earliest.start + 1;
      continue;
    }

    if (isEmoticonParenSpan(text, earliest)) {
      protectedText += text.slice(searchIndex, earliest.start + 1);
      searchIndex = earliest.start + 1;
      continue;
    }

    protectedText += text.slice(searchIndex, earliest.start);
    protectedText += `${HEAVY_HUMANIZER_SPAN_PLACEHOLDER_PREFIX}${spans.length}__`;
    spans.push(earliest.content);
    searchIndex = earliest.end;
  }

  protectedText += text.slice(searchIndex);
  if (spans.length > 0) {
    log.info(`HEAVY Span Protection: Protected ${spans.length} span(s) from the sentence split`);
  }

  return { protectedText, spans };
}

/**
 * Restores the spans a chunk holds, in one pass over that chunk.
 *
 * Scanning every placeholder for every sentence would cost spans times sentences: a 20k-character
 * span-dense reply spends over a second there, where matching the placeholders actually present
 * stays proportional to the sentence. A placeholder the model emitted verbatim and that no span owns
 * is left as written.
 */
function restoreSpansFromPlaceholders(text: string, spans: string[]): string {
  const placeholderPattern = new RegExp(`${HEAVY_HUMANIZER_SPAN_PLACEHOLDER_PREFIX}(\\d+)__`, "g");

  // Function replacer: a string one would expand "$&"-style sequences inside restored span text.
  return text.replace(placeholderPattern, (match, index: string) => spans[Number(index)] ?? match);
}

function isStandalonePunctuationChunk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^[.,!?;:。！？、，]+$/.test(trimmed);
}

function mergeStandalonePunctuationChunks(chunks: string[], chunkLength: number): string[] {
  if (chunks.length <= 1) return chunks;

  const normalized: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!isStandalonePunctuationChunk(chunk)) {
      normalized.push(chunk);
      continue;
    }

    const punct = chunk.trim();
    if (normalized.length > 0) {
      const previous = normalized[normalized.length - 1];
      if (previous.length + punct.length <= chunkLength) {
        normalized[normalized.length - 1] = `${previous}${punct}`;
        continue;
      }
    }
    if (i + 1 < chunks.length) {
      chunks[i + 1] = `${punct}${chunks[i + 1]}`;
      continue;
    }
    normalized.push(punct);
  }
  return normalized;
}

function splitByNewlines(text: string, chunkLength: number): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > chunkLength) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      if (line.length > chunkLength) {
        let remainingLine = line;
        while (remainingLine.length > 0) {
          const breakPoint = findBreakPoint(remainingLine, chunkLength);
          chunks.push(remainingLine.substring(0, breakPoint));
          remainingLine = remainingLine.substring(breakPoint);
        }
      } else {
        currentChunk = line;
      }
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
    }
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);
  return chunks;
}

function findBreakPoint(text: string, maxLength: number): number {
  if (text.length <= maxLength) return text.length;
  const preferredBreakZone = Math.floor(maxLength * 0.9);
  for (let i = maxLength; i >= preferredBreakZone; i--) {
    if (text[i] === " ") return i + 1;
  }
  // Unspaced scripts offer no space to break on, so their sentence and clause marks stand in.
  for (let i = maxLength - 1; i >= preferredBreakZone; i--) {
    if (FULL_WIDTH_BREAK_MARKS.test(text[i])) return i + 1;
  }
  // A cut between a surrogate pair would send half of one character in each message.
  const nextCode = text.charCodeAt(maxLength);
  return nextCode >= 0xdc00 && nextCode <= 0xdfff ? maxLength - 1 : maxLength;
}

const FULL_WIDTH_BREAK_MARKS = /[。！？、，．｡､]/;

function splitCodeBlock(codeBlock: string, chunkLength: number): string[] {
  const chunks: string[] = [];
  const match = codeBlock.match(/```(\w+)?\n?([\s\S]*?)```/);
  if (!match) return [codeBlock.substring(0, chunkLength)];

  const language = match[1] || "";
  const content = match[2];
  const lines = content.split("\n");
  let currentChunk = `\`\`\`${language}\n`;

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 + 3 > chunkLength) {
      currentChunk += "```";
      chunks.push(currentChunk);
      currentChunk = `\`\`\`${language}\n${line}`;
    } else {
      currentChunk += (currentChunk.endsWith("\n") || currentChunk.endsWith(`\`\`\`${language}\n`) ? "" : "\n") + line;
    }
  }

  if (currentChunk.length > 0 && !currentChunk.endsWith("```")) {
    currentChunk += "```";
    chunks.push(currentChunk);
  }
  return chunks;
}

function addTextSegment(text: string, currentChunk: string, chunks: string[], chunkLength: number): string {
  if (!text) return currentChunk;
  let segmentedChunk = currentChunk;

  if (segmentedChunk.length + text.length > chunkLength) {
    if (segmentedChunk.length > 0) {
      chunks.push(segmentedChunk);
      segmentedChunk = "";
    }
    const textChunks = splitByNewlines(text, chunkLength);
    if (textChunks.length > 1) {
      chunks.push(...textChunks.slice(0, -1));
      segmentedChunk = textChunks[textChunks.length - 1];
    } else if (textChunks.length === 1) {
      segmentedChunk = textChunks[0];
    }
  } else {
    segmentedChunk += (segmentedChunk.length > 0 ? "\n" : "") + text;
  }

  return segmentedChunk;
}

/**
 * Creates a regex pattern for splitting sentences while preserving common abbreviations.
 * Splits on periods and full-width periods (。．｡) but avoids splitting on common abbreviations,
 * numbered lists, and other period-containing patterns.
 */
export function createSentenceSplitRegex(): RegExp {
  const titles = ["mr", "mrs", "ms", "dr", "prof", "rev", "fr", "sr", "jr"];
  const business = ["inc", "ltd", "co", "corp", "llc", "vs"];
  const latin = ["etc", "e\\.g", "eg", "i\\.e", "ie", "cf", "viz", "ibid"];
  const academic = ["phd", "md", "ba", "ma", "bs", "ms", "jd", "dds"];
  const geographic = ["us", "uk", "usa", "ussr", "eu"];
  const address = ["st", "ave", "blvd", "rd", "ln", "ct", "pl", "dr"];
  const reference = ["no", "vol", "fig", "ref", "pp", "p", "ch", "sec"];
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const alsoKnownAs = ["a\\.k\\.a", "aka"];
  const otherTargetLanguages = ["sra", "srta", "sres", "dra", "mme", "mlle", "т\\.е", "т\\.д", "т\\.п", "ул"];

  const allAbbreviations = [
    ...titles,
    ...business,
    ...latin,
    ...academic,
    ...geographic,
    ...address,
    ...reference,
    ...months,
    ...days,
    ...alsoKnownAs,
    ...otherTargetLanguages,
  ];

  // An ASCII \b sees no boundary before a Cyrillic or accented letter, so it would never let a
  // non-English abbreviation match.
  const abbreviationsPattern = `(?<![\\p{L}\\p{N}_])(?:${allAbbreviations.join("|")})`;
  const acronymPattern = "(?:[A-Z]\\.[A-Z]\\.(?:[A-Z]\\.)*)";
  const negativeLookbehind = `(?<!(?:${abbreviationsPattern}|\\d|${acronymPattern}|\\.))`;
  const sentenceEnd = "(?:\\.(?=\\s|\\n|$)|[。．｡])";

  return new RegExp(`${negativeLookbehind}${sentenceEnd}`, "iu");
}

/**
 * Splits a long message into smaller chunks for Discord's limits, preserving code blocks
 * and natural breakpoints.
 * @param humanizerDegree - Controls how aggressive text chunking should be (0-3)
 * @param chunkLength - Optional max length for each chunk (defaults to 1900)
 */
export function chunkMessage(inputText: string, humanizerDegree: number, chunkLength = 1900): string[] {
  const chunkedMessages: string[] = [];
  if (!inputText || inputText.length === 0) return chunkedMessages;

  type BlockType =
    | "text"
    | "code"
    | "emoji"
    | "emoji_inline"
    | "url"
    | "quoted"
    | "parenthesized"
    | "paired_quoted"
    | "markdown_bold"
    | "markdown_italic"
    | "markdown_strikethrough"
    | "markdown_inline_code"
    | "markdown_link";

  const blocks: Array<{ content: string; type: BlockType; start: number; end: number }> = [];

  const codeBlockRegex = /```(?:(\w+)\n)?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
  while ((match = codeBlockRegex.exec(inputText)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        content: inputText.substring(lastIndex, match.index),
        type: "text",
        start: lastIndex,
        end: match.index,
      });
    }
    blocks.push({ content: match[0], type: "code", start: match.index, end: match.index + match[0].length });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < inputText.length) {
    blocks.push({ content: inputText.substring(lastIndex), type: "text", start: lastIndex, end: inputText.length });
  }

  const urlProcessedBlocks: typeof blocks = [];
  for (const block of blocks) {
    if (block.type !== "text") {
      urlProcessedBlocks.push(block);
      continue;
    }

    const textContent = block.content;
    const urlRegex = new RegExp(URL_PATTERN_SOURCE, "g");
    let textLastIndex = 0;
    let urlMatch: RegExpExecArray | null;

    // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
    while ((urlMatch = urlRegex.exec(textContent)) !== null) {
      if (urlMatch.index > textLastIndex) {
        urlProcessedBlocks.push({
          content: textContent.substring(textLastIndex, urlMatch.index),
          type: "text",
          start: block.start + textLastIndex,
          end: block.start + urlMatch.index,
        });
      }
      urlProcessedBlocks.push({
        content: urlMatch[0],
        type: "url",
        start: block.start + urlMatch.index,
        end: block.start + urlMatch.index + urlMatch[0].length,
      });
      textLastIndex = urlMatch.index + urlMatch[0].length;
    }

    if (textLastIndex < textContent.length) {
      urlProcessedBlocks.push({
        content: textContent.substring(textLastIndex),
        type: "text",
        start: block.start + textLastIndex,
        end: block.start + textContent.length,
      });
    }
  }

  const quotedBlocks: typeof blocks = [];
  for (const block of urlProcessedBlocks) {
    if (block.type !== "text") {
      quotedBlocks.push(block);
      continue;
    }

    const textContent = block.content;
    const foundSemanticBlocks: Array<{
      start: number;
      end: number;
      content: string;
      type: Exclude<BlockType, "text" | "code" | "emoji" | "url">;
    }> = [];
    let searchIndex = 0;

    while (searchIndex < textContent.length) {
      const quotedString = findQuotedString(textContent, searchIndex);
      const balancedParens = findBalancedParentheses(textContent, searchIndex);
      const pairedQuoted = findPairedQuotedString(textContent, searchIndex);
      const candidates = [
        quotedString ? { ...quotedString, type: "quoted" as const } : null,
        balancedParens ? { ...balancedParens, type: "parenthesized" as const } : null,
        pairedQuoted ? { ...pairedQuoted, type: "paired_quoted" as const } : null,
        findMarkdownBold(textContent, searchIndex),
        findMarkdownItalic(textContent, searchIndex),
        findMarkdownStrikethrough(textContent, searchIndex),
        findMarkdownInlineCode(textContent, searchIndex),
        findMarkdownLink(textContent, searchIndex),
      ].filter((c): c is NonNullable<typeof c> => c !== null);

      if (candidates.length === 0) break;
      const earliest = candidates.sort((a, b) => a.start - b.start)[0];
      foundSemanticBlocks.push(earliest);
      searchIndex = earliest.end;
    }

    if (foundSemanticBlocks.length === 0) {
      quotedBlocks.push(block);
    } else {
      let currentIndex = 0;
      for (const semanticBlock of foundSemanticBlocks) {
        if (semanticBlock.start > currentIndex) {
          quotedBlocks.push({
            content: textContent.substring(currentIndex, semanticBlock.start),
            type: "text",
            start: block.start + currentIndex,
            end: block.start + semanticBlock.start,
          });
        }
        quotedBlocks.push({
          content: semanticBlock.content,
          type: semanticBlock.type,
          start: block.start + semanticBlock.start,
          end: block.start + semanticBlock.end,
        });
        currentIndex = semanticBlock.end;
      }
      if (currentIndex < textContent.length) {
        quotedBlocks.push({
          content: textContent.substring(currentIndex),
          type: "text",
          start: block.start + currentIndex,
          end: block.start + textContent.length,
        });
      }
    }
  }

  const emojiPattern = /<(a?):([^:]+):([^>]+)>/g;
  const processedBlocks: typeof blocks = [];
  for (const block of quotedBlocks) {
    if (block.type !== "text") {
      processedBlocks.push(block);
      continue;
    }

    const textContent = block.content;
    lastIndex = 0;
    let emojiMatch: RegExpExecArray | null;

    // biome-ignore lint/suspicious/noAssignInExpressions: standard exec loop
    while ((emojiMatch = emojiPattern.exec(textContent)) !== null) {
      if (emojiMatch.index > lastIndex) {
        processedBlocks.push({
          content: textContent.substring(lastIndex, emojiMatch.index),
          type: "text",
          start: block.start + lastIndex,
          end: block.start + emojiMatch.index,
        });
      }
      const emojiAbsStart = block.start + emojiMatch.index;
      // Classify: "emoji_inline" gets folded into adjacent text in Pass 3;
      //    plain "emoji" keeps the existing isolate-into-emoji-run behavior in Pass 4.
      const isInline = shouldEmojiStayInline(inputText, emojiAbsStart, emojiMatch[0].length);
      processedBlocks.push({
        content: emojiMatch[0],
        type: isInline ? "emoji_inline" : "emoji",
        start: emojiAbsStart,
        end: emojiAbsStart + emojiMatch[0].length,
      });
      lastIndex = emojiMatch.index + emojiMatch[0].length;
    }
    if (lastIndex < textContent.length) {
      processedBlocks.push({
        content: textContent.substring(lastIndex),
        type: "text",
        start: block.start + lastIndex,
        end: block.start + textContent.length,
      });
    }
  }

  const mergedBlocks: typeof processedBlocks = [];
  let i = 0;
  while (i < processedBlocks.length) {
    const currentBlock = processedBlocks[i];
    const isSemanticBlock =
      currentBlock.type === "quoted" ||
      currentBlock.type === "parenthesized" ||
      currentBlock.type === "paired_quoted" ||
      currentBlock.type === "markdown_bold" ||
      currentBlock.type === "markdown_italic" ||
      currentBlock.type === "markdown_strikethrough" ||
      currentBlock.type === "markdown_inline_code" ||
      currentBlock.type === "markdown_link" ||
      // Inline emojis (mid-sentence or list-item) merge with neighboring text
      // so e.g. "I like :Soup:, you?" stays as one chunk, and "1. :Soup:"
      // keeps the list marker attached to its emoji.
      currentBlock.type === "emoji_inline";

    if (isSemanticBlock) {
      let mergedContent = "";

      // Pop the previous block iff it's already a text block, so this is true both for
      // raw text and for prior semantic blocks (they get pushed AS text, see below).
      // Chaining works: text → quoted → emoji_inline → bold → text all flows into one chunk.
      if (mergedBlocks.length > 0 && mergedBlocks[mergedBlocks.length - 1].type === "text") {
        const prevBlock = mergedBlocks.pop();
        if (prevBlock) mergedContent += prevBlock.content;
      }
      mergedContent += currentBlock.content;
      if (i + 1 < processedBlocks.length && processedBlocks[i + 1].type === "text") {
        mergedContent += processedBlocks[i + 1].content;
        i++;
      }
      mergedBlocks.push({ ...currentBlock, type: "text", content: mergedContent });
    } else {
      mergedBlocks.push(currentBlock);
    }
    i++;
  }

  let currentChunk = "";
  let emojiRun = "";
  let lastEmojiInRun: string | null = null;
  let prevBlockWasEmoji = false;

  for (const block of mergedBlocks) {
    if (block.type !== "emoji" && emojiRun.length > 0) {
      const isWhitespaceText = block.type === "text" && block.content.trim().length === 0;
      if (!isWhitespaceText) {
        chunkedMessages.push(emojiRun);
        emojiRun = "";
        lastEmojiInRun = null;
      }
    }

    switch (block.type) {
      case "code":
        if (currentChunk.length + block.content.length > chunkLength) {
          if (currentChunk.length > 0) {
            chunkedMessages.push(currentChunk);
            currentChunk = "";
          }
          if (block.content.length > chunkLength) {
            chunkedMessages.push(...splitCodeBlock(block.content, chunkLength));
          } else {
            chunkedMessages.push(block.content);
          }
        } else {
          currentChunk += (currentChunk.length > 0 ? "\n" : "") + block.content;
        }
        break;

      case "emoji":
        if (currentChunk.length > 0) {
          chunkedMessages.push(currentChunk);
          currentChunk = "";
        }
        if (emojiRun.length === 0) {
          emojiRun = block.content;
          lastEmojiInRun = block.content;
          prevBlockWasEmoji = true;
          break;
        }
        if (!shouldMergeEmojiRun(lastEmojiInRun, block.content)) {
          chunkedMessages.push(emojiRun);
          emojiRun = block.content;
          lastEmojiInRun = block.content;
          prevBlockWasEmoji = true;
          break;
        }
        emojiRun += block.content;
        lastEmojiInRun = block.content;
        prevBlockWasEmoji = true;
        break;

      case "url":
        if (currentChunk.length + block.content.length > chunkLength) {
          if (currentChunk.length > 0) {
            chunkedMessages.push(currentChunk);
            currentChunk = "";
          }
          chunkedMessages.push(block.content);
        } else {
          currentChunk += (currentChunk.length > 0 && !currentChunk.endsWith(" ") ? " " : "") + block.content;
        }
        break;

      case "text": {
        let textToAdd = block.content.trim();
        if (prevBlockWasEmoji) {
          // Strip leading sentence-ending punctuation orphaned by the emoji split. An
          // intentionally isolated trailing emoji (not "emoji_inline") leaves the following
          // text fragment starting with an orphan "!".
          textToAdd = textToAdd.replace(/^[.!?。]+(?=\s|$)/, "");
        }
        prevBlockWasEmoji = false;
        if (!textToAdd) continue;

        if (humanizerDegree === HumanizerDegree.NONE) {
          const newlineAwareChunks = splitByNewlines(textToAdd, chunkLength);
          for (const chunk of newlineAwareChunks) {
            if (!chunk.trim()) continue;
            chunkedMessages.push(chunk);
          }
        } else if (humanizerDegree < HumanizerDegree.HEAVY) {
          const paragraphs = textToAdd.split(/\n+/);
          for (const paragraph of paragraphs) {
            if (!paragraph.trim()) continue;
            chunkedMessages.push(paragraph);
          }
        } else if (humanizerDegree >= HumanizerDegree.HEAVY) {
          // Protected spans are held out of the split for the whole block, not per paragraph: a
          // span containing a newline would otherwise be cut by the paragraph split below.
          const { protectedText, spans } = protectSpansForHeavySplit(textToAdd);
          const paragraphs = protectedText.split(/\n+/);
          for (const paragraph of paragraphs) {
            if (!paragraph.trim()) continue;

            const processedParagraph = paragraph.replace(/\.{3}(?!\.)(?!\d)/g, HEAVY_HUMANIZER_ELLIPSIS_PLACEHOLDER);
            const sentences = processedParagraph.split(createSentenceSplitRegex());

            for (let sentence of sentences) {
              sentence = sentence.trim();
              if (!sentence) continue;

              let processedSentence = sentence;
              if (/[.。．｡]$/.test(sentence) && !sentence.endsWith("...")) {
                processedSentence = sentence.slice(0, -1).trim();
              }
              if (!processedSentence) continue;

              processedSentence = processedSentence.replaceAll(HEAVY_HUMANIZER_ELLIPSIS_PLACEHOLDER, "...");
              processedSentence = restoreSpansFromPlaceholders(processedSentence, spans);

              if (currentChunk.length > 0) {
                chunkedMessages.push(currentChunk);
                currentChunk = "";
              }
              // A restored span reaches this point whole, so it can exceed the chunk limit the
              // sentence split never checked; splitByNewlines brings it back to the requested
              // length before it reaches Discord.
              if (processedSentence.length > chunkLength) {
                chunkedMessages.push(...splitByNewlines(processedSentence, chunkLength));
              } else {
                chunkedMessages.push(processedSentence);
              }
            }
          }
        } else {
          currentChunk = addTextSegment(textToAdd, currentChunk, chunkedMessages, chunkLength);
        }
        break;
      }
    }
  }

  if (emojiRun.length > 0) chunkedMessages.push(emojiRun);
  if (currentChunk.length > 0) chunkedMessages.push(currentChunk);

  // Fallback: if input was non-empty but nothing chunked, split by length
  if (chunkedMessages.length === 0 && inputText.length > 0) {
    let remainingInput = inputText;
    while (remainingInput.length > 0) {
      chunkedMessages.push(remainingInput.substring(0, chunkLength));
      remainingInput = remainingInput.substring(chunkLength);
    }
  }

  return mergeStandalonePunctuationChunks(chunkedMessages, chunkLength);
}
