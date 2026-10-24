import { computePersonaNudgeFingerprint } from "@/modules/natural-nudges/db/types";
import type { TomoriState } from "@/types/db/schema";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CUSTOM_IDLE_NUDGE_LIMIT,
  PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX,
  customIdleNudgeInputSchema,
  personaAuthoredIdleNudgeDraftSchema,
  type CustomIdleNudgeInput,
  type CustomIdleNudgeRow,
  type IdleNudgeAvailability,
  type NaturalNudgeCategory,
  type PersonaAuthoredIdleNudge,
  type PersonaAuthoredIdleNudgeDraft,
  type PersonaNaturalNudgeConfig,
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
  listPersonaIdleNudges,
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

/** The portable fields a form modal prefills and a persona-owned nudge stores. */
export interface IdleNudgeFormContent {
  category: NaturalNudgeCategory;
  title: string;
  brief: string;
  agenda_hint: string | null;
  prerequisites: readonly string[];
  recommended_tools: readonly string[];
}

export function idleNudgeContentFromCustom(custom: CustomIdleNudgeRow): IdleNudgeFormContent {
  return {
    category: custom.category,
    title: custom.title,
    brief: custom.brief,
    agenda_hint: custom.agenda_hint,
    prerequisites: custom.prerequisites,
    recommended_tools: custom.recommended_tools,
  };
}

export function idleNudgeContentFromAuthored(nudge: PersonaAuthoredIdleNudge): IdleNudgeFormContent {
  return {
    category: nudge.category,
    title: nudge.title,
    brief: nudge.brief,
    agenda_hint: nudge.agenda_hint,
    prerequisites: nudge.prerequisites,
    recommended_tools: nudge.recommended_tools,
  };
}

export function idleNudgeContentFromDefinition(definition: IdleNudgeDefinition): IdleNudgeFormContent {
  return {
    category: definition.category,
    title: definition.title ?? "",
    brief: definition.brief,
    agenda_hint: definition.agendaHint,
    prerequisites: definition.prerequisites,
    recommended_tools: definition.recommendedTools,
  };
}

/** Local ID within its owner's list, which the runtime key carries after the persona instance ID. */
export function personaNudgeLocalId(definition: IdleNudgeDefinition): string | null {
  const personaId = definition.ownerPersonaId;
  if (personaId === undefined) return null;
  const prefix = `${PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX}${personaId}:`;
  return definition.key.startsWith(prefix) ? definition.key.slice(prefix.length) : null;
}

/**
 * Loads the form's own fields and drops the prerequisite the category already enforces and any
 * recommended tool a prerequisite already requires.
 */
export function parseIdleNudgeForm(
  category: NaturalNudgeCategory,
  form: IdleNudgeForm,
): PersonaAuthoredIdleNudgeDraft | null {
  const implied = CATEGORY_IMPLIED_PREREQUISITES[category];
  const prerequisites = [...new Set(form.prerequisites)].filter((id) => id !== implied);
  const requiredTools = new Set<string>(prerequisites.flatMap((id) => prerequisiteTool(id) ?? []));
  const recommendedTools = [...new Set(form.recommendedTools)].filter((tool) => !requiredTools.has(tool));
  if (!prerequisites.every(isKnownPrerequisite) || !recommendedTools.every(isNudgeToolName)) return null;
  const parsed = personaAuthoredIdleNudgeDraftSchema.safeParse({
    category,
    title: form.title,
    brief: form.brief,
    agenda_hint: form.agendaHint.trim() ? form.agendaHint : null,
    prerequisites,
    recommended_tools: recommendedTools,
  });
  return parsed.success ? parsed.data : null;
}

async function loadPersonaToolSets(
  personas: readonly TomoriState[],
  configs: ReadonlyMap<number, PersonaNaturalNudgeConfig>,
  extraPersonaIds: ReadonlySet<number>,
): Promise<Map<number, Set<string>>> {
  const targets = personas.filter((persona) => {
    const personaId = persona.persona_id;
    if (!personaId) return false;
    return (configs.get(personaId)?.talkativeness ?? 0) > 0 || extraPersonaIds.has(personaId);
  });
  const tools = await Promise.all(targets.map(loadAvailableToolNames));
  return new Map(targets.map((persona, index) => [persona.persona_id ?? 0, tools[index]]));
}

/** Blockers for one persona's own enabled entries, judged against that owner plus every nudging persona as a scene partner. */
export interface PersonaNudgeBlockerView {
  blockers: ReadonlyMap<string, IdleNudgeBlocker>;
}

export async function loadPersonaNudgeBlockerView(
  persona: TomoriState,
  personas: readonly TomoriState[],
  config: PersonaNaturalNudgeConfig,
): Promise<PersonaNudgeBlockerView> {
  const personaId = persona.persona_id;
  const entries = listPersonaIdleNudges(personaId ?? 0, config).filter(
    (entry) => entry.enabled && canIdleNudgeBeBlocked(entry.definition),
  );
  if (!personaId || entries.length === 0) return { blockers: new Map() };
  const ids = personas.flatMap((candidate) => (candidate.persona_id ? [candidate.persona_id] : []));
  const configs = await naturalNudgeRepository.loadPersonaConfigs(ids);
  const toolSets = await loadPersonaToolSets(personas, configs, new Set([personaId]));
  const blockers = new Map<string, IdleNudgeBlocker>();
  for (const entry of entries) {
    const blocker = findIdleNudgeBlocker(entry.definition, { personaTools: toolSets }, [personaId]);
    if (blocker) blockers.set(entry.definition.key, blocker);
  }
  return { blockers };
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

function entryAvailability(entry: StudioEntry): IdleNudgeAvailability {
  return entry.enabled ? { enabled: true, scope: entry.scope ?? null } : { enabled: false };
}

/**
 * Loads one category's idle nudges from every source. With `personas`, enabled entries are also
 * judged for blockers; modal paths pass the list with `judgeBlockers: false` because resolving tools
 * can outlast Discord's three-second window.
 */
export async function loadNudgeStudioView(
  serverId: number,
  category: NaturalNudgeCategory,
  personas: readonly TomoriState[] | null,
  options: { judgeBlockers?: boolean } = {},
): Promise<NudgeStudioView> {
  const personaIds = (personas ?? []).flatMap((persona) => (persona.persona_id ? [persona.persona_id] : []));
  const [config, customs, scopes, personaConfigs] = await Promise.all([
    naturalNudgeRepository.loadServerConfig(serverId),
    naturalNudgeRepository.listCustomIdleNudges(serverId),
    naturalNudgeRepository.loadPersonaScopes(serverId),
    personaIds.length > 0 ? naturalNudgeRepository.loadPersonaConfigs(personaIds) : Promise.resolve(new Map()),
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
  const personaEntries = (personas ?? []).flatMap((persona) => {
    const personaId = persona.persona_id;
    if (!personaId) return [];
    return listPersonaIdleNudges(personaId, personaConfigs.get(personaId))
      .filter((entry) => entry.definition.category === category)
      .map((entry) => ({ definition: entry.definition, enabled: entry.enabled }));
  });
  entries.push(...personaEntries);
  if (personas && options.judgeBlockers !== false) {
    const ownerIds = new Set(
      personaEntries.flatMap((entry) =>
        entry.enabled && canIdleNudgeBeBlocked(entry.definition) ? [entry.definition.ownerPersonaId as number] : [],
      ),
    );
    const toolSets = await loadPersonaToolSets(personas, personaConfigs, ownerIds);
    const nudgingIds = new Set(
      personas.flatMap((persona) =>
        (personaConfigs.get(persona.persona_id ?? 0)?.talkativeness ?? 0) > 0 ? [persona.persona_id as number] : [],
      ),
    );
    const serverTools = new Map([...toolSets].filter(([personaId]) => nudgingIds.has(personaId)));
    // Skipped when no persona can nudge, because every server entry would then read as blocked for the same server-wide reason.
    if (serverTools.size > 0) {
      for (const entry of entries) {
        if (!entry.enabled || entry.definition.ownerPersonaId !== undefined) continue;
        if (entry.scope === undefined && !canIdleNudgeBeBlocked(entry.definition)) continue;
        entry.blocker = findIdleNudgeBlocker(entry.definition, { personaTools: serverTools }, entry.scope) ?? undefined;
      }
    }
    for (const entry of entries) {
      const ownerId = entry.definition.ownerPersonaId;
      if (!entry.enabled || ownerId === undefined || !canIdleNudgeBeBlocked(entry.definition)) continue;
      entry.blocker = findIdleNudgeBlocker(entry.definition, { personaTools: toolSets }, [ownerId]) ?? undefined;
    }
  }
  const personaNames = new Map<number, string>();
  for (const persona of personas ?? []) {
    if (persona.persona_id) personaNames.set(persona.persona_id, persona.persona_nickname);
  }
  return { category, entries, customCount: customs.length, personaNames };
}

function parseCustomForm(
  category: NaturalNudgeCategory,
  form: IdleNudgeForm,
  enabled: boolean,
): CustomIdleNudgeInput | null {
  const draft = parseIdleNudgeForm(category, form);
  if (!draft) return null;
  const parsed = customIdleNudgeInputSchema.safeParse({ ...draft, enabled });
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
    const parsed = parseCustomForm(category, form, true);
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
    const parsed = parseCustomForm(category, form, custom.enabled);
    if (!parsed) return "invalid";
    return (await naturalNudgeRepository.updateCustomIdleNudge(serverId, id, parsed)) ? "success" : "write-failed";
  },

  /** Edits one persona-owned definition in place, after the owner is checked against the current live set. */
  async updatePersonaIdleNudge(
    category: NaturalNudgeCategory,
    livePersonaIds: readonly number[],
    ownerPersonaId: number,
    idleNudgeId: string,
    fp: string,
    form: IdleNudgeForm,
  ): Promise<StudioWriteResult> {
    if (!livePersonaIds.includes(ownerPersonaId)) return "stale";
    const config = (await naturalNudgeRepository.loadPersonaConfigs([ownerPersonaId])).get(ownerPersonaId);
    if (!config) return "stale";
    const entry = listPersonaIdleNudges(ownerPersonaId, config).find(
      (candidate) =>
        candidate.definition.key === `${PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX}${ownerPersonaId}:${idleNudgeId}`,
    );
    if (!entry || entry.definition.category !== category) return "stale";
    if (computePersonaNudgeFingerprint(ownerPersonaId, idleNudgeContentFromDefinition(entry.definition)) !== fp)
      return "stale";
    const draft = parseIdleNudgeForm(category, form);
    if (!draft) return "invalid";
    const result = await naturalNudgeRepository.updatePersonaIdleNudge(ownerPersonaId, idleNudgeId, draft);
    return result === "success" || result === "unchanged" ? result : result === "invalid" ? "invalid" : "stale";
  },

  /** Flips only the owner's local switch, which never snapshots an inherited list or forks a pointer. */
  async setPersonaIdleNudgeAvailability(
    category: NaturalNudgeCategory,
    livePersonaIds: readonly number[],
    ownerPersonaId: number,
    idleNudgeId: string,
    enabled: boolean,
  ): Promise<StudioWriteResult> {
    if (!livePersonaIds.includes(ownerPersonaId)) return "stale";
    const config = (await naturalNudgeRepository.loadPersonaConfigs([ownerPersonaId])).get(ownerPersonaId);
    if (!config) return "stale";
    const entry = listPersonaIdleNudges(ownerPersonaId, config).find(
      (candidate) =>
        candidate.definition.key === `${PERSONA_AUTHORED_IDLE_NUDGE_KEY_PREFIX}${ownerPersonaId}:${idleNudgeId}`,
    );
    if (!entry || entry.definition.category !== category) return "stale";
    const result = await naturalNudgeRepository.setPersonaIdleNudgeAvailability(ownerPersonaId, idleNudgeId, enabled);
    return result === "success" || result === "unchanged" ? result : result === "invalid" ? "invalid" : "stale";
  },

  /** Removes only presented persona entries whose owner is still live, one stable ID at a time. */
  async removePersonaIdleNudges(
    category: NaturalNudgeCategory,
    livePersonaIds: readonly number[],
    presented: ReadonlyArray<{ ownerPersonaId: number; idleNudgeId: string; fp: string }>,
    keptKeys: ReadonlySet<string>,
  ): Promise<StudioWriteResult> {
    const targets = presented.filter(
      ({ ownerPersonaId, idleNudgeId }) =>
        !keptKeys.has(`${ownerPersonaId}:${idleNudgeId}`) && livePersonaIds.includes(ownerPersonaId),
    );
    if (targets.length === 0) return "unchanged";
    const configs = await naturalNudgeRepository.loadPersonaConfigs([
      ...new Set(targets.map((target) => target.ownerPersonaId)),
    ]);
    for (const { ownerPersonaId, idleNudgeId, fp } of targets) {
      const nudge = configs.get(ownerPersonaId)?.idle_nudges.find((nudge) => nudge.id === idleNudgeId);
      if (!nudge || nudge.category !== category || computePersonaNudgeFingerprint(ownerPersonaId, nudge) !== fp)
        return "stale";
    }
    let removed = 0;
    for (const { ownerPersonaId, idleNudgeId, fp } of targets) {
      const result = await naturalNudgeRepository.removePersonaIdleNudge(ownerPersonaId, idleNudgeId, fp);
      if (result === "write-failed" || result === "invalid") return "write-failed";
      if (result === "stale") return "stale";
      if (result === "success") removed++;
    }
    return removed > 0 ? "success" : "unchanged";
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
    if (!entry || entry.definition.ownerPersonaId !== undefined) return "stale";
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
