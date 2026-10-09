import { describe, expect, it } from "bun:test";
import { ChannelType, PermissionFlagsBits, PermissionsBitField, type Channel } from "discord.js";
import { canMirrorToThoughtLog } from "@/utils/discord/thoughtLogAudience";

const view = PermissionFlagsBits.ViewChannel;

function guildChannel(
  id: string,
  options: { guildId?: string; everyoneCanView?: boolean; denies?: Array<{ id: string; deny: bigint }> } = {},
) {
  const guildId = options.guildId ?? "guild_1";
  return {
    id,
    type: ChannelType.GuildText,
    guildId,
    guild: { roles: { everyone: { id: guildId } } },
    isDMBased: () => false,
    isThread: () => false,
    permissionsFor: () => new PermissionsBitField(options.everyoneCanView === false ? 0n : view),
    permissionOverwrites: {
      cache: (options.denies ?? []).map((entry) => ({ id: entry.id, deny: new PermissionsBitField(entry.deny) })),
    },
  };
}

function thread(id: string, parent: ReturnType<typeof guildChannel> | null, isPrivate = false) {
  return {
    id,
    type: isPrivate ? ChannelType.PrivateThread : ChannelType.PublicThread,
    guildId: "guild_1",
    guild: { roles: { everyone: { id: "guild_1" } } },
    isDMBased: () => false,
    isThread: () => true,
    parent,
  };
}

const mirror = (source: unknown, destination: unknown, privateIds: string[] = []) =>
  canMirrorToThoughtLog(source as Channel, destination as Channel, privateIds);

describe("thought log audience", () => {
  const destination = guildChannel("log");

  it("mirrors a channel every guild member can read, and public threads under it", () => {
    const source = guildChannel("source", { denies: [{ id: "role_send", deny: PermissionFlagsBits.SendMessages }] });
    expect(mirror(source, destination)).toBe(true);
    expect(mirror(thread("thread", source), destination)).toBe(true);
  });

  it("refuses sources whose audience is restricted or cannot be established", () => {
    const hidden = guildChannel("hidden", { everyoneCanView: false });
    const roleDenied = guildChannel("roles", { denies: [{ id: "role_muted", deny: view }] });
    const memberDenied = guildChannel("member", { denies: [{ id: "user_1", deny: view }] });
    const cases: Array<[string, unknown]> = [
      ["@everyone cannot view", hidden],
      ["a role is denied", roleDenied],
      ["a member is denied", memberDenied],
      ["private thread", thread("private", guildChannel("open"), true)],
      ["public thread in a hidden channel", thread("inner", hidden)],
      ["thread with an uncached parent", thread("orphan", null)],
      ["DM", { ...guildChannel("dm"), isDMBased: () => true }],
    ];
    const allowed = cases.filter(([, source]) => mirror(source, destination)).map(([name]) => name);
    expect(allowed).toEqual([]);
  });

  it("refuses a destination outside the source guild and honors the private channel list", () => {
    const source = guildChannel("source");
    expect(mirror(source, guildChannel("log", { guildId: "guild_2" }))).toBe(false);
    expect(mirror(source, destination, ["source"])).toBe(false);
    expect(mirror(thread("thread", source), destination, ["source"])).toBe(false);
  });
});
