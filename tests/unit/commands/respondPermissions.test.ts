import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  Collection,
  DiscordAPIError,
  type EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
} from "discord.js";
import { execute } from "@/commands/respond";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { invalidatePersonalSpotlightCache } from "@/utils/cache/personalSpotlightCache";
import { cooldownRepository, personaRepository, userRepository, whitelistRepository } from "@/utils/db/repositories";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction, type FakeCall } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const persona = createPersona();

beforeAll(initializeLocalizer);
beforeEach(() => {
  invalidateWhitelistCache(guildId);
  invalidatePersonalSpotlightCache(persona.server_id);
  spyOn(personaRepository, "loadState").mockResolvedValue(persona);
  spyOn(personaRepository, "loadAllForServer").mockResolvedValue([persona]);
  spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
    isOnCooldown: false,
    remainingSeconds: 0,
    cooldownType: 0,
  });
  spyOn(userRepository, "serverHasPersonalSpotlights").mockResolvedValue(false);
  spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue({
    hasActiveWhitelist: false,
    hasActiveChannelWhitelist: false,
    isChannelWhitelisted: false,
    hasActiveRoleWhitelist: false,
    isRoleWhitelisted: false,
    hasActivePersonaWhitelist: false,
    isTriggerAllowed: true,
    hasChannelCooldownOverride: false,
  });
});
afterEach(() => {
  mock.restore();
  invalidateWhitelistCache(guildId);
  invalidatePersonalSpotlightCache(persona.server_id);
});

function invocation(voice: boolean, connect: boolean, error?: Error) {
  const fetch = mock(async () => {
    if (error) throw error;
    return new Collection();
  });
  const channel = {
    id: channelId,
    isThread: () => false,
    isVoiceBased: () => voice,
    permissionsFor: () => ({ has: (bit: bigint) => bit !== PermissionFlagsBits.Connect || connect }),
    messages: { fetch },
  };
  const fake = makeFakeInteraction({
    channel,
    channelId,
    guildId,
    guild: { id: guildId, members: { me: {} }, channels: { cache: new Map([[channelId, channel]]) } },
  });
  return { ...fake, fetch, interaction: fake.interaction as unknown as ChatInputCommandInteraction };
}

function description(calls: FakeCall[]): string | undefined {
  const payload = calls.find((call) => call.method === "reply")?.args[0] as { embeds: EmbedBuilder[] };
  return payload?.embeds[0]?.toJSON().description;
}

describe("/respond history permissions", () => {
  it("explains missing Connect before fetching voice-channel history", async () => {
    const { interaction, calls, fetch } = invocation(true, false);
    await execute({} as Client, interaction, createUserRow(), "en-US");
    expect(fetch).not.toHaveBeenCalled();
    expect(description(calls)).toBe(localizedCopy("en-US", "general.errors.channel_missing_permissions_description"));
  });

  it("fetches text history without Connect and voice history with Connect", async () => {
    for (const voice of [false, true]) {
      const { interaction, calls, fetch } = invocation(voice, voice);
      await execute({} as Client, interaction, createUserRow(), "en-US");
      expect(fetch).toHaveBeenCalled();
      expect(description(calls)).toBe(localizedCopy("en-US", "commands.respond.no_messages_description"));
    }
  });

  it("explains REST access rejections even when cached permissions allow history", async () => {
    for (const code of [50001, 50013]) {
      const error = new DiscordAPIError(
        { code, message: "Rejected" },
        code,
        403,
        "GET",
        "https://discord.com/api/v10/channels/100000000000000002/messages",
        {},
      );
      const { interaction, calls } = invocation(true, true, error);
      await execute({} as Client, interaction, createUserRow(), "en-US");
      expect(description(calls)).toBe(localizedCopy("en-US", "general.errors.channel_missing_permissions_description"));
    }
  });

  it("leaves unrelated fetch failures to the command error handler", async () => {
    const error = new Error("Network failure");
    const { interaction } = invocation(false, false, error);
    await expect(execute({} as Client, interaction, createUserRow(), "en-US")).rejects.toBe(error);
  });
});
