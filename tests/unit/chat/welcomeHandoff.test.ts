import { describe, expect, it } from "bun:test";
import type { StructuredContextItem } from "@/types/misc/context";
import { ContextItemTag } from "@/types/misc/context";
import type { ChatIncoming } from "@/utils/chat/types";
import { applyWelcomeHandoff, openWelcomeHandoff } from "@/utils/chat/welcomeHandoff";

let nextId = 1;

function welcomeItem(): StructuredContextItem {
  return { role: "user", metadataTag: ContextItemTag.DIALOGUE_HISTORY, parts: [{ type: "text", text: "welcome" }] };
}

function memberTurn(channelId: string, overrides: Partial<ChatIncoming> = {}): ChatIncoming {
  return {
    message: { id: `msg-${nextId++}`, channelId },
    isFromQueue: false,
    isPersonaJob: false,
    ...overrides,
  } as unknown as ChatIncoming;
}

describe("welcome handoff", () => {
  it("lets the member's own turn carry the greeting and cancels the standalone welcome", () => {
    const channelId = `channel-${nextId++}`;
    const item = welcomeItem();
    const handoff = openWelcomeHandoff(channelId, "member", item);
    const turn = memberTurn(channelId);

    expect(applyWelcomeHandoff(turn, "member")).toBe(true);
    expect(turn.injectedContextItems).toEqual([item]);
    expect(handoff.isTakenByMember()).toBe(true);
    expect(handoff.claimForWelcome("anchor")).toBe(false);

    const replayed = memberTurn(channelId, { message: turn.message, injectedContextItems: turn.injectedContextItems });
    expect(applyWelcomeHandoff(replayed, "member")).toBe(true);
    expect(replayed.injectedContextItems).toHaveLength(1);
    handoff.release();
  });

  it("drops the member's turn for the message the welcome turn is already replying to", () => {
    const channelId = `channel-${nextId++}`;
    const handoff = openWelcomeHandoff(channelId, "member", welcomeItem());
    const anchoredTurn = memberTurn(channelId);
    expect(handoff.claimForWelcome(anchoredTurn.message.id)).toBe(true);

    expect(applyWelcomeHandoff(anchoredTurn, "member")).toBe(false);

    const laterTurn = memberTurn(channelId);
    expect(applyWelcomeHandoff(laterTurn, "member")).toBe(true);
    expect(laterTurn.injectedContextItems).toBeUndefined();
    handoff.release();
  });

  it("leaves the greeting to the welcome for other users, other channels, and non-message turns", () => {
    const channelId = `channel-${nextId++}`;
    const handoff = openWelcomeHandoff(channelId, "member", welcomeItem());

    for (const [turn, userDiscId] of [
      [memberTurn(channelId), "someone-else"],
      [memberTurn(`channel-${nextId++}`), "member"],
      [memberTurn(channelId, { isPersonaJob: true }), "member"],
      [memberTurn(channelId, { isManuallyTriggered: true }), "member"],
    ] as const) {
      expect(applyWelcomeHandoff(turn, userDiscId)).toBe(true);
      expect(turn.injectedContextItems).toBeUndefined();
    }
    expect(handoff.claimForWelcome("anchor")).toBe(true);
    handoff.release();
  });

  it("stops matching once the welcome flow releases the window", () => {
    const channelId = `channel-${nextId++}`;
    openWelcomeHandoff(channelId, "member", welcomeItem()).release();
    const turn = memberTurn(channelId);

    expect(applyWelcomeHandoff(turn, "member")).toBe(true);
    expect(turn.injectedContextItems).toBeUndefined();
  });
});
