import { getLocaleStringList, getSupportedLocales } from "@/utils/text/localizer";
import { isUnspacedScriptText } from "@/utils/text/processors/regexUtils";
import type { DeliberateToolTriggerTarget } from "@/utils/tools/deliberateToolMode";

// Full literals rather than a prefix plus target: the locale checker and the unused-key report only
// recognize complete key strings, so a built key would read as missing and its lists as deletable.
export const DELIBERATE_TOOL_PACK_KEYS = {
  image: "tools.intent_packs.deliberate.image",
  video: "tools.intent_packs.deliberate.video",
  voice: "tools.intent_packs.deliberate.voice",
  reminder: "tools.intent_packs.deliberate.reminder",
  "cross-channel": "tools.intent_packs.deliberate.cross-channel",
  search: "tools.intent_packs.deliberate.search",
  memory: "tools.intent_packs.deliberate.memory",
  "media-analysis": "tools.intent_packs.deliberate.media-analysis",
  "message-action": "tools.intent_packs.deliberate.message-action",
  "user-blocking": "tools.intent_packs.deliberate.user-blocking",
  "user-info": "tools.intent_packs.deliberate.user-info",
  thread: "tools.intent_packs.deliberate.thread",
  capabilities: "tools.intent_packs.deliberate.capabilities",
} as const satisfies Record<DeliberateToolTriggerTarget, string>;

export const EXPLICIT_MEMORY_PACK_KEY = "tools.intent_packs.explicit_memory";

const ALL_INTENT_PACK_KEYS: readonly string[] = [...Object.values(DELIBERATE_TOOL_PACK_KEYS), EXPLICIT_MEMORY_PACK_KEY];

// A trailing "*" is the only pack syntax. Everything else a regex would interpret is rejected so a
// translator cannot author an entry (such as the "^" custom-trigger wildcard) that matches everything.
const REGEX_SYNTAX_PATTERN = /[\\^$.|?+()[\]{}]|\*(?!$)/;

export type IntentPackEntryProblem = "empty" | "regex_syntax" | "too_short";

export interface IntentPackViolation {
  locale: string;
  key: string;
  entry: string;
  problem: IntentPackEntryProblem;
}

export function getIntentPackEntryProblem(entry: string): IntentPackEntryProblem | null {
  const trimmed = entry.trim();
  const literal = trimmed.replace(/\*$/, "");
  if (!literal) return "empty";
  if (REGEX_SYNTAX_PATTERN.test(trimmed)) return "regex_syntax";
  // A substring match on a single ideograph or syllable would fire on most messages in that script.
  if (isUnspacedScriptText(literal) && [...literal].length < 2) return "too_short";
  return null;
}

export function findIntentPackViolations(
  keys: readonly string[] = ALL_INTENT_PACK_KEYS,
  localeCodes: readonly string[] = getSupportedLocales(),
): IntentPackViolation[] {
  const violations: IntentPackViolation[] = [];
  for (const locale of localeCodes) {
    for (const key of keys) {
      for (const entry of getLocaleStringList(locale, key) ?? []) {
        const problem = getIntentPackEntryProblem(entry);
        if (problem) violations.push({ locale, key, entry, problem });
      }
    }
  }
  return violations;
}

const unionCache = new Map<string, string[]>();

/**
 * Validates every authored pack and precomputes the unions. It runs inside localizer initialization,
 * so a malformed translator entry fails startup instead of silently changing matching under traffic.
 */
export function initializeIntentPacks(): void {
  const violations = findIntentPackViolations();
  if (violations.length > 0) {
    const details = violations
      .map((violation) => `${violation.locale} ${violation.key} "${violation.entry}" (${violation.problem})`)
      .join("; ");
    throw new Error(`Invalid intent pack entries: ${details}`);
  }

  unionCache.clear();
  for (const key of ALL_INTENT_PACK_KEYS) {
    getIntentPackUnion(key);
  }
}

/**
 * Every authored locale's entries for one pack, deduplicated. The union ignores the user's language
 * preference: members of a bilingual server type in either language, and a user with no stored
 * preference resolves to en-US.
 */
export function getIntentPackUnion(key: string): string[] {
  const cached = unionCache.get(key);
  if (cached) return cached;

  const localeCodes = getSupportedLocales();
  const union = [
    ...new Set(localeCodes.flatMap((locale) => (getLocaleStringList(locale, key) ?? []).map((entry) => entry.trim()))),
  ];
  // Before the localizer initializes there are no locales to read; caching then would pin an empty pack.
  if (localeCodes.length > 0) unionCache.set(key, union);
  return union;
}
