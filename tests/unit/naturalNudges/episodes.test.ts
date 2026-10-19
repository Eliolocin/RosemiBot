import { describe, expect, it } from "bun:test";
import type { CustomEpisodeRow } from "@/modules/natural-nudges/db/types";
import {
  BUILTIN_EPISODES,
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

function episode(prerequisites: string[]): EpisodeDefinition {
  return {
    key: "custom:9",
    category: "new_topic",
    brief: "brief",
    agendaHint: null,
    prerequisites,
    recommendedTools: [],
    builtIn: false,
  };
}

describe("episode eligibility", () => {
  const noFacts = { hasHangingConversation: false, availableTools: new Set<string>() };

  it("treats a prerequisite the registry no longer knows as unmet", () => {
    expect(isEpisodeEligible(episode(["recent_memory"]), noFacts)).toBe(false);
  });

  it("accepts either image generator for the image prerequisite", () => {
    const facts = { hasHangingConversation: false, availableTools: new Set(["generate_image_nai"]) };
    expect(isEpisodeEligible(episode(["tool:image"]), facts)).toBe(true);
    expect(isEpisodeEligible(episode(["tool:image"]), noFacts)).toBe(false);
  });

  it("requires a hanging conversation for Revive", () => {
    const revive = BUILTIN_EPISODES.filter((candidate) => candidate.category === "revive");
    expect(revive.length).toBeGreaterThan(0);
    for (const candidate of revive) expect(isEpisodeEligible(candidate, noFacts)).toBe(false);
  });
});

describe("runnable episodes", () => {
  it("drops disabled built-ins, disabled custom episodes, and categories without a runner", () => {
    const runnable = listRunnableEpisodes(
      ["new_topic.voice_note"],
      [
        custom({ episode_id: 1 }),
        custom({ episode_id: 2, enabled: false }),
        custom({ episode_id: 3, category: "reach_out" }),
      ],
    ).map((candidate) => candidate.key);
    expect(runnable).not.toContain("new_topic.voice_note");
    expect(runnable).toContain("custom:1");
    expect(runnable).not.toContain("custom:2");
    expect(runnable).not.toContain("custom:3");
  });
});

describe("tool names", () => {
  it("names only tools the registry provides", async () => {
    await initializeTools();
    const missing = NUDGE_TOOL_NAMES.filter((name) => name !== "image" && !getTool(name));
    expect(missing).toEqual([]);
  });
});
