import { NOTICE_CONFIG_HINT_KEY } from "@/constants/toolNotices";
import { localizer } from "@/utils/text/localizer";

/**
 * Resolves a notice's footer into display lines, the notice's own footer first and the shared
 * `/config` hint last, so the hint reads as the same closing line on every hideable notice.
 *
 * @param configHint - Whether the notice can be hidden from `/config` > Behavior > Notices.
 */
export function resolveFooterLines(
  locale: string,
  footerKey: string | undefined,
  footerVars: Record<string, string | number | boolean> | undefined,
  configHint: boolean | undefined,
): string[] {
  const lines: string[] = [];
  if (footerKey) lines.push(localizer(locale, footerKey, footerVars));
  if (configHint) lines.push(localizer(locale, NOTICE_CONFIG_HINT_KEY));
  return lines;
}
