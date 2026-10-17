import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import * as realShortTermMemoryCache from "@/utils/cache/shortTermMemoryCache";
import type { ShortTermMemoryEntry } from "@/utils/cache/shortTermMemoryCache";
import * as realUserCache from "@/utils/cache/userCache";
import { ContextItemTag } from "@/types/misc/context";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

let otherChannelEntries: ShortTermMemoryEntry[] = [];

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/cache/shortTermMemoryCache": realShortTermMemoryCache,
  "@/utils/cache/userCache": realUserCache,
});

scopedMock.module("@/utils/cache/shortTermMemoryCache", () => ({
  ...realShortTermMemoryCache,
  preWarmServerStmEntries: mock(async () => undefined),
  getShortTermMemoriesForServer: mock(() => otherChannelEntries),
}));

scopedMock.module("@/utils/cache/userCache", () => ({
  ...realUserCache,
  getCachedUserRow: mock(async () => null),
}));

const { buildShortTermMemoryContext } = await import("@/utils/text/context/memories");

/** A row warmed from the DB after its summary was cleared: no messages, summary, or category values. */
function hydratedEntry(channelId: string, lastUpdated: number, overrides: Partial<ShortTermMemoryEntry> = {}) {
  return { messages: [], serverId: "server-1", channelId, lastUpdated, ...overrides } satisfies ShortTermMemoryEntry;
}

async function recallText() {
  const { memoryItems } = await buildShortTermMemoryContext({
    triggeringUserId: "user-1",
    currentChannelId: "channel-current",
    currentServerId: "server-1",
    tomoriState: null,
    triggererName: "Mirri",
    botName: "Juno",
    personalMemoriesEnabled: false,
    client: {} as Client,
    isUserImpersonation: false,
    convertMentions: async (text) => text,
  });
  return memoryItems
    .filter((item) => item.metadataTag === ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY)
    .flatMap((item) => item.parts.map((part) => (part.type === "text" ? part.text : "")));
}

describe("other-channel short-term recall", () => {
  beforeEach(() => {
    otherChannelEntries = [];
  });

  it("skips entries with nothing to recall so they neither render empty blocks nor displace real ones", async () => {
    otherChannelEntries = [
      hydratedEntry("channel-a", 4000),
      hydratedEntry("channel-b", 3000, { categories: { mood: "  " } }),
      hydratedEntry("channel-c", 2000),
      hydratedEntry("channel-d", 1000, { summary: "Planned a Celeste speedrun." }),
    ];

    const texts = await recallText();

    expect(texts).toHaveLength(1);
    expect(texts[0]?.match(/\[System:/g)).toHaveLength(1);
    expect(texts[0]).toContain("Planned a Celeste speedrun.");
  });

  it("adds no recall item when every entry is empty", async () => {
    otherChannelEntries = [hydratedEntry("channel-a", 2000), hydratedEntry("channel-b", 1000)];

    expect(await recallText()).toEqual([]);
  });
});
