import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { ServerMemoryRow } from "@/types/db/schema";
import { serverMemoryRepository } from "@/utils/db/repositories";
import { buildServerMemoryContextItem } from "@/utils/text/context/memories";
import { createPersona } from "../../helpers/fixtures";

const SCOPED_CHANNEL = "111111111111111111";
const THREAD_IN_SCOPED_CHANNEL = "222222222222222222";
const OTHER_CHANNEL = "333333333333333333";

function memoryRow(id: number, content: string, channelDiscIds: string[], pending = false): ServerMemoryRow {
  return {
    server_memory_id: id,
    server_id: 1,
    persona_id: 1,
    persona_lineage_id: 100,
    user_id: 1,
    content,
    tags: [],
    channel_disc_ids: channelDiscIds,
    channel_scope_pending: pending,
  };
}

async function memoryTextIn(channelId: string, parentChannelId: string | null, channelMemoryEnabled = true) {
  const item = await buildServerMemoryContextItem({
    tomoriState: createPersona({ server_memories: ["everywhere fact", "channel-only fact"] }),
    guildId: "guild-1",
    serverName: "Server",
    isDMChannel: false,
    botName: "Mirri",
    personalMemoriesEnabled: true,
    conversationCorpus: null,
    channelId,
    parentChannelId,
    channelMemoryEnabled,
    client: {} as Client,
    convertMentions: async (text) => text,
  });
  const part = item?.parts[0];
  return part?.type === "text" ? part.text : "";
}

describe("server memory channel scope", () => {
  let loadSpy: { mockRestore(): void } | undefined;

  afterEach(() => {
    loadSpy?.mockRestore();
  });

  function loadRows() {
    loadSpy = spyOn(serverMemoryRepository, "loadServerMemoriesScoped").mockResolvedValue([
      memoryRow(1, "everywhere fact", []),
      memoryRow(2, "channel-only fact", [SCOPED_CHANNEL]),
      memoryRow(3, "unresolved fact", [], true),
    ]);
  }

  it("keeps a scoped memory in its channel and in that channel's threads", async () => {
    loadRows();
    expect(await memoryTextIn(SCOPED_CHANNEL, null)).toContain("channel-only fact");
    expect(await memoryTextIn(THREAD_IN_SCOPED_CHANNEL, SCOPED_CHANNEL)).toContain("channel-only fact");
  });

  it("drops a scoped memory elsewhere while an unscoped memory stays everywhere", async () => {
    loadRows();
    const text = await memoryTextIn(OTHER_CHANNEL, null);
    expect(text).toContain("everywhere fact");
    expect(text).not.toContain("channel-only fact");
  });

  it("treats a memory with an unresolved legacy scope as active in every channel", async () => {
    loadRows();
    expect(await memoryTextIn(SCOPED_CHANNEL, null)).toContain("unresolved fact");
    expect(await memoryTextIn(OTHER_CHANNEL, null)).toContain("unresolved fact");
    expect(await memoryTextIn(OTHER_CHANNEL, null, false)).toContain("unresolved fact");
  });

  it("ignores scopes when channel memory is disabled", async () => {
    loadRows();
    expect(await memoryTextIn(OTHER_CHANNEL, null, false)).toContain("channel-only fact");
  });
});
