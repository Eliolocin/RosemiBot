import { describe, expect, it } from "bun:test";
import type { CustomEpisodeRow } from "@/modules/natural-nudges/db/types";
import {
  BUILTIN_EPISODES,
  episodeNeedsTarget,
  isEpisodeEligible,
  listRunnableEpisodes,
  NUDGE_TOOL_NAMES,
  type EpisodeDefinition,
} from "@/modules/natural-nudges/runtime/episodes";
import { getTool } from "@/tools/toolRegistry";
import { initializeTools } from "@/tools/toolInitializer";

function custom(overrides: Partial<CustomEpisodeRow>): CustomEpisodeRow {
  return {
    episode_id: 1,
    server_id: 1,
    category: "new_topic",
    title: "Mirri's riddle",
    brief: "Have {persona} pose a riddle.",
    agenda_hint: null,
    prerequisites: [],
    recommended_tools: [],
    enabled: true,
    ...overrides,
  };
}

function episode(prerequisites: string[], category: EpisodeDefinition["category"] = "new_topic"): EpisodeDefinition {
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

describe("episode eligibility", () => {
  const noFacts = {
    hasHangingConversation: false,
    hasScenePartner: false,
    availableTools: new Set<string>(),
    target: null,
  };
  const quietTarget = { ...noFacts, target: { hasRecentMemories: false, isActive: false } };

  it("treats a prerequisite the registry no longer knows as unmet", () => {
    expect(isEpisodeEligible(episode(["birthday_today"]), noFacts)).toBe(false);
  });

  it("needs a drawn target for every Reach-out, even a custom one that omits relationship_user", () => {
    expect(isEpisodeEligible(episode([], "reach_out"), noFacts)).toBe(false);
    expect(isEpisodeEligible(episode([], "reach_out"), quietTarget)).toBe(true);
    expect(isEpisodeEligible(episode(["relationship_user"]), noFacts)).toBe(false);
  });

  it("draws a target for any episode that asks about one, whatever its category", () => {
    expect(episodeNeedsTarget(episode(["presence_activity"]))).toBe(true);
    expect(episodeNeedsTarget(episode(["recent_memory"], "revive"))).toBe(true);
    expect(episodeNeedsTarget(episode(["tool:web_search"]))).toBe(false);
  });

  it("reads recent_memory and presence_activity from the drawn target", () => {
    const callback = BUILTIN_EPISODES.find((candidate) => candidate.key === "reach_out.memory_callback");
    const poke = BUILTIN_EPISODES.find((candidate) => candidate.key === "reach_out.presence_poke");
    if (!callback || !poke) throw new Error("Reach-out built-ins missing");
    expect(isEpisodeEligible(callback, quietTarget)).toBe(false);
    expect(isEpisodeEligible(poke, quietTarget)).toBe(false);
    const busyTarget = { ...noFacts, target: { hasRecentMemories: true, isActive: true } };
    expect(isEpisodeEligible(callback, busyTarget)).toBe(true);
    expect(isEpisodeEligible(poke, busyTarget)).toBe(true);
  });

  it("accepts either image generator for the image prerequisite", () => {
    const facts = { ...noFacts, availableTools: new Set(["generate_image_nai"]) };
    expect(isEpisodeEligible(episode(["tool:image"]), facts)).toBe(true);
    expect(isEpisodeEligible(episode(["tool:image"]), noFacts)).toBe(false);
  });

  it("requires a hanging conversation for Revive", () => {
    const revive = BUILTIN_EPISODES.filter((candidate) => candidate.category === "revive");
    expect(revive.length).toBeGreaterThan(0);
    for (const candidate of revive) expect(isEpisodeEligible(candidate, noFacts)).toBe(false);
  });

  it("needs a scene partner for every Alter Talk, even a custom one that omits two_personas", () => {
    const partnered = { ...noFacts, hasScenePartner: true };
    expect(isEpisodeEligible(episode([], "alter_talk"), noFacts)).toBe(false);
    expect(isEpisodeEligible(episode([], "alter_talk"), partnered)).toBe(true);
    expect(isEpisodeEligible(episode(["two_personas"]), noFacts)).toBe(false);
    expect(isEpisodeEligible(episode(["two_personas"]), partnered)).toBe(true);
  });
});

describe("runnable episodes", () => {
  it("drops disabled built-ins and disabled custom episodes", () => {
    const runnable = listRunnableEpisodes(
      ["new_topic.voice_note"],
      [custom({ episode_id: 1 }), custom({ episode_id: 2, enabled: false })],
    ).map((candidate) => candidate.key);
    expect(runnable).not.toContain("new_topic.voice_note");
    expect(runnable).toContain("custom:1");
    expect(runnable).not.toContain("custom:2");
  });
});

describe("tool names", () => {
  it("names only tools the registry provides", async () => {
    await initializeTools();
    const missing = NUDGE_TOOL_NAMES.filter((name) => name !== "image" && !getTool(name));
    expect(missing).toEqual([]);
  });
});
