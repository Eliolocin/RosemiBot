import { describe, expect, it } from "bun:test";
import {
  BUILTIN_IDLE_NUDGES,
  findIdleNudgeBlocker,
  findMissingIdleNudgeTool,
  findPersonaRunnableIdleNudge,
  idleNudgeNeedsTarget,
  idleNudgeSource,
  isIdleNudgeEligible,
  isInPersonaScope,
  listPersonaIdleNudges,
  listPersonaRunnableIdleNudges,
  listRunnableIdleNudges,
  NUDGE_TOOL_NAMES,
  type IdleNudgeDefinition,
  type IdleNudgeSelectionSources,
} from "@/modules/natural-nudges/runtime/idleNudges";
import {
  CATEGORY_IMPLIED_PREREQUISITES,
  personaAuthoredIdleNudgesSchema,
  personaAuthoredIdleNudgeSchema,
  prerequisiteTool,
  type PersonaAuthoredIdleNudge,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import { personaSections } from "@/db/seed/catalog/personas";
import { PRESET_NATURAL_NUDGE_DEFAULTS } from "@/db/seed/catalog/personas/naturalNudges";
import { getTool } from "@/tools/toolRegistry";
import { initializeTools } from "@/tools/toolInitializer";
import { createCustomIdleNudge } from "../../helpers/fixtures";

const OWNER_ID = 5;
const OTHER_ID = 6;

function authoredNudge(overrides: Partial<PersonaAuthoredIdleNudge> = {}): PersonaAuthoredIdleNudge {
  return personaAuthoredIdleNudgeSchema.parse({
    id: "quiet-hour",
    category: "start_topic",
    title: "Quiet hour",
    brief: "Ask what everyone is doing later.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
    ...overrides,
  });
}

function personaConfig(
  personaId: number,
  overrides: Partial<PersonaNaturalNudgeConfig> = {},
): PersonaNaturalNudgeConfig {
  return {
    persona_id: personaId,
    talkativeness: 2,
    interests: [],
    idle_nudges: [],
    disabled_idle_nudge_ids: [],
    has_override: true,
    idle_nudges_override: true,
    idle_nudges_inherited: false,
    ...overrides,
  };
}

function selectionSources(
  personaId: number,
  personaConfigForPersona: PersonaNaturalNudgeConfig | undefined,
  overrides: Partial<IdleNudgeSelectionSources> = {},
): IdleNudgeSelectionSources {
  return {
    personaId,
    disabledBuiltIns: [],
    customIdleNudges: [],
    scopes: new Map(),
    personaConfig: personaConfigForPersona,
    ...overrides,
  };
}

function personaKeys(personaId: number, config: PersonaNaturalNudgeConfig | undefined): string[] {
  return listPersonaRunnableIdleNudges(selectionSources(personaId, config))
    .filter((idleNudge) => idleNudgeSource(idleNudge) === "persona")
    .map((idleNudge) => idleNudge.key);
}

function idleNudge(
  prerequisites: string[],
  category: IdleNudgeDefinition["category"] = "start_topic",
): IdleNudgeDefinition {
  return {
    key: "custom:9",
    category,
    brief: "brief",
    agendaHint: null,
    prerequisites,
    recommendedTools: [],
    builtIn: false,
  };
}

describe("idle nudge eligibility", () => {
  const noFacts = {
    hasHangingConversation: false,
    hasScenePartner: false,
    availableTools: new Set<string>(),
    target: null,
  };
  const quietTarget = { ...noFacts, target: { hasRecentMemories: false, isActive: false } };

  it("treats a prerequisite the registry no longer knows as unmet", () => {
    expect(isIdleNudgeEligible(idleNudge(["birthday_today"]), noFacts)).toBe(false);
  });

  it("needs a drawn target for every Ping User nudge, even a custom one that omits relationship_user", () => {
    expect(isIdleNudgeEligible(idleNudge([], "ping_user"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(idleNudge([], "ping_user"), quietTarget)).toBe(true);
    expect(isIdleNudgeEligible(idleNudge(["relationship_user"]), noFacts)).toBe(false);
  });

  it("draws a target for any idle nudge that asks about one, whatever its category", () => {
    expect(idleNudgeNeedsTarget(idleNudge(["presence_activity"]))).toBe(true);
    expect(idleNudgeNeedsTarget(idleNudge(["recent_memory"], "revive_topic"))).toBe(true);
    expect(idleNudgeNeedsTarget(idleNudge(["tool:web_search"]))).toBe(false);
  });

  it("reads recent_memory and presence_activity from the drawn target", () => {
    const callback = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "ping_user.memory_callback");
    const poke = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "ping_user.presence_poke");
    if (!callback || !poke) throw new Error("Ping User nudge built-ins missing");
    expect(isIdleNudgeEligible(callback, quietTarget)).toBe(false);
    expect(isIdleNudgeEligible(poke, quietTarget)).toBe(false);
    const busyTarget = { ...noFacts, target: { hasRecentMemories: true, isActive: true } };
    expect(isIdleNudgeEligible(callback, busyTarget)).toBe(true);
    expect(isIdleNudgeEligible(poke, busyTarget)).toBe(true);
  });

  it("accepts either image generator for the image prerequisite", () => {
    const facts = { ...noFacts, availableTools: new Set(["generate_image_nai"]) };
    expect(isIdleNudgeEligible(idleNudge(["tool:image"]), facts)).toBe(true);
    expect(isIdleNudgeEligible(idleNudge(["tool:image"]), noFacts)).toBe(false);
  });

  it("needs a hanging conversation for every Revive Topic, even a custom one that omits hanging_conversation", () => {
    const hanging = { ...noFacts, hasHangingConversation: true };
    expect(isIdleNudgeEligible(idleNudge([], "revive_topic"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(idleNudge([], "revive_topic"), hanging)).toBe(true);
  });

  it("needs a scene partner for every Play Scene, even a custom one that omits two_personas", () => {
    const partnered = { ...noFacts, hasScenePartner: true };
    expect(isIdleNudgeEligible(idleNudge([], "play_scene"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(idleNudge([], "play_scene"), partnered)).toBe(true);
    expect(isIdleNudgeEligible(idleNudge(["two_personas"]), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(idleNudge(["two_personas"]), partnered)).toBe(true);
  });
});

describe("idle nudge blockers", () => {
  const tools = (...names: string[]) => new Set(names);
  /** Persona IDs follow argument order, starting at 1. */
  const facts = (...personaTools: Set<string>[]) => ({
    personaTools: new Map(personaTools.map((available, index) => [index + 1, available])),
  });

  it("blocks a scene until two personas can nudge", () => {
    expect(findIdleNudgeBlocker(idleNudge([], "play_scene"), facts(tools()))).toEqual({ kind: "two_personas" });
    expect(findIdleNudgeBlocker(idleNudge(["two_personas"]), facts(tools()))).toEqual({ kind: "two_personas" });
    expect(findIdleNudgeBlocker(idleNudge([], "play_scene"), facts(tools(), tools()))).toBeNull();
  });

  it("needs one persona holding every tool the idle nudge names", () => {
    const both = idleNudge(["tool:web_search", "tool:image"]);
    expect(findIdleNudgeBlocker(both, facts(tools("web_search"), tools("generate_image")))).toEqual({
      kind: "tool",
      tool: "web_search",
    });
    expect(findIdleNudgeBlocker(both, facts(tools("web_search", "generate_image_nai")))).toBeNull();
  });

  it("names the tool no persona has", () => {
    const both = idleNudge(["tool:web_search", "tool:create_task"]);
    expect(findIdleNudgeBlocker(both, facts(tools("web_search")))).toEqual({ kind: "tool", tool: "create_task" });
  });

  it("never blocks on facts that change minute to minute", () => {
    const pickUp = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "revive_topic.pick_up_thread");
    if (!pickUp) throw new Error("Revive Topic built-in missing");
    expect(findIdleNudgeBlocker(pickUp, facts(tools()))).toBeNull();
    expect(findIdleNudgeBlocker(idleNudge(["presence_activity"], "ping_user"), facts(tools()))).toBeNull();
  });

  it("judges tools only on the personas a scope allows", () => {
    const search = idleNudge(["tool:web_search"]);
    const server = facts(tools("web_search"), tools());
    expect(findIdleNudgeBlocker(search, server, [1])).toBeNull();
    expect(findIdleNudgeBlocker(search, server, [2])).toEqual({ kind: "tool", tool: "web_search" });
  });

  it("blocks a scope whose personas were all deleted or silenced instead of opening it to everyone", () => {
    expect(findIdleNudgeBlocker(idleNudge([]), facts(tools()), [99])).toEqual({ kind: "no_persona" });
  });

  it("lets any nudging persona partner a scoped scene lead", () => {
    expect(findIdleNudgeBlocker(idleNudge([], "play_scene"), facts(tools(), tools()), [1])).toBeNull();
  });
});

describe("persona scope", () => {
  it("opens an unscoped idle nudge to every persona and a scoped one only to its personas", () => {
    const scopes = new Map([["custom:9", [1, 2]]]);
    expect(isInPersonaScope("custom:9", 2, scopes)).toBe(true);
    expect(isInPersonaScope("custom:9", 3, scopes)).toBe(false);
    expect(isInPersonaScope("start_topic.hot_take", 3, scopes)).toBe(true);
  });
});

describe("runnable idle nudges", () => {
  it("drops disabled built-ins and disabled custom idle nudges", () => {
    const runnable = listRunnableIdleNudges(
      ["start_topic.voice_note"],
      [
        createCustomIdleNudge({ custom_idle_nudge_id: 1 }),
        createCustomIdleNudge({ custom_idle_nudge_id: 2, enabled: false }),
      ],
    ).map((candidate) => candidate.key);
    expect(runnable).not.toContain("start_topic.voice_note");
    expect(runnable).toContain("custom:1");
    expect(runnable).not.toContain("custom:2");
  });
});

describe("persona-authored idle nudges", () => {
  it("keeps owner definitions with their owner and never opens them to another persona", () => {
    const config = personaConfig(OWNER_ID, { idle_nudges: [authoredNudge()] });
    expect(personaKeys(OWNER_ID, config)).toEqual(["persona:5:quiet-hour"]);
    expect(personaKeys(OTHER_ID, config)).toEqual([]);
    expect(listPersonaIdleNudges(OTHER_ID, config)).toEqual([]);
  });

  it("drops locally disabled definitions and an explicit empty list", () => {
    const config = personaConfig(OWNER_ID, {
      idle_nudges: [authoredNudge(), authoredNudge({ id: "second-wind", title: "Second wind" })],
      disabled_idle_nudge_ids: ["quiet-hour"],
    });
    expect(personaKeys(OWNER_ID, config)).toEqual(["persona:5:second-wind"]);
    expect(personaKeys(OWNER_ID, personaConfig(OWNER_ID))).toEqual([]);
    expect(personaKeys(OWNER_ID, undefined)).toEqual([]);
  });

  it("combines owner definitions with enabled built-ins and scoped server customs", () => {
    const custom = createCustomIdleNudge({ custom_idle_nudge_id: 9, title: "Quiet hour" });
    const scopedAway = createCustomIdleNudge({ custom_idle_nudge_id: 10 });
    const config = personaConfig(OWNER_ID, { idle_nudges: [authoredNudge()] });
    const runnable = listPersonaRunnableIdleNudges(
      selectionSources(OWNER_ID, config, {
        disabledBuiltIns: ["start_topic.voice_note"],
        customIdleNudges: [custom, scopedAway],
        scopes: new Map([["custom:10", [OTHER_ID]]]),
      }),
    );
    const keys = runnable.map((idleNudge) => idleNudge.key);

    expect(keys).toContain("start_topic.interest_musing");
    expect(keys).toContain("custom:9");
    expect(keys).toContain("persona:5:quiet-hour");
    expect(keys).not.toContain("start_topic.voice_note");
    expect(keys).not.toContain("custom:10");
    expect(
      runnable
        .filter((idleNudge) =>
          ["start_topic.interest_musing", "custom:9", "persona:5:quiet-hour"].includes(idleNudge.key),
        )
        .map(idleNudgeSource),
    ).toEqual(["builtin", "server", "persona"]);
  });

  it("keeps the key stable across a rename and separates one local ID by persona", () => {
    const before = listPersonaIdleNudges(OWNER_ID, personaConfig(OWNER_ID, { idle_nudges: [authoredNudge()] }))[0];
    const renamed = listPersonaIdleNudges(
      OWNER_ID,
      personaConfig(OWNER_ID, { idle_nudges: [authoredNudge({ title: "Loud hour" })] }),
    )[0];
    const other = listPersonaIdleNudges(OTHER_ID, personaConfig(OTHER_ID, { idle_nudges: [authoredNudge()] }))[0];

    expect(before.definition.key).toBe("persona:5:quiet-hour");
    expect(renamed.definition.key).toBe(before.definition.key);
    expect(other.definition.key).toBe("persona:6:quiet-hour");
  });

  it("applies the same category-implied and unknown prerequisite rules to owner definitions", () => {
    const owned = (category: IdleNudgeDefinition["category"], prerequisites: string[] = []) =>
      listPersonaIdleNudges(
        OWNER_ID,
        personaConfig(OWNER_ID, { idle_nudges: [authoredNudge({ category, prerequisites })] }),
      )[0].definition;
    const noFacts = {
      hasHangingConversation: false,
      hasScenePartner: false,
      availableTools: new Set<string>(),
      target: null,
    };
    const quietTarget = { ...noFacts, target: { hasRecentMemories: false, isActive: false } };

    expect(isIdleNudgeEligible(owned("ping_user"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(owned("ping_user"), quietTarget)).toBe(true);
    expect(isIdleNudgeEligible(owned("revive_topic"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(owned("revive_topic"), { ...noFacts, hasHangingConversation: true })).toBe(true);
    expect(isIdleNudgeEligible(owned("play_scene"), noFacts)).toBe(false);
    expect(isIdleNudgeEligible(owned("play_scene"), { ...noFacts, hasScenePartner: true })).toBe(true);
    expect(isIdleNudgeEligible({ ...owned("start_topic"), prerequisites: ["birthday_today"] }, noFacts)).toBe(false);
  });

  it("constrains only the Play Scene lead, so any other persona may partner it", () => {
    const config = personaConfig(OWNER_ID, { idle_nudges: [authoredNudge({ category: "play_scene" })] });
    const scene = listPersonaIdleNudges(OWNER_ID, config)[0].definition;
    const tools = new Set<string>();

    expect(personaKeys(OWNER_ID, config)).toEqual(["persona:5:quiet-hour"]);
    expect(personaKeys(OTHER_ID, config)).toEqual([]);
    expect(
      findIdleNudgeBlocker(
        scene,
        {
          personaTools: new Map([
            [OWNER_ID, tools],
            [OTHER_ID, tools],
          ]),
        },
        [OWNER_ID],
      ),
    ).toBeNull();
    expect(findIdleNudgeBlocker(scene, { personaTools: new Map([[OTHER_ID, tools]]) }, [OWNER_ID])).toEqual({
      kind: "no_persona",
    });
  });

  it("resolves only an entry the persona can still run", () => {
    const config = personaConfig(OWNER_ID, { idle_nudges: [authoredNudge()] });
    const key = "persona:5:quiet-hour";

    expect(findPersonaRunnableIdleNudge(key, selectionSources(OWNER_ID, config))?.key).toBe(key);
    expect(findPersonaRunnableIdleNudge(key, selectionSources(OWNER_ID, personaConfig(OWNER_ID)))).toBeNull();
    expect(
      findPersonaRunnableIdleNudge(
        key,
        selectionSources(OWNER_ID, personaConfig(OWNER_ID, { disabled_idle_nudge_ids: ["quiet-hour"] })),
      ),
    ).toBeNull();
    expect(findPersonaRunnableIdleNudge(key, selectionSources(OTHER_ID, config))).toBeNull();
  });

  it("names a prerequisite tool the persona cannot offer", () => {
    const search = listPersonaIdleNudges(
      OWNER_ID,
      personaConfig(OWNER_ID, { idle_nudges: [authoredNudge({ prerequisites: ["tool:web_search"] })] }),
    )[0].definition;
    const image = { ...search, prerequisites: ["tool:image"] };

    expect(findMissingIdleNudgeTool(search, new Set())).toBe("web_search");
    expect(findMissingIdleNudgeTool(search, new Set(["web_search"]))).toBeNull();
    expect(findMissingIdleNudgeTool(image, new Set(["generate_image_nai"]))).toBeNull();
  });
});

describe("tool names", () => {
  it("names only tools the registry provides", async () => {
    await initializeTools();
    const missing = NUDGE_TOOL_NAMES.filter((name) => name !== "image" && !getTool(name));
    expect(missing).toEqual([]);
  });
});

describe("official persona nudge defaults", () => {
  const offeredLineages = [...new Set(personaSections.flatMap((section) => section.rows).map((row) => row.lineageId))];

  it.each([
    [4, "cosplay-fit-check", ["web_search", "danbooru_search_tags", "generate_image_nai"]],
    [4, "design-breakdown", ["web_search", "danbooru_search_tags"]],
    [1770, "album-of-the-year", ["web_search"]],
    [1770, "album-rant", ["web_search"]],
    [3585, "gunpla-building", ["generate_image_nai"]],
    [50, "book-pick", ["web_search"]],
  ] as const)("requires each tool used by preset %s nudge %s", (lineage, id, requiredTools) => {
    const config = personaConfig(OWNER_ID, { idle_nudges: PRESET_NATURAL_NUDGE_DEFAULTS[lineage].idleNudges });
    const entry = listPersonaIdleNudges(OWNER_ID, config).find(
      (entry) => entry.definition.key === `persona:${OWNER_ID}:${id}`,
    );
    if (!entry) throw new Error(`Missing seeded nudge: ${lineage}/${id}`);
    const facts = {
      hasHangingConversation: false,
      hasScenePartner: false,
      availableTools: new Set<string>(requiredTools),
      target: null,
    };
    expect(isIdleNudgeEligible(entry.definition, facts)).toBe(true);
    for (const tool of requiredTools) {
      const availableTools = new Set<string>(requiredTools);
      availableTools.delete(tool);
      expect(isIdleNudgeEligible(entry.definition, { ...facts, availableTools })).toBe(false);
      expect(findMissingIdleNudgeTool(entry.definition, availableTools)).not.toBeNull();
    }
  });

  it("gives every offered persona lineage valid authored defaults", () => {
    const missing = offeredLineages.filter((lineage) => {
      const defaults = PRESET_NATURAL_NUDGE_DEFAULTS[lineage]?.idleNudges ?? [];
      return defaults.length === 0 || !personaAuthoredIdleNudgesSchema.safeParse(defaults).success;
    });
    expect(missing).toEqual([]);
  });

  it("stores each definition the way the editor saves it, so opening and saving changes nothing", () => {
    const unnormalized = offeredLineages.flatMap((lineage) =>
      PRESET_NATURAL_NUDGE_DEFAULTS[lineage].idleNudges.filter((nudge) => {
        const requiredTools = new Set<string>(nudge.prerequisites.flatMap((id) => prerequisiteTool(id) ?? []));
        return (
          nudge.prerequisites.includes(CATEGORY_IMPLIED_PREREQUISITES[nudge.category] ?? "") ||
          nudge.recommended_tools.some((tool) => requiredTools.has(tool))
        );
      }),
    );
    expect(unnormalized).toEqual([]);
  });

  it("surfaces seeded defaults through owner normalization with persona-scoped keys", () => {
    for (const lineage of offeredLineages) {
      const idleNudges = PRESET_NATURAL_NUDGE_DEFAULTS[lineage].idleNudges;
      const entries = listPersonaIdleNudges(OWNER_ID, personaConfig(OWNER_ID, { idle_nudges: idleNudges }));
      expect(entries.map((entry) => entry.definition.key)).toEqual(
        idleNudges.map((nudge) => `persona:${OWNER_ID}:${nudge.id}`),
      );
      expect(entries.every((entry) => entry.enabled)).toBe(true);
    }
  });
});
