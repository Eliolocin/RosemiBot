import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Message } from "discord.js";
import { DatabaseUnavailableError } from "@/types/errors";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import * as admissionGuards from "@/utils/chat/admissionGuards";
import * as errorVisibility from "@/utils/chat/errorVisibility";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { planChatTurns } from "@/utils/chat/turnPlanner";
import type { LockedChatTurn } from "@/utils/chat/types";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const BYSTANDER = createUserRow({ user_id: 77, user_disc_id: "fixture-juno", language_pref: "ja" });
const REACH_OUT_TARGET = createUserRow({ user_id: 78, user_disc_id: "fixture-mirri", user_nickname: "Mirri" });

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/**
 * Plans a manually triggered turn whose borrowed anchor belongs to a bystander, and reports the turn
 * locale and the user the text credentials were resolved for (resolution then fails, ending planning).
 */
async function planWithAnchorAuthor(options: {
  borrowsTriggerMessage?: boolean;
  rejectedByRoleWhitelist: boolean;
  reachOutTargetId?: string;
  completePlanning?: boolean;
}): Promise<{
  credentialUsers: Array<number | null | undefined>;
  locale: string | undefined;
  triggererNames: string[];
}> {
  const persona = createPersona({ persona_id: 5, server_id: 7 });
  const channel = { id: "fixture-channel", isThread: () => false };
  const guild = {
    id: "fixture-guild",
    preferredLocale: "en-US",
    members: {
      fetch: async (id: string) =>
        id === REACH_OUT_TARGET.user_disc_id ? { displayName: "Mirri (server)", user: { username: "mirri" } } : null,
    },
  };
  const client = { user: { id: "fixture-bot" } };
  const message = {
    id: "anchor",
    author: { id: BYSTANDER.user_disc_id, username: "Juno", bot: false },
    webhookId: null,
    channel,
    guild,
    client,
    member: null,
    content: "see you tomorrow",
  } as unknown as Message;
  const incoming = normalizeChatInvocation({
    client: message.client,
    message,
    isFromQueue: false,
    isManuallyTriggered: true,
    selectedPersonaId: 5,
    shouldSurfaceUserErrors: false,
    borrowsTriggerMessage: options.borrowsTriggerMessage,
    naturalNudge: options.reachOutTargetId ? { toolNames: [], targetUserDiscId: options.reachOutTargetId } : undefined,
  });
  const lockedTurn = {
    channelId: channel.id,
    admission: {
      incoming,
      client,
      message,
      channel,
      guild,
      serverDiscId: guild.id,
      userDiscId: BYSTANDER.user_disc_id,
      isDMChannel: false,
      allPersonas: [persona],
      tomoriState: persona,
      locale: "en-US",
    },
  } as unknown as LockedChatTurn;

  const credentialUsers: Array<number | null | undefined> = [];
  spies.push(
    spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue([persona]),
    spyOn(userCache, "getCachedUserRow").mockImplementation(async (id) =>
      id === REACH_OUT_TARGET.user_disc_id ? REACH_OUT_TARGET : BYSTANDER,
    ),
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(0),
    spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map()),
    spyOn(admissionGuards, "enforceGlobalRateLimit").mockResolvedValue(true),
    spyOn(admissionGuards, "enforceServerTriggerCooldownForAdmission").mockResolvedValue(true),
    spyOn(admissionGuards, "checkTextQuotaForAdmission").mockResolvedValue({ allowed: true, state: null } as never),
    spyOn(errorVisibility, "shouldSurfaceChatUserErrors").mockReturnValue(false),
    spyOn(admissionGuards, "validateDirectChatTrigger").mockResolvedValue({
      shouldContinue: true,
      isUserImpersonation: false,
      isReplyToBot: false,
      replyPersona: null,
      isBotMentioned: false,
    } as never),
    spyOn(admissionGuards, "evaluateChatAccess").mockResolvedValue({
      rejectedByWhitelist: options.rejectedByRoleWhitelist,
      allowedPersonaIds: null,
      whitelistStatus: undefined,
      personalSpotlightStatus: null,
    } as never),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockImplementation(async (_serverId, _kind, scope) => {
      credentialUsers.push(scope?.userId);
      if (options.completePlanning) return { source: "server", provider: "google" } as never;
      throw new DatabaseUnavailableError("stop planning here");
    }),
  );
  const plan = await planChatTurns(lockedTurn);
  return {
    credentialUsers,
    locale: lockedTurn.admission.locale,
    triggererNames: plan.turns.map((turn) => turn.triggererName),
  };
}

describe("borrowed-trigger turn planning (random triggers and Natural Nudges)", () => {
  it("resolves text credentials for the server, never the anchor message's author", async () => {
    expect((await planWithAnchorAuthor({ rejectedByRoleWhitelist: false })).credentialUsers).toEqual([
      BYSTANDER.user_id,
    ]);
    expect(
      (await planWithAnchorAuthor({ borrowsTriggerMessage: true, rejectedByRoleWhitelist: false })).credentialUsers,
    ).toEqual([null]);
  });

  it("speaks the guild's language rather than the anchor message author's", async () => {
    expect((await planWithAnchorAuthor({ rejectedByRoleWhitelist: false })).locale).toBe("ja");
    expect((await planWithAnchorAuthor({ borrowsTriggerMessage: true, rejectedByRoleWhitelist: false })).locale).toBe(
      "en-US",
    );
  });

  it("names a Reach-out's target as the triggerer while the server key still pays", async () => {
    const reachOut = await planWithAnchorAuthor({
      borrowsTriggerMessage: true,
      rejectedByRoleWhitelist: false,
      reachOutTargetId: REACH_OUT_TARGET.user_disc_id,
      completePlanning: true,
    });
    expect(reachOut.triggererNames).toEqual(["Mirri"]);
    expect(reachOut.credentialUsers).toEqual([null]);

    const otherNudge = await planWithAnchorAuthor({
      borrowsTriggerMessage: true,
      rejectedByRoleWhitelist: false,
      completePlanning: true,
    });
    expect(otherNudge.triggererNames).toEqual(["Juno"]);
  });

  it("ignores a role whitelist that the anchor message's author fails", async () => {
    expect((await planWithAnchorAuthor({ rejectedByRoleWhitelist: true })).credentialUsers).toEqual([]);
    expect(
      (await planWithAnchorAuthor({ borrowsTriggerMessage: true, rejectedByRoleWhitelist: true })).credentialUsers,
    ).toEqual([null]);
  });
});
