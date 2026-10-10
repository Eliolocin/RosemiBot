/**
 * Helpers for rendering user-authored text back to the user inside a Discord
 * notice: either at the moment it is deleted, or to confirm what was just
 * saved.
 *
 * Two problems recur across every command that does this:
 *
 * - **Fence breakout.** The text is interpolated into a locale string that
 *    already owns a code fence. Text containing its own triple backtick closes
 *    that fence early and mangles the rest of the card.
 * - **Dishonest truncation.** Callers slice to a fixed width and either bake a
 *    trailing ellipsis into the locale string unconditionally (claiming
 *    truncation that did not happen) or drop the cut silently.
 *
 * {@link buildTextPreview} solves both, and the shared footer helpers give
 * every call site the same honest "how much was hidden" line.
 *
 * Callers interpolate {@link TextPreview.text} into a locale string that owns
 * the code fence.
 */

import {
  FENCE_GUARD,
  getDiscordTextLength,
  neutralizeFenceRuns,
  truncateDiscordText,
} from "@/utils/text/discordTextLimits";
import { formatLocaleInteger, localizer } from "@/utils/text/localizer";

/**
 * Character budget for a preview rendered inside a Components V2 workflow card.
 *
 * Discord caps a Components V2 message at 4000 characters across every
 * TextDisplay component. {@link buildTextPreview} bounds the *guarded* text to
 * this budget, so the remaining ~1000 characters are pure headroom for the
 * title, description, and footer.
 */
export const CV2_TEXT_PREVIEW_BUDGET = 3000;
/**
 * Character budget for "here is what you just saved" confirmations.
 *
 * Deliberately much smaller than the removal budgets: the user still has the
 * text they just submitted, so this is a glance to confirm the write landed,
 * not a recovery lifeline. Matches the width these call sites already used.
 */
export const CONFIRMATION_PREVIEW_BUDGET = 200;

/** A fence-safe, budget-bounded rendering of user-authored text. */
export interface TextPreview {
  /** Fence-safe text, ready to interpolate into a locale string's code block. */
  text: string;
  /** Whether {@link text} was cut short to fit the budget. */
  truncated: boolean;
  /** Codepoints shown, counted against the original (pre-guard) text. */
  shownChars: number;
  /** Total codepoints in the original text. */
  totalChars: number;
}

/**
 * Builds a fence-safe preview of user-authored text.
 *
 * The fence guard is applied to the whole source *before* truncation, and the
 * budget then bounds the guarded string. This makes the budget a hard ceiling
 * on the rendered length rather than a headroom assumption: a run of `N`
 * backticks guards out to `2N - 1` codepoints, so guarding after a fixed slice
 * (as an earlier version did) could nearly double the length and blow the
 * Components V2 / embed cap the budget is meant to respect. `shownChars` is
 * recovered from the original (non-guard) codepoints that survived, so the
 * reported counts stay meaningful to a user who never sees the guards.
 *
 * @param text - The text to preview; `null`/`undefined`/blank yields a preview with `totalChars === 0`.
 * @param budget - Maximum codepoints to render, defaulting to {@link CV2_TEXT_PREVIEW_BUDGET}.
 */
export function buildTextPreview(
  text: string | null | undefined,
  budget: number = CV2_TEXT_PREVIEW_BUDGET,
): TextPreview {
  const source = text?.trim() ?? "";
  const totalChars = getDiscordTextLength(source);
  if (totalChars === 0) {
    return { text: "", truncated: false, shownChars: 0, totalChars: 0 };
  }

  // Guard the fence first so the guard's expansion counts against the budget instead of being
  // appended past it. A guarded run never contains two adjacent backticks, so slicing it can at
  // worst leave a single trailing backtick, which cannot re-open a fence.
  const guardedFull = neutralizeFenceRuns(source);
  const truncated = getDiscordTextLength(guardedFull) > budget;
  const guarded = truncated ? truncateDiscordText(guardedFull, budget, "") : guardedFull;

  // Report shownChars in original terms by dropping the zero-width guards,
  //    so "Showing the first X of Y" stays honest even after fence expansion.
  return {
    text: guarded,
    truncated,
    shownChars: getDiscordTextLength(guarded.split(FENCE_GUARD).join("")),
    totalChars,
  };
}

/**
 * Resolves the muted footer describing how much of a preview was cut, if any.
 *
 * @returns The shared truncation footer key, or `undefined` when nothing was cut.
 */
export function textPreviewFooterKey(preview: TextPreview): string | undefined {
  return preview.truncated ? "general.text_preview.truncated_footer" : undefined;
}

/**
 * Builds the interpolation vars for {@link textPreviewFooterKey}.
 *
 * @returns Localizer vars with thousands-separated counts.
 */
export function textPreviewFooterVars(preview: TextPreview, locale: string): Record<string, string> {
  return {
    shown: formatLocaleInteger(preview.shownChars, locale),
    total: formatLocaleInteger(preview.totalChars, locale),
  };
}

/**
 * Ceiling for a fenced panel preview, fence and marker included. Every previewed value has an edit
 * modal that shows the complete text, so the panel only needs enough to recognize it.
 */
export const FENCED_PREVIEW_MAX_CHARS = 500;

export interface FencedPreviewOptions {
  /** Space the caller has left in its message. */
  budget?: number;
  /** Label of the button whose modal shows the complete text, when one does. */
  actionLabel?: string;
}

const fenceMarkdown = (body: string): string => ["```markdown", body, "```"].join("\n");

/**
 * Renders user-authored text as a markdown code block within the smaller of `budget` and
 * {@link FENCED_PREVIEW_MAX_CHARS} codepoints, fence included.
 *
 * Cut text ends in an HTML comment naming how much is hidden. Discord's markdown highlighting
 * colors it like a code comment, so it reads as a marker rather than part of the stored text.
 *
 * @returns The fenced block, or an empty string when the budget cannot hold even the marker,
 *   because cutting a fenced string would drop its closing delimiter and leak the fence into the
 *   rest of the message.
 */
export function renderFencedPreview(
  locale: string,
  text: string,
  { budget = FENCED_PREVIEW_MAX_CHARS, actionLabel }: FencedPreviewOptions = {},
): string {
  const limit = Math.min(budget, FENCED_PREVIEW_MAX_CHARS);
  const guarded = neutralizeFenceRuns(text);
  const full = fenceMarkdown(guarded);
  if (getDiscordTextLength(full) <= limit) return full;

  const totalChars = getDiscordTextLength(text);
  const marker = (hidden: number): string =>
    `<!-- ${localizer(
      locale,
      actionLabel ? "general.text_preview.hidden_marker_action" : "general.text_preview.hidden_marker",
      { count: formatLocaleInteger(hidden, locale), action: actionLabel ?? "" },
    )} -->`;
  // Sizing with the total count reserves the longest marker this text can need, so the marker
  // built from the real hidden count always fits.
  const available = limit - getDiscordTextLength(fenceMarkdown(`\n${marker(totalChars)}`));
  if (available < 0) return "";
  const shown = truncateDiscordText(guarded, available, "").trimEnd();
  const hidden = totalChars - getDiscordTextLength(shown.split(FENCE_GUARD).join(""));
  return fenceMarkdown(shown ? `${shown}\n${marker(hidden)}` : marker(hidden));
}
