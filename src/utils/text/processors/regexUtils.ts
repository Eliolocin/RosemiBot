/** Helper to escape special RegExp characters in a string. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a leading speaker label that names the bot: its name or the `{bot}`/`{{char}}` macro, an
 * optional sprite parenthetical (capture group 1), and an ASCII or full-width colon.
 */
export function buildBotSpeakerLabelPattern(botName: string): RegExp {
  return new RegExp(
    `^\\s*(?:${escapeRegExp(botName)}|\\{\\{?char\\}\\}?|\\{\\{?bot\\}\\}?)((?:\\s*\\([^)]+\\))?)\\s*[:：]\\s*`,
    "iu",
  );
}

/**
 * Unicode-aware equivalent of wrapping `pattern` in `\b...\b`. `\b` is defined against ASCII
 * `\w`, so it treats any accented letter (é, ö, ñ, ...) as a non-word character and fakes a
 * boundary right beside it, letting the wrapped pattern match mid-word (e.g. "ren" inside
 * "zuhören"). The returned source requires the "u" regex flag on the RegExp it's used in.
 *
 * `\p{M}` is in the class because Discord delivers whatever normalization the sending client
 * used: Apple clients send NFD, where "zuhören" ends in a bare "o" plus a combining diaeresis.
 * Without it the mark itself becomes the fake boundary and the mid-word match survives.
 */
export function wrapWithWordBoundary(pattern: string): string {
  return `(?<![\\p{L}\\p{N}\\p{M}_])${pattern}(?![\\p{L}\\p{N}\\p{M}_])`;
}

const UNSPACED_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * True for text containing Han, kana, or Hangul. Words in those scripts must be matched as
 * substrings: Han and kana prose has no spaces, and Hangul attaches particles directly to the noun
 * (토모리야), so {@link wrapWithWordBoundary} would reject nearly every real use.
 */
export function isUnspacedScriptText(text: string): boolean {
  return UNSPACED_SCRIPT_PATTERN.test(text);
}
