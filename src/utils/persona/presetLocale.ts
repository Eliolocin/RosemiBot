import { LOCALE_ALIASES } from "@/constants/locales";
import type { TomoriPresetRow } from "@/types/db/schema";

/**
 * Languages a preset may fall back to for a locale, most preferred first. Commands pass the raw
 * Discord locale, so an aliased one (`es-ES`) must map to the language the catalog seeds (`es-419`).
 */
export function presetFallbackLanguages(locale: string): string[] {
  const authoredLocale = LOCALE_ALIASES[locale as keyof typeof LOCALE_ALIASES] ?? locale;
  const baseLanguage = authoredLocale.split("-")[0];
  return [...new Set([authoredLocale, baseLanguage, "en-US"])];
}

/**
 * Picks one variant per preset lineage in the most preferred language that exists, so a preset that is
 * only partly translated stays reachable instead of disappearing behind the locale's other presets.
 * `nsfw` selects one side of the flag: SFW routes never offer NSFW presets because only the
 * age-restricted `/nsfw` routes may, and the `/nsfw` listing offers nothing else.
 *
 * Rows without a lineage cannot be matched across languages, so they keep the whole-locale rule: they
 * appear only when their language is the most preferred one among the lineage-less rows. Linked rows
 * do not count toward that choice, or a translated official preset would hide every untranslated
 * custom one.
 *
 * @param rows - Candidate rows in any of {@link presetFallbackLanguages}
 */
export function selectPresetsForLocale(
  rows: readonly TomoriPresetRow[],
  locale: string,
  options: { nsfw: boolean },
): TomoriPresetRow[] {
  const languages = presetFallbackLanguages(locale);
  const rank = (row: TomoriPresetRow) => languages.indexOf(row.preset_language);
  const candidates = rows.filter((row) => rank(row) !== -1 && row.is_nsfw === options.nsfw);

  const bestByLineage = new Map<number, TomoriPresetRow>();
  const unlinked: TomoriPresetRow[] = [];
  for (const row of candidates) {
    if (row.preset_lineage_id === null || row.preset_lineage_id === undefined) {
      unlinked.push(row);
      continue;
    }
    // Bun returns BIGINT columns as strings at runtime despite the row type, so normalize the key.
    const lineageId = Number(row.preset_lineage_id);
    const current = bestByLineage.get(lineageId);
    if (!current || rank(row) < rank(current)) bestByLineage.set(lineageId, row);
  }

  const unlinkedLanguage = languages.find((language) => unlinked.some((row) => row.preset_language === language));
  const selected = [...bestByLineage.values(), ...unlinked.filter((row) => row.preset_language === unlinkedLanguage)];
  return selected.sort((left, right) => left.persona_preset_name.localeCompare(right.persona_preset_name));
}
