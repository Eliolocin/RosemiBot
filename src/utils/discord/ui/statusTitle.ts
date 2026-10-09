import type { ColorResolvable } from "discord.js";
import { resolveAccentColor, type AccentColorInput } from "@/utils/discord/ui/panel";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Status circles on embed and notice titles.
 *
 * The circle is a property of the surface the title sits on, not of the locale string, so a title
 * can never contradict the color next to it. Locale authors write the bare title ("Import Failed")
 * and these helpers prepend the circle the color implies. Every helper strips a circle the locale
 * already carries, so an untranslated or stale value cannot render two markers.
 */

/** Tones that own a circle. Other colors (info, section, affection, memory update) stay bare. */
export type StatusTone = "error" | "warning" | "success";

const STATUS_CIRCLE_BY_TONE: Record<StatusTone, string> = {
  error: "🔴",
  warning: "🟡",
  success: "🟢",
};

/**
 * Only the tones a title is allowed to claim.
 *
 * `RATE_LIMIT` and the remaining `ColorCode` entries are deliberately absent: no status title
 * renders on them, so mapping them would invent a convention nothing follows.
 */
const STATUS_TONE_BY_COLOR = new Map<number, StatusTone>([
  [resolveAccentColor(ColorCode.ERROR), "error"],
  [resolveAccentColor(ColorCode.WARN), "warning"],
  [resolveAccentColor(ColorCode.SUCCESS), "success"],
]);

/**
 * A leading circle, with or without the variation selector some authored values carry
 * (`🟡️` is `🟡` followed by U+FE0F), plus any space that separated it from the text.
 */
const LEADING_STATUS_CIRCLE = new RegExp(
  `^(?:${Object.values(STATUS_CIRCLE_BY_TONE).join("|")})\\uFE0F?[\\s\\u00A0]*`,
  "u",
);

/**
 * Any other leading emoji means the title already carries its own marker (`⏳`, `✅`, `⚠️`), and a
 * circle beside it would read as two markers. Those titles keep the emoji their author chose.
 */
const LEADING_EMOJI = /^\p{Extended_Pictographic}/u;

/** Removes a leading status circle. Used by the embed protocol, which matches persisted titles. */
export function stripStatusCircle(title: string): string {
  return title.replace(LEADING_STATUS_CIRCLE, "");
}

/** The tone a surface color speaks for, or null when that color carries no circle. */
export function resolveStatusTone(color?: ColorResolvable | null): StatusTone | null {
  if (color === undefined || color === null) return null;
  // ColorResolvable is a superset of AccentColorInput; resolveAccentColor falls back to info for
  // shapes it cannot parse, so an unmappable color simply yields no tone.
  return STATUS_TONE_BY_COLOR.get(resolveAccentColor(color as AccentColorInput)) ?? null;
}

/** Renders an already-localized title with the circle its surface color implies. */
export function withStatusCircle(title: string, color?: ColorResolvable | null): string {
  const bare = stripStatusCircle(title).trim();
  const tone = resolveStatusTone(color);
  if (!tone || bare.length === 0 || LEADING_EMOJI.test(bare)) return bare;
  return `${STATUS_CIRCLE_BY_TONE[tone]} ${bare}`;
}

/**
 * Titles open with multi-code-point emoji (`👁️`, `🗑️`), so stopping at the first pictograph would
 * strand a variation selector or joiner in front of the title, which Discord renders as a blank box.
 */
const LEADING_EMOJI_RUN = /^(?:\p{Extended_Pictographic}(?:️|‍|\p{Emoji_Modifier})*)+[\s ]*/u;

/**
 * Removes a leading emoji marker of any kind. The embed protocol normalizes with this because a
 * Minimal notice renders its title without the emoji a Verbose one carries, and both must classify.
 */
export function stripLeadingEmoji(title: string): string {
  return title.replace(LEADING_EMOJI_RUN, "");
}

/**
 * Localizes a Minimal notice title: no leading emoji and no status circle, so the accent color is
 * the only marker. The emoji is measured on the uninterpolated template, so a persona nickname that
 * happens to open the title with its own emoji keeps it.
 */
export function localizedMinimalTitle(
  locale: string,
  titleKey: string,
  titleVars?: Record<string, string | number | boolean>,
): string {
  const marker = localizer(locale, titleKey).match(LEADING_EMOJI_RUN)?.[0] ?? "";
  const title = localizer(locale, titleKey, titleVars);
  return (title.startsWith(marker) ? title.slice(marker.length) : title).trim();
}

/** Localizes a status title and renders it with the circle its surface color implies. */
export function localizedStatusTitle(
  locale: string,
  titleKey: string,
  color?: ColorResolvable | null,
  titleVars?: Record<string, string | number | boolean>,
): string {
  return withStatusCircle(localizer(locale, titleKey, titleVars), color);
}
