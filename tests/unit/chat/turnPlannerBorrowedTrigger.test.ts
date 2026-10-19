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
import { createPersona, createUserRow } from "../../helpers/fixtures";

const BYSTANDER = createUserRow({ user_id: 77, user_disc_id: "fixture-juno", language_pref: "ja" });

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
}): Promise<{ credentialUsers: Array<number | null | undefined>; locale: string | undefined }> {
  const persona = createPersona({ persona_id: 5, server_id: 7 });
  const channel = { id: "fixture-channel", isThread: () => false };
  const guild = { id: "fixture-guild", preferredLocale: "en-US" };
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
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(BYSTANDER),
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
      throw new DatabaseUnavailableError("stop planning here");
    }),
  );
  await planChatTurns(lockedTurn);
  return { credentialUsers, locale: lockedTurn.admission.locale };
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

  it("ignores a role whitelist that the anchor message's author fails", async () => {
    expect((await planWithAnchorAuthor({ rejectedByRoleWhitelist: true })).credentialUsers).toEqual([]);
    expect(
      (await planWithAnchorAuthor({ borrowsTriggerMessage: true, rejectedByRoleWhitelist: true })).credentialUsers,
    ).toEqual([null]);
  });
});
