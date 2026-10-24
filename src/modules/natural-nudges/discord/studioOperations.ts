import type { TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CUSTOM_IDLE_NUDGE_LIMIT,
  customIdleNudgeInputSchema,
  type CustomIdleNudgeInput,
  type CustomIdleNudgeRow,
  type IdleNudgeAvailability,
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
  prerequisiteTool,
  type IdleNudgeBlocker,
  type IdleNudgeDefinition,
} from "@/modules/natural-nudges/runtime/idleNudges";
import { loadAvailableToolNames } from "@/modules/natural-nudges/runtime/tools";

export type StudioWriteResult = "success" | "unchanged" | "stale" | "invalid" | "limit" | "write-failed";

export interface StudioEntry {
  definition: IdleNudgeDefinition;
  enabled: boolean;
  custom?: CustomIdleNudgeRow;
  /** Stored persona IDs, deleted personas included; absent when every persona may use it. */
  scope?: readonly number[];
  /** Present only on an enabled idle nudge that nothing on this server can run. */
  blocker?: IdleNudgeBlocker;
}

export interface NudgeStudioView {
  category: NaturalNudgeCategory;
  entries: StudioEntry[];
  /** Across every category, because the custom idle nudge limit is per server. */
  customCount: number;
  /** Live persona nicknames by ID, empty on modal paths that never render rows. */
  personaNames: ReadonlyMap<number, string>;
}

/** Text and list fields one custom idle nudge modal submits. */
export interface IdleNudgeForm {
  title: string;
  brief: string;
  agendaHint: string;
  prerequisites: readonly string[];
  recommendedTools: readonly string[];
}

async function personaToolSets(personas: readonly TomoriState[]): Promise<Map<number, Set<string>>> {
  const ids = personas.flatMap((persona) => (persona.persona_id ? [persona.persona_id] : []));
  const configs = await naturalNudgeRepository.loadPersonaConfigs(ids);
  const nudging = personas.filter((persona) => (configs.get(persona.persona_id ?? 0)?.talkativeness ?? 0) > 0);
  const tools = await Promise.all(nudging.map(loadAvailableToolNames));
  return new Map(nudging.map((persona, index) => [persona.persona_id ?? 0, tools[index]]));
}

/**
 * What a Toggle Availability submit produces: no live persona left turns the idle nudge off, and every
 * live persona opens it to everyone. Only presented personas change, so one created while the modal was
 * open keeps its current access, and IDs of deleted personas are dropped.
 */
export function nextAvailability(
  current: IdleNudgeAvailability,
  livePersonaIds: readonly number[],
  presented: readonly number[],
  checked: ReadonlySet<number>,
): IdleNudgeAvailability {
  const allowed = new Set(current.enabled ? (current.scope ?? livePersonaIds) : []);
  for (const personaId of presented) {
    if (checked.has(personaId)) allowed.add(personaId);
    else allowed.delete(personaId);
  }
  const next = livePersonaIds.filter((personaId) => allowed.has(personaId));
  if (next.length === 0) return { enabled: false };
  return { enabled: true, scope: next.length === livePersonaIds.length ? null : next };
}

function sameAvailability(a: IdleNudgeAvailability, b: IdleNudgeAvailability): boolean {
  if (!a.enabled || !b.enabled) return a.enabled === b.enabled;
  if (!a.scope || !b.scope) return !a.scope && !b.scope;
  const other = b.scope;
  return a.scope.length === other.length && a.scope.every((personaId) => other.includes(personaId));
}

export function entryAvailability(entry: StudioEntry): IdleNudgeAvailability {
  return entry.enabled ? { enabled: true, scope: entry.scope ?? null } : { enabled: false };
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
  const [config, customs, scopes] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.listCustomIdleNudges(serverId),
    naturalNudgeRepository.loadPersonaScopes(serverId),
  ]);
  const withScope = (entry: StudioEntry): StudioEntry => {
    const scope = scopes.get(entry.definition.key);
    return scope ? { ...entry, scope } : entry;
  };
  const entries: StudioEntry[] = [
    ...BUILTIN_IDLE_NUDGES.filter((definition) => definition.category === category).map((definition) =>
      withScope({ definition, enabled: !config.disabled_builtin_idle_nudges.includes(definition.key) }),
    ),
    ...customs
      .filter((custom) => custom.category === category)
      .map((custom) => withScope({ definition: customIdleNudgeDefinition(custom), enabled: custom.enabled, custom })),
  ];
  const judged = entries.filter(
    (entry) => entry.enabled && (entry.scope !== undefined || canIdleNudgeBeBlocked(entry.definition)),
  );
  if (personas && judged.length > 0) {
    const personaTools = await personaToolSets(personas);
    // Skipped when no persona can nudge, because every entry would then read as blocked for the same server-wide reason.
    if (personaTools.size > 0) {
      for (const entry of judged)
        entry.blocker = findIdleNudgeBlocker(entry.definition, { personaTools }, entry.scope) ?? undefined;
    }
  }
  const personaNames = new Map<number, string>();
  for (const persona of personas ?? []) {
    if (persona.persona_id) personaNames.set(persona.persona_id, persona.persona_nickname);
  }
  return { category, entries, customCount: customs.length, personaNames };
}

/**
 * Drops the prerequisite the category already enforces and any recommended tool a prerequisite already
 * requires, so the stored row matches what the modal can show and each tool appears in one field.
 */
function parseForm(category: NaturalNudgeCategory, form: IdleNudgeForm, enabled: boolean): CustomIdleNudgeInput | null {
  const implied = CATEGORY_IMPLIED_PREREQUISITES[category];
  const prerequisites = [...new Set(form.prerequisites)].filter((id) => id !== implied);
  const requiredTools = new Set<string>(prerequisites.flatMap((id) => prerequisiteTool(id) ?? []));
  const recommendedTools = [...new Set(form.recommendedTools)].filter((tool) => !requiredTools.has(tool));
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

  async setIdleNudgeAvailability(
    serverId: number,
    category: NaturalNudgeCategory,
    idleNudgeKey: string,
    livePersonaIds: readonly number[],
    presented: readonly number[],
    checked: ReadonlySet<number>,
  ): Promise<StudioWriteResult> {
    const view = await loadNudgeStudioView(serverId, category, null);
    const entry = view.entries.find((candidate) => candidate.definition.key === idleNudgeKey);
    if (!entry) return "stale";
    const current = entryAvailability(entry);
    const next = nextAvailability(current, livePersonaIds, presented, checked);
    const liveCurrent: IdleNudgeAvailability =
      current.enabled && current.scope
        ? { enabled: true, scope: current.scope.filter((personaId) => livePersonaIds.includes(personaId)) }
        : current;
    if (sameAvailability(liveCurrent, next)) return "unchanged";
    const customId = entry.custom?.custom_idle_nudge_id ?? null;
    if (!(await naturalNudgeRepository.saveIdleNudgeAvailability(serverId, idleNudgeKey, customId, next)))
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
