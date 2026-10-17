import { describe, expect, test } from "bun:test";
import { MessageType } from "discord.js";
import type { Message, User } from "discord.js";
import { formatMessagesForExtraction } from "@/utils/discord/historyFormatter";

const MENTIONED_USER_ID = "900000000000000002";

describe("formatMessagesForExtraction mentions", () => {
  test("names a mentioned user the client user cache no longer holds", () => {
    const mentionedUser = { id: MENTIONED_USER_ID, username: "Juno" } as User;
    const message = {
      type: MessageType.Default,
      content: `ask <@${MENTIONED_USER_ID}> about it`,
      createdAt: new Date("2026-07-28T15:59:00Z"),
      id: "1",
      webhookId: null,
      guildId: "fixture-guild",
      channelId: "fixture-channel",
      channel: { isThread: () => false },
      guild: { members: { cache: new Map() } },
      client: { users: { cache: new Map() } },
      mentions: { users: new Map([[MENTIONED_USER_ID, mentionedUser]]) },
      author: { id: "5", username: "Mirri" },
      member: null,
      attachments: new Map(),
      embeds: [],
    } as unknown as Message;

    const result = formatMessagesForExtraction([message], []);

    expect(result.text).toContain("@Juno");
    expect(result.text).not.toContain("@UnknownUser");
  });
});
