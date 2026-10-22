import { describe, expect, it } from "bun:test";
import {
  BUILTIN_IDLE_NUDGES,
  findIdleNudgeBlocker,
  idleNudgeNeedsTarget,
  isIdleNudgeEligible,
  listRunnableIdleNudges,
  NUDGE_TOOL_NAMES,
  type IdleNudgeDefinition,
} from "@/modules/natural-nudges/runtime/idleNudges";
import { getTool } from "@/tools/toolRegistry";
import { initializeTools } from "@/tools/toolInitializer";
import { createCustomIdleNudge } from "../../helpers/fixtures";

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

  it("blocks a scene until two personas can nudge", () => {
    expect(findIdleNudgeBlocker(idleNudge([], "play_scene"), { personaTools: [tools()] })).toEqual({
      kind: "two_personas",
    });
    expect(findIdleNudgeBlocker(idleNudge(["two_personas"]), { personaTools: [tools()] })).toEqual({
      kind: "two_personas",
    });
    expect(findIdleNudgeBlocker(idleNudge([], "play_scene"), { personaTools: [tools(), tools()] })).toBeNull();
  });

  it("needs one persona holding every tool the idle nudge names", () => {
    const both = idleNudge(["tool:web_search", "tool:image"]);
    const split = { personaTools: [tools("web_search"), tools("generate_image")] };
    expect(findIdleNudgeBlocker(both, split)).toEqual({ kind: "tool", tool: "web_search" });
    expect(findIdleNudgeBlocker(both, { personaTools: [tools("web_search", "generate_image_nai")] })).toBeNull();
  });

  it("names the tool no persona has", () => {
    const both = idleNudge(["tool:web_search", "tool:create_task"]);
    expect(findIdleNudgeBlocker(both, { personaTools: [tools("web_search")] })).toEqual({
      kind: "tool",
      tool: "create_task",
    });
  });

  it("never blocks on facts that change minute to minute", () => {
    const pickUp = BUILTIN_IDLE_NUDGES.find((candidate) => candidate.key === "revive_topic.pick_up_thread");
    if (!pickUp) throw new Error("Revive Topic built-in missing");
    expect(findIdleNudgeBlocker(pickUp, { personaTools: [tools()] })).toBeNull();
    expect(findIdleNudgeBlocker(idleNudge(["presence_activity"], "ping_user"), { personaTools: [tools()] })).toBeNull();
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

describe("tool names", () => {
  it("names only tools the registry provides", async () => {
    await initializeTools();
    const missing = NUDGE_TOOL_NAMES.filter((name) => name !== "image" && !getTool(name));
    expect(missing).toEqual([]);
  });
});
