import type { TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CUSTOM_IDLE_NUDGE_LIMIT,
  customIdleNudgeInputSchema,
  type CustomIdleNudgeInput,
  type CustomIdleNudgeRow,
  type NaturalNudgeCategory,
} from "@/modules/natural-nudges/db/types";
import { invalidateNaturalNudgeConfigCache } from "@/modules/natural-nudges/runtime/configCache";
import {
  BUILTIN_IDLE_NUDGES,
  CATEGORY_IMPLIED_PREREQUISITES,
  canIdleNudgeBeBlocked,
  customIdleNudgeDefinition,
  findIdleNudgeBlocker,
  isKnownPrerequisite,
  isNudgeToolName,
  type IdleNudgeBlocker,
  type IdleNudgeDefinition,
} from "@/modules/natural-nudges/runtime/idleNudges";
import { loadAvailableToolNames } from "@/modules/natural-nudges/runtime/tools";

export type StudioWriteResult = "success" | "unchanged" | "stale" | "invalid" | "limit" | "write-failed";

export interface StudioEntry {
  definition: IdleNudgeDefinition;
  enabled: boolean;
  custom?: CustomIdleNudgeRow;
  /** Present only on an enabled idle nudge that nothing on this server can run. */
  blocker?: IdleNudgeBlocker;
}

export interface NudgeStudioView {
  category: NaturalNudgeCategory;
  entries: StudioEntry[];
  /** Across every category, because the custom idle nudge limit is per server. */
  customCount: number;
}

/** Text and list fields one custom idle nudge modal submits. */
export interface IdleNudgeForm {
  title: string;
  brief: string;
  agendaHint: string;
  prerequisites: readonly string[];
  recommendedTools: readonly string[];
}

async function personaToolSets(personas: readonly TomoriState[]): Promise<Set<string>[]> {
  const ids = personas.flatMap((persona) => (persona.persona_id ? [persona.persona_id] : []));
  const configs = await naturalNudgeRepository.loadPersonaConfigs(ids);
  const nudging = personas.filter((persona) => (configs.get(persona.persona_id ?? 0)?.talkativeness ?? 0) > 0);
  return Promise.all(nudging.map(loadAvailableToolNames));
}

/**
 * Loads one category's idle nudges. With `personas`, enabled entries are also judged for blockers;
 * modal paths pass null because resolving tools can outlast Discord's three-second window.
 */
export async function loadNudgeStudioView(
  serverId: number,
  category: NaturalNudgeCategory,
  personas: readonly TomoriState[] | null,
): Promise<NudgeStudioView> {
  const [config, customs] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.listCustomIdleNudges(serverId),
  ]);
  const entries: StudioEntry[] = [
    ...BUILTIN_IDLE_NUDGES.filter((definition) => definition.category === category).map((definition) => ({
      definition,
      enabled: !config.disabled_builtin_idle_nudges.includes(definition.key),
    })),
    ...customs
      .filter((custom) => custom.category === category)
      .map((custom) => ({ definition: customIdleNudgeDefinition(custom), enabled: custom.enabled, custom })),
  ];
  const judged = entries.filter((entry) => entry.enabled && canIdleNudgeBeBlocked(entry.definition));
  if (personas && judged.length > 0) {
    const personaTools = await personaToolSets(personas);
    // Skipped when no persona can nudge, because every entry would then read as blocked for the same server-wide reason.
    if (personaTools.length > 0) {
      for (const entry of judged) entry.blocker = findIdleNudgeBlocker(entry.definition, { personaTools }) ?? undefined;
    }
  }
  return { category, entries, customCount: customs.length };
}

/** Drops the prerequisite the category already enforces, so the stored row matches what the modal can show. */
function parseForm(category: NaturalNudgeCategory, form: IdleNudgeForm, enabled: boolean): CustomIdleNudgeInput | null {
  const implied = CATEGORY_IMPLIED_PREREQUISITES[category];
  const prerequisites = [...new Set(form.prerequisites)].filter((id) => id !== implied);
  const recommendedTools = [...new Set(form.recommendedTools)];
  if (!prerequisites.every(isKnownPrerequisite) || !recommendedTools.every(isNudgeToolName)) return null;
  const parsed = customIdleNudgeInputSchema.safeParse({
    category,
    title: form.title,
    brief: form.brief,
    agenda_hint: form.agendaHint.trim() ? form.agendaHint : null,
    prerequisites,
    recommended_tools: recommendedTools,
    enabled,
  });
  return parsed.success ? parsed.data : null;
}

async function findCustom(
  serverId: number,
  category: NaturalNudgeCategory,
  id: number,
): Promise<CustomIdleNudgeRow | null> {
  const customs = await naturalNudgeRepository.listCustomIdleNudges(serverId);
  return customs.find((custom) => custom.custom_idle_nudge_id === id && custom.category === category) ?? null;
}

export const nudgeStudioOperations = {
  async addCustomIdleNudge(
    serverId: number,
    category: NaturalNudgeCategory,
    form: IdleNudgeForm,
  ): Promise<StudioWriteResult> {
    const parsed = parseForm(category, form, true);
    if (!parsed) return "invalid";
    const inserted = await naturalNudgeRepository.insertCustomIdleNudge(serverId, parsed, CUSTOM_IDLE_NUDGE_LIMIT);
    return inserted === "limit" ? "limit" : inserted === "failed" ? "write-failed" : "success";
  },

  async updateCustomIdleNudge(
    serverId: number,
    category: NaturalNudgeCategory,
    id: number,
    form: IdleNudgeForm,
  ): Promise<StudioWriteResult> {
    const custom = await findCustom(serverId, category, id);
    if (!custom) return "stale";
    const parsed = parseForm(category, form, custom.enabled);
    if (!parsed) return "invalid";
    return (await naturalNudgeRepository.updateCustomIdleNudge(serverId, id, parsed)) ? "success" : "write-failed";
  },

  /** Changes only the presented keys: checked ones turn on, the rest off, and entries added since stay as they are. */
  async setIdleNudgeAvailability(
    serverId: number,
    category: NaturalNudgeCategory,
    presented: readonly string[],
    checked: ReadonlySet<string>,
  ): Promise<StudioWriteResult> {
    const [config, customs] = await Promise.all([
      naturalNudgeRepository.loadServerConfig(serverId),
      naturalNudgeRepository.listCustomIdleNudges(serverId),
    ]);
    const disabled = new Set(config.disabled_builtin_idle_nudges);
    const customEnabled = new Map<number, boolean>();
    for (const key of presented) {
      const enabled = checked.has(key);
      if (BUILTIN_IDLE_NUDGES.some((definition) => definition.key === key && definition.category === category)) {
        if (enabled) disabled.delete(key);
        else disabled.add(key);
        continue;
      }
      const custom = customs.find(
        (row) => customIdleNudgeDefinition(row).key === key && row.category === category && row.enabled !== enabled,
      );
      if (custom) customEnabled.set(custom.custom_idle_nudge_id, enabled);
    }
    const builtInsChanged =
      disabled.size !== config.disabled_builtin_idle_nudges.length ||
      config.disabled_builtin_idle_nudges.some((key) => !disabled.has(key));
    if (!builtInsChanged && customEnabled.size === 0) return "unchanged";
    if (!(await naturalNudgeRepository.saveIdleNudgeAvailability(serverId, [...disabled], customEnabled)))
      return "write-failed";
    invalidateNaturalNudgeConfigCache(serverId);
    return "success";
  },

  /** Removes presented custom idle nudges left unchecked that still exist in this category. */
  async removeCustomIdleNudges(
    serverId: number,
    category: NaturalNudgeCategory,
    presentedIds: readonly number[],
    keptIds: ReadonlySet<number>,
  ): Promise<StudioWriteResult> {
    const customs = await naturalNudgeRepository.listCustomIdleNudges(serverId);
    const removed = presentedIds.filter(
      (id) =>
        !keptIds.has(id) &&
        customs.some((custom) => custom.custom_idle_nudge_id === id && custom.category === category),
    );
    if (removed.length === 0) return "unchanged";
    return (await naturalNudgeRepository.deleteCustomIdleNudges(serverId, removed)) === null
      ? "write-failed"
      : "success";
  },
};
