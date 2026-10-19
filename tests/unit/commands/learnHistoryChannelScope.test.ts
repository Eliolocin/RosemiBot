import { describe, expect, it } from "bun:test";
import { ChannelType, Collection, type Guild } from "discord.js";
import { resolveHistoryChannelScope } from "@/commands/learn/history";

const GENERAL = "111111111111111111";
const GENERAL_ARCHIVE = "222222222222222222";
const NEWS = "333333333333333333";
const VOICE = "444444444444444444";

function guildWith(channels: Array<{ id: string; name: string; type: ChannelType }>): Pick<Guild, "channels"> {
  return {
    channels: { cache: new Collection(channels.map((channel) => [channel.id, channel])) },
  } as unknown as Pick<Guild, "channels">;
}

const guild = guildWith([
  { id: GENERAL, name: "general", type: ChannelType.GuildText },
  { id: GENERAL_ARCHIVE, name: "General", type: ChannelType.GuildText },
  { id: NEWS, name: "news", type: ChannelType.GuildAnnouncement },
  { id: VOICE, name: "hangout", type: ChannelType.GuildVoice },
]);

describe("/learn history channel scope", () => {
  it("resolves names to every matching channel and mentions to their channel", () => {
    expect(resolveHistoryChannelScope(guild, `#General, <#${NEWS}>, news`)).toEqual({
      status: "resolved",
      channelIds: [GENERAL, GENERAL_ARCHIVE, NEWS],
    });
  });

  it("treats a blank option as unscoped", () => {
    expect(resolveHistoryChannelScope(guild, null)).toEqual({ status: "resolved", channelIds: [] });
    expect(resolveHistoryChannelScope(guild, " , ")).toEqual({ status: "resolved", channelIds: [] });
  });

  it("rejects the first entry that names no text or announcement channel", () => {
    expect(resolveHistoryChannelScope(guild, "general, #missing")).toEqual({ status: "unresolved", entry: "#missing" });
    expect(resolveHistoryChannelScope(guild, `<#${VOICE}>`)).toEqual({ status: "unresolved", entry: `<#${VOICE}>` });
    expect(resolveHistoryChannelScope(null, "general")).toEqual({ status: "unresolved", entry: "general" });
  });
});
