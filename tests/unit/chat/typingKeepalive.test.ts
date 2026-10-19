import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import {
  type ChannelLockEntry,
  channelLocks,
  startDiscordTypingKeepalive,
  stopDiscordTypingKeepalive,
} from "@/utils/chat/channelQueue";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";

const CHANNEL_ID = "typing-keepalive-test";
const MESSAGE_ID = "typing-keepalive-message";

function heldLock(): ChannelLockEntry {
  const entry: ChannelLockEntry = {
    isLocked: true,
    lockedAt: Date.now(),
    currentMessageId: MESSAGE_ID,
    serverDiscId: "server",
    typingKeepaliveTimer: null,
    followUpCount: 0,
    messageQueue: [],
    activeTurnAbortController: null,
  };
  channelLocks.set(CHANNEL_ID, entry);
  return entry;
}

afterEach(() => {
  const entry = channelLocks.get(CHANNEL_ID);
  if (entry) stopDiscordTypingKeepalive(CHANNEL_ID, entry, "test_cleanup");
  channelLocks.delete(CHANNEL_ID);
  StreamOrchestrator.clearStopRequest(CHANNEL_ID);
});

describe("Discord typing keepalive", () => {
  it("keeps refreshing after an internal stop is raised and cleared within the same turn", async () => {
    const entry = heldLock();
    let typingCalls = 0;
    const channel = {
      id: CHANNEL_ID,
      sendTyping: async () => {
        typingCalls++;
      },
    } as unknown as Message["channel"];

    let tick: () => void = () => {};
    const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((handler: () => void) => {
      tick = handler;
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});

    try {
      await startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
      StreamOrchestrator.requestStop(CHANNEL_ID, "speaker_guard");
      tick();
      StreamOrchestrator.clearStopRequest(CHANNEL_ID);
      tick();
      await Promise.resolve();

      expect(entry.typingKeepaliveTimer).not.toBeNull();
      expect(typingCalls).toBe(3);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
