import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Guild } from "discord.js";
import {
  clearMessageProxyGuildPresenceStateForTests,
  isMessageProxyInstanceBotPresent,
} from "@/utils/messageProxy/guildPresence";
import type { MessageProxyInstanceContext } from "@/utils/messageProxy/instances";

const instance: MessageProxyInstanceContext = {
  serviceId: "pluralkit",
  instanceId: "pluralkit:official",
  origin: "https://api.pluralkit.me",
  botUserId: "466378653216014359",
};

function guild(args: { cached?: boolean; fetch?: (id: string) => Promise<unknown> }): Guild {
  return {
    id: "guild-1",
    members: {
      cache: { has: () => args.cached ?? false },
      fetch: args.fetch ?? (async () => ({})),
    },
  } as unknown as Guild;
}

beforeEach(() => {
  clearMessageProxyGuildPresenceStateForTests();
});

describe("message-proxy guild presence", () => {
  it("preserves the speedbump when the instance bot ID is unknown", async () => {
    const fetch = mock(async () => {
      throw new Error("should not fetch");
    });
    expect(await isMessageProxyInstanceBotPresent(guild({ fetch }), { ...instance, botUserId: null })).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses a cached guild member without a REST fetch", async () => {
    const fetch = mock(async () => ({}));
    expect(await isMessageProxyInstanceBotPresent(guild({ cached: true, fetch }), instance)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("skips the speedbump after Discord confirms the bot is not a guild member", async () => {
    const fetch = mock(async () => {
      throw Object.assign(new Error("Unknown Member"), { code: 10007 });
    });
    const targetGuild = guild({ fetch });
    expect(await isMessageProxyInstanceBotPresent(targetGuild, instance)).toBe(false);
    expect(await isMessageProxyInstanceBotPresent(targetGuild, instance)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails open when guild membership cannot be checked reliably", async () => {
    const fetch = mock(async () => {
      throw new Error("network failure");
    });
    expect(await isMessageProxyInstanceBotPresent(guild({ fetch }), instance)).toBe(true);
  });
});
