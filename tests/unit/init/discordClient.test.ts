import { afterEach, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { createDiscordClient } from "@/init/discord";
import { DiscordPresenceRetention } from "@/utils/cache/discordPresenceRetention";

let client: Client | undefined;

afterEach(async () => {
  await client?.destroy();
  client = undefined;
});

describe("Discord presence retention", () => {
  const guildId = "100000000000000001";
  const otherGuildId = "100000000000000002";
  const knownUserId = "200000000000000001";
  const newUserId = "200000000000000002";

  it("admits initial gateway presences only for participants in that guild", () => {
    const retention = new DiscordPresenceRetention();
    retention.retain(guildId, knownUserId);
    client = createDiscordClient(true, retention);
    for (const id of [guildId, otherGuildId]) {
      gatewayCache(client.guilds)._add({
        id,
        name: "Guild",
        roles: [],
        channels: [],
        emojis: [],
        members: [knownUserId, newUserId].map((userId) => ({
          user: rawUser(userId),
          roles: [],
          joined_at: new Date(0).toISOString(),
          deaf: false,
          mute: false,
        })),
        presences: [knownUserId, newUserId].map((userId) => ({
          user: { id: userId },
          status: "online",
          activities: [],
        })),
      });
    }

    const guild = client.guilds.cache.get(guildId);
    const otherGuild = client.guilds.cache.get(otherGuildId);
    if (!guild || !otherGuild) throw new Error("Gateway guild fixtures were not cached");
    expect([...guild.presences.cache.keys()]).toEqual([knownUserId]);
    expect(otherGuild.presences.cache.size).toBe(0);
  });

  it("admits a new participant on the next update and never leaves a stale online status", () => {
    const retention = new DiscordPresenceRetention();
    client = createDiscordClient(true, retention);
    gatewayCache(client.guilds)._add({ id: guildId, name: "Guild", roles: [], channels: [], emojis: [] });
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error("Gateway guild fixture was not cached");
    const actions = (client as unknown as { actions: { PresenceUpdate: { handle(data: unknown): void } } }).actions;
    const update = (status: "online" | "dnd" | "offline") => {
      actions.PresenceUpdate.handle({
        guild_id: guildId,
        user: rawUser(newUserId),
        status,
        activities: [],
        client_status: {},
      });
    };

    update("online");
    expect(guild.presences.cache.has(newUserId)).toBe(false);
    retention.retain(guildId, newUserId);
    expect(guild.presences.cache.has(newUserId)).toBe(false);
    update("dnd");
    expect(guild.presences.cache.get(newUserId)?.status).toBe("dnd");
    update("offline");
    expect(guild.presences.cache.get(newUserId)?.status).toBe("offline");

    const sweep = client.options.sweepers?.presences;
    if (!sweep || !("filter" in sweep) || !sweep.filter) throw new Error("Presence sweeper needs a filter");
    const filter = sweep.filter();
    if (!filter) throw new Error("Presence sweeper needs a predicate");
    client.sweepers.sweepPresences(filter);
    expect(guild.presences.cache.has(newUserId)).toBe(false);
    update("online");
    expect(guild.presences.cache.get(newUserId)?.status).toBe("online");
  });
});

// discord.js marks _add private, but it is the path gateway payloads take into each cache.
type GatewayCache = { _add(data: unknown): unknown };

function gatewayCache(manager: object): GatewayCache {
  return manager as GatewayCache;
}

function rawUser(id: string, bot = false) {
  return { id, username: `user${id}`, discriminator: "0", global_name: null, avatar: null, bot };
}

describe("createDiscordClient users sweeper", () => {
  it("evicts users with no cached member and keeps every cached member's user", () => {
    client = createDiscordClient(false);
    gatewayCache(client.guilds)._add({
      id: "100",
      name: "Guild",
      roles: [],
      channels: [],
      emojis: [],
      members: [
        { user: rawUser("1"), roles: [], joined_at: new Date(0).toISOString(), deaf: false, mute: false },
        { user: rawUser("2", true), roles: [], joined_at: new Date(0).toISOString(), deaf: false, mute: false },
      ],
    });
    gatewayCache(client.users)._add(rawUser("3"));
    gatewayCache(client.users)._add(rawUser("4", true));

    const userSweep = client.options.sweepers?.users;
    if (!userSweep || !("filter" in userSweep) || !userSweep.filter) throw new Error("users sweeper must use a filter");
    const sweepFilter = userSweep.filter();
    if (!sweepFilter) throw new Error("users sweeper filter must return a predicate");
    client.sweepers.sweepUsers(sweepFilter);

    expect([...client.users.cache.keys()].sort()).toEqual(["1", "2"]);
  });
});
