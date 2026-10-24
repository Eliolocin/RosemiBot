import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { PrivacyLevel, type TomoriState } from "@/types/db/schema";
import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";
import { DatabaseUnavailableError } from "@/types/errors";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { invalidatePersonaUserBlockCache } from "@/utils/cache/personaUserBlockCache";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { evaluateChatAccess } from "@/utils/chat/admissionGuards";
import { personaUserBlockRepository } from "@/utils/db/repositories/PersonaUserBlockRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { isBlacklistGatedCommand, resolveBlacklistedAuthorIds } from "@/utils/moderation/serverBlacklist";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ warn: () => {}, error: async () => {} });

const SERVER_DISC_ID = "300000000000000003";
const SERVER_ID = 77;
const BLACKLISTED_ID = "100000000000000011";
const MEMBER_ID = "100000000000000012";

const OPEN_WHITELIST: WhitelistCheckResult = {
  hasActiveWhitelist: false,
  hasActiveChannelWhitelist: false,
  isChannelWhitelisted: false,
  hasActiveRoleWhitelist: false,
  isRoleWhitelisted: false,
  hasActivePersonaWhitelist: false,
  isTriggerAllowed: true,
  hasChannelCooldownOverride: false,
};

const PERSONAS = [
  { persona_id: 1, is_alter: false },
  { persona_id: 2, is_alter: true },
] as unknown as TomoriState[];

function stubUserReads(blacklistedIds: ReadonlySet<string>) {
  return [
    spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null),
    spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL),
    spyOn(userRepository, "isBlacklisted").mockImplementation(async (_server, user) => blacklistedIds.has(user)),
  ] as const;
}

function evaluateFor(userDiscId: string, isDMChannel = false) {
  return evaluateChatAccess({
    isStopResponse: false,
    isDMChannel,
    isSelfMessage: false,
    isAutochatOverride: false,
    guildDiscId: SERVER_DISC_ID,
    fallbackUserDiscId: userDiscId,
    message: { id: "message-1", channelId: "channel-1" } as unknown as Message,
    effectiveChannelId: "channel-1",
    serverId: SERVER_ID,
    userId: null,
    allPersonas: PERSONAS,
  });
}

afterEach(() => {
  for (const id of [BLACKLISTED_ID, MEMBER_ID]) {
    invalidateUserCache(id);
    invalidatePersonaUserBlockCache(SERVER_ID, 1, id);
  }
  invalidateWhitelistCache(SERVER_DISC_ID);
});

describe("isBlacklistGatedCommand", () => {
  it.each([
    ["respond", null, null],
    ["reward", null, "hug"],
    ["punish", null, "bonk"],
    ["impersonate", null, "user"],
    ["generate", null, "image"],
    ["booru", null, "search"],
    ["compact", null, null],
    ["learn", null, "history"],
    ["conditioning", null, "manage"],
    ["kill", null, null],
    ["refresh", null, null],
    ["novelai", "generate", "image"],
    ["tool", "prompt", "snapshot"],
    ["tool", "delete", "turn"],
    ["persona", null, "create"],
    ["persona", null, "generate"],
  ])("gates %s %s %s", (command, group, subcommand) => {
    expect(isBlacklistGatedCommand(command, group, subcommand)).toBe(true);
  });

  it.each([
    ["personal", null, "config"],
    ["help", null, null],
    ["moderation", null, null],
    ["config", null, null],
    ["memories", null, null],
    ["novelai", null, "usage"],
    ["tool", "estimate", "cost"],
    ["persona", null, "export"],
    ["scheduled-task", null, "remove"],
    ["responder", null, null],
    ["comment", null, null],
  ])("leaves %s %s %s open", (command, group, subcommand) => {
    expect(isBlacklistGatedCommand(command, group, subcommand)).toBe(false);
  });
});

describe("resolveBlacklistedAuthorIds", () => {
  it("returns only the blacklisted authors and reads each author once", async () => {
    const [rowSpy, privacySpy, blacklistSpy] = stubUserReads(new Set([BLACKLISTED_ID]));

    const result = await resolveBlacklistedAuthorIds(SERVER_DISC_ID, [
      BLACKLISTED_ID,
      MEMBER_ID,
      BLACKLISTED_ID,
      MEMBER_ID,
    ]);

    expect([...result]).toEqual([BLACKLISTED_ID]);
    expect(blacklistSpy).toHaveBeenCalledTimes(2);
    rowSpy.mockRestore();
    privacySpy.mockRestore();
    blacklistSpy.mockRestore();
  });

  it("hides an author whose blacklist entry cannot be read", async () => {
    const rowSpy = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(null);
    const privacySpy = spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklistSpy = spyOn(userRepository, "isBlacklisted").mockRejectedValue(
      new DatabaseUnavailableError("Failed to read the blacklist entry"),
    );

    const result = await resolveBlacklistedAuthorIds(SERVER_DISC_ID, [MEMBER_ID]);

    expect(result.has(MEMBER_ID)).toBe(true);
    rowSpy.mockRestore();
    privacySpy.mockRestore();
    blacklistSpy.mockRestore();
  });
});

describe("evaluateChatAccess with the server blacklist", () => {
  it("blocks every persona for a blacklisted member without reading persona blocks", async () => {
    const [rowSpy, privacySpy, blacklistSpy] = stubUserReads(new Set([BLACKLISTED_ID]));
    const whitelistSpy = spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(OPEN_WHITELIST);
    const blocksSpy = spyOn(personaUserBlockRepository, "loadActiveBlocksForUser").mockResolvedValue([]);

    const access = await evaluateFor(BLACKLISTED_ID);

    expect([...access.blockedPersonaIds].sort()).toEqual([1, 2]);
    expect(access.allowedPersonaIds?.size).toBe(0);
    expect(blocksSpy).not.toHaveBeenCalled();
    for (const spy of [rowSpy, privacySpy, blacklistSpy, whitelistSpy, blocksSpy]) spy.mockRestore();
  });

  it("leaves a member who is not blacklisted unrestricted", async () => {
    const [rowSpy, privacySpy, blacklistSpy] = stubUserReads(new Set([BLACKLISTED_ID]));
    const whitelistSpy = spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(OPEN_WHITELIST);
    const blocksSpy = spyOn(personaUserBlockRepository, "loadActiveBlocksForUser").mockResolvedValue([]);

    const access = await evaluateFor(MEMBER_ID);

    expect(access.blockedPersonaIds.size).toBe(0);
    expect(access.allowedPersonaIds).toBeNull();
    for (const spy of [rowSpy, privacySpy, blacklistSpy, whitelistSpy, blocksSpy]) spy.mockRestore();
  });

  it("does not consult the server blacklist in a DM", async () => {
    const [rowSpy, privacySpy, blacklistSpy] = stubUserReads(new Set([BLACKLISTED_ID]));
    const whitelistSpy = spyOn(whitelistRepository, "checkChannelWhitelist").mockResolvedValue(OPEN_WHITELIST);

    const access = await evaluateFor(BLACKLISTED_ID, true);

    expect(access.blockedPersonaIds.size).toBe(0);
    expect(blacklistSpy).not.toHaveBeenCalled();
    for (const spy of [rowSpy, privacySpy, blacklistSpy, whitelistSpy]) spy.mockRestore();
  });
});
