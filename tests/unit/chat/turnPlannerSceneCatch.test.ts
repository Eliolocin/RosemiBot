import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { TextChannel, type Message } from "discord.js";
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

const MIRRI = createPersona({ persona_id: 5, server_id: 7, persona_nickname: "Mirri", is_alter: false });
const BAU = createPersona({ persona_id: 6, server_id: 7, persona_nickname: "Bau", is_alter: true });
const JUNO = createPersona({
  persona_id: 7,
  server_id: 7,
  persona_nickname: "Juno",
  is_alter: true,
  trigger_words: ["juno"],
});

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** Plans a member's queued message that interrupted a Natural Nudges scene whose next speaker was Bau. */
async function planInterruption(content: string, personalDtm: "off" | "on" = "off"): Promise<number[]> {
  const personas = [MIRRI, BAU, JUNO];
  const member = createUserRow({ user_id: 77, user_disc_id: "100000000000000077", personal_dtm: personalDtm });
  const client = { user: { id: "fixture-bot" } };
  const guild = { id: "fixture-guild", preferredLocale: "en-US", members: { fetch: async () => null } };
  const channel = Object.assign(Object.create(TextChannel.prototype), {
    id: "fixture-channel",
    type: 0,
    isThread: () => false,
  });
  const message = {
    id: "member-message",
    author: { id: member.user_disc_id, username: "member", bot: false },
    webhookId: null,
    channel,
    guild,
    client,
    member: null,
    content,
    mentions: { users: new Map(), roles: new Map(), everyone: false },
    reference: null,
    attachments: new Map(),
    embeds: [],
  } as unknown as Message;
  const incoming = normalizeChatInvocation({
    client: message.client,
    message,
    isFromQueue: true,
    nudgeSceneCatcherPersonaId: BAU.persona_id,
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
      userDiscId: member.user_disc_id,
      isDMChannel: false,
      allPersonas: personas,
      tomoriState: MIRRI,
      referencedMessage: null,
      locale: "en-US",
    },
  } as unknown as LockedChatTurn;

  spies.push(
    spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue(personas),
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(member),
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
      rejectedByWhitelist: false,
      allowedPersonaIds: null,
      whitelistStatus: undefined,
      personalSpotlightStatus: null,
    } as never),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue({
      source: "server",
      provider: "google",
    } as never),
  );
  const plan = await planChatTurns(lockedTurn);
  return plan.turns.map((turn) => turn.persona.persona_id as number);
}

describe("a member interrupting a Natural Nudges scene", () => {
  it("is answered by the next scripted speaker when the message addresses nobody", async () => {
    expect(await planInterruption("よ")).toEqual([BAU.persona_id as number]);
  });

  it("is answered by the persona the member named instead", async () => {
    expect(await planInterruption("juno, what are you two plotting?")).toEqual([JUNO.persona_id as number]);
  });

  it("is not answered for merely joining when the member chose deliberate triggers, or wrote a bot command", async () => {
    expect(await planInterruption("よ", "on")).toEqual([]);
    expect(await planInterruption("!roll d20")).toEqual([]);
  });
});
