import { afterEach, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import { createDiscordClient } from "@/init/discord";

let client: Client | undefined;

afterEach(async () => {
  await client?.destroy();
  client = undefined;
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
