import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hasLocaleKey, localizer } from "@/utils/text/localizer";

/**
 * Every locale directory under `src/locales`. Read from disk rather than `getSupportedLocales()`
 * because test cases are enumerated at module load, before `initializeLocalizer()` runs in
 * `beforeAll`.
 */
export const RUNTIME_LOCALES: readonly string[] = readdirSync(join(process.cwd(), "src", "locales"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const MAX_REPORTED_FAILURES = 20;

/**
 * Whitespace inside localized prose may come back as a runtime line wrap, optionally followed by
 * the `-# ` or `> ` prefix `withLinePrefix` repeats on every wrapped line. The escaped `\\n` form
 * covers assertions made against `JSON.stringify(payload)`.
 */
const WRAPPED_WHITESPACE = String.raw`(?:\s|\\n)+(?:(?:-# |> )(?:\s)*)?`;

type CopyVariables = Record<string, string | number>;

/**
 * Resolve a locale key for an assertion, so a copy edit cannot fail the test while a wrong key
 * still does. Throws on an unknown key: `localizer` returns the key itself, and the code under
 * test would render that same key, so a deleted key would otherwise pass.
 */
export function localizedCopy(locale: string, key: string, variables: CopyVariables = {}): string {
  if (!hasLocaleKey(locale, key)) throw new Error(`Unknown locale key in assertion: ${locale} ${key}`);
  return localizer(locale, key, variables);
}

/**
 * Match a localized string as rendered in a panel, where `formatPanelProse` may have wrapped it.
 * A placeholder left out of `variables` matches any text, for counts and names the test does not
 * pin, which also lets an absence assertion cover every value of that placeholder.
 */
export function localizedProse(locale: string, key: string, variables: CopyVariables = {}): RegExp {
  const words = localizedCopy(locale, key, variables).trim().split(/\s+/).map(proseWordPattern);
  return new RegExp(words.join(WRAPPED_WHITESPACE), "u");
}

/** Japanese and Chinese have no spaces, so `formatPanelProse` may wrap between any two of their characters. */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const OPTIONAL_WRAP = String.raw`(?:(?:\n|\\n)(?:(?:-# |> )(?:\s)*)?)?`;

function proseWordPattern(word: string): string {
  const parts = (word.match(/\{\w+\}|./gsu) ?? []).map((part) =>
    /^\{\w+\}$/.test(part) ? ".+?" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, String.raw`\\?"`),
  );
  return parts.join(UNSPACED_SCRIPT.test(word) ? OPTIONAL_WRAP : "");
}

/**
 * Runs many labeled checks inside one test and reports every failing label together, so a locale
 * or fixture matrix costs one test case instead of one per combination.
 */
export interface CaseFailureCollector {
  check(label: string, run: () => void): void;
  expectNoFailures(): void;
}

/**
 * Create a collector whose `expectNoFailures()` fails with the first failing labels and the total.
 */
export function collectCaseFailures(): CaseFailureCollector {
  const failures: string[] = [];
  let checked = 0;
  return {
    check(label, run) {
      checked++;
      try {
        run();
      } catch (error) {
        failures.push(`${label}: ${Bun.stripANSI(error instanceof Error ? error.message : String(error))}`);
      }
    },
    expectNoFailures() {
      if (failures.length === 0) return;
      const shown = failures.slice(0, MAX_REPORTED_FAILURES).join("\n\n");
      const hidden = failures.length - MAX_REPORTED_FAILURES;
      throw new Error(
        `${failures.length} of ${checked} cases failed:\n\n${shown}${hidden > 0 ? `\n\n...and ${hidden} more` : ""}`,
      );
    },
  };
}

/**
 * Run one check per locale inside the calling test and report every failing locale together.
 */
export function expectForEveryLocale(
  check: (locale: string) => void,
  locales: readonly string[] = RUNTIME_LOCALES,
): void {
  const cases = collectCaseFailures();
  for (const locale of locales) cases.check(locale, () => check(locale));
  cases.expectNoFailures();
}
